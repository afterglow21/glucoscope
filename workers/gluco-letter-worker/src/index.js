import { DurableObject } from "cloudflare:workers";
import {
  buildAuthoritativeQuotaPayload,
  readAiQuotaCorsConfig,
  readAiQuotaClientConfig,
  readAiQuotaRequest,
  runAiQuotaGeneration
} from "./ai-quota-client.js";
import {
  filterGeneratedLetterPatternHints,
  getGlucoScoreMentionPolicy,
  getGeneratedLetterQualityIssues,
  isUnicornEligibleSummary,
  normalizeGeneratedLetterPunctuation,
  partitionGeneratedLetterQualityIssues
} from "./letter-quality.js";
import {
  isAiGenerationRequest,
  isExpectedTurnstileResult,
  shouldUseSharedCacheForSummary
} from "./request-policy.js";
import {
  buildApprovedPublicDemoLetter,
  classifyAiRequestAudience
} from "./demo-letter.js";
import { loadPublicUsageAggregate } from "./user-usage-summary.js";
import {
  applyAtomicCacheHit,
  applyAtomicGenerationComplete,
  applyAtomicGenerationRelease,
  applyAtomicGenerationReserve,
  applyAtomicTurnstileEvent,
  applyLegacyUsageStateSaveBoundary,
  carryAtomicUsageStateAcrossMonth,
  estimateMaximumOpenAiCostJpy,
  markAtomicUsageState,
  normalizeUsageRequestId,
  shouldUseAtomicUsageCounter
} from "./usage-counter-core.js";
import {
  getUsageCounterStub,
  invokeAtomicUsageFinalization,
  invokeAtomicUsageCounter,
  runWithAtomicUsageReservation,
  runWithGenerationDeadline
} from "./usage-counter-client.js";

const CONTRACT_VERSION = "gluco-ai-letter-worker-response-v0.2";
const AI_LETTER_CACHE_SCHEMA_VERSION = "gluco-ai-letter-cache-v14";
const LETTER_SLOT_KEYS = ["morning", "afternoon", "night"];
const ANALYSIS_MODE_KEYS = ["letter", "deep"];

const DEFAULT_GUARD_CONFIG = {
  aiEnabled: true,
  atomicUsageCounterEnabled: false,
  sharedCountLimitsEnabled: true,
  publicDemoApprovedSampleEnabled: false,
  provider: "prototype",
  openAiModel: "gpt-5.4-nano",
  openAiMaxOutputTokensLetter: 700,
  openAiMaxOutputTokensDeep: 1500,
  openAiRetryMaxOutputTokensLetter: 1100,
  openAiRetryMaxOutputTokensDeep: 2400,
  turnstileRequired: false,
  sharedCacheEnabled: true,
  sharedCacheFreshSeconds: 60 * 60,
  sharedCacheRetentionSeconds: 24 * 60 * 60,
  dailyGenerationLimit: 30,
  slotGenerationLimit: 10,
  monthlyBudgetJpy: 1000,
  warningBudgetJpy: 800,
  stopBudgetJpy: 950,
  timezoneOffsetHours: 9,
  inputPriceJpyPerMillionTokens: 32,
  outputPriceJpyPerMillionTokens: 200
};

let fallbackUsageState = null;

const DEFAULT_CORS_ALLOWED_ORIGINS = ["https://glucoscope.app"];
const CORS_ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];
const CORS_MAX_AGE_SECONDS = 86400;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function okResponse(body = {}, status = 200) {
  return jsonResponse({
    ok: true,
    version: CONTRACT_VERSION,
    ...body
  }, status);
}

function errorResponse({ code, message, userMessage, retryable = false, details = null }, status = 400) {
  return jsonResponse({
    ok: false,
    version: CONTRACT_VERSION,
    status: "error",
    code,
    message,
    userMessage,
    retryable,
    details
  }, status);
}

function getClientMode(payload = {}) {
  return payload?.client?.mode || "unknown";
}

function readNumber(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}


function normalizeConfiguredOrigin(value) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;

    const canonicalOrigin = url.origin;
    const configuredValue = text.endsWith("/") ? text.slice(0, -1) : text;
    return configuredValue === canonicalOrigin ? canonicalOrigin : null;
  } catch (error) {
    return null;
  }
}

function parseConfiguredOrigins(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => normalizeConfiguredOrigin(item))
    .filter(Boolean);
}

function readCorsConfig(env = {}) {
  const productionOrigins = parseConfiguredOrigins(env.CORS_ALLOWED_ORIGINS);
  const localOrigins = parseConfiguredOrigins(env.CORS_LOCAL_ORIGINS);
  const allowedOrigins = new Set([
    ...(productionOrigins.length ? productionOrigins : DEFAULT_CORS_ALLOWED_ORIGINS),
    ...localOrigins
  ]);

  return {
    allowedOrigins,
    allowRequestsWithoutOrigin: readBoolean(env.CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN, true)
  };
}

function evaluateCorsRequest(request, env = {}) {
  const config = readCorsConfig(env);
  const originHeader = request.headers.get("Origin");

  if (!originHeader) {
    return {
      allowed: config.allowRequestsWithoutOrigin,
      origin: null,
      reason: config.allowRequestsWithoutOrigin ? "origin_header_absent" : "origin_header_required"
    };
  }

  const origin = normalizeConfiguredOrigin(originHeader);
  if (!origin) {
    return {
      allowed: false,
      origin: originHeader,
      reason: "invalid_origin"
    };
  }

  return {
    allowed: config.allowedOrigins.has(origin),
    origin,
    reason: config.allowedOrigins.has(origin) ? "origin_allowed" : "origin_not_allowed"
  };
}

function appendVaryHeader(headers, value) {
  const existing = headers.get("Vary") || "";
  const values = existing
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (!values.some((item) => item.toLowerCase() === value.toLowerCase())) {
    values.push(value);
  }

  headers.set("Vary", values.join(", "));
}

function applyCorsHeaders(response, corsDecision) {
  const headers = new Headers(response.headers);
  appendVaryHeader(headers, "Origin");
  headers.delete("Access-Control-Allow-Origin");

  if (corsDecision.allowed && corsDecision.origin) {
    headers.set("Access-Control-Allow-Origin", corsDecision.origin);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function buildCorsErrorResponse(corsDecision, status = 403) {
  const response = errorResponse({
    code: corsDecision.reason,
    message: "The request origin is not allowed.",
    userMessage: "このページからはAI分析へ接続できません。"
  }, status);

  return applyCorsHeaders(response, corsDecision);
}

function getRequestedCorsHeaders(request) {
  return String(request.headers.get("Access-Control-Request-Headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
}

function handleCorsPreflight(request, corsDecision, env = {}) {
  if (!corsDecision.origin) {
    return buildCorsErrorResponse({
      ...corsDecision,
      allowed: false,
      reason: "cors_preflight_missing_origin"
    }, 400);
  }

  if (!corsDecision.allowed) {
    return buildCorsErrorResponse(corsDecision, 403);
  }

  const requestedMethod = String(request.headers.get("Access-Control-Request-Method") || "").toUpperCase();
  if (!requestedMethod || !CORS_ALLOWED_METHODS.includes(requestedMethod) || requestedMethod === "OPTIONS") {
    return buildCorsErrorResponse({
      ...corsDecision,
      allowed: false,
      reason: "cors_method_not_allowed"
    }, 403);
  }

  const corsHeaders = readAiQuotaCorsConfig(env);
  const requestedHeaders = getRequestedCorsHeaders(request);
  const unsupportedHeader = requestedHeaders.find(
    (header) => !corsHeaders.allowedRequestHeaders.includes(header)
  );
  if (unsupportedHeader) {
    return buildCorsErrorResponse({
      ...corsDecision,
      allowed: false,
      reason: "cors_header_not_allowed"
    }, 403);
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": corsDecision.origin,
    "Access-Control-Allow-Methods": CORS_ALLOWED_METHODS.join(", "),
    "Access-Control-Allow-Headers": corsHeaders.allowedRequestHeadersDisplay,
    "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS)
  });
  appendVaryHeader(headers, "Origin");
  appendVaryHeader(headers, "Access-Control-Request-Method");
  appendVaryHeader(headers, "Access-Control-Request-Headers");

  return new Response(null, {
    status: 204,
    headers
  });
}

function readGuardConfig(env = {}) {
  const monthlyBudgetJpy = readNumber(env.AI_MONTHLY_BUDGET_JPY, DEFAULT_GUARD_CONFIG.monthlyBudgetJpy);
  const warningBudgetJpy = readNumber(env.AI_WARNING_BUDGET_JPY, Math.min(DEFAULT_GUARD_CONFIG.warningBudgetJpy, monthlyBudgetJpy * 0.8));
  const stopBudgetJpy = readNumber(env.AI_STOP_BUDGET_JPY, Math.min(DEFAULT_GUARD_CONFIG.stopBudgetJpy, monthlyBudgetJpy * 0.95));
  const provider = env.AI_PROVIDER === "openai" ? "openai" : DEFAULT_GUARD_CONFIG.provider;
  const sharedCacheFreshSeconds = Math.max(
    60,
    Math.floor(readNumber(env.AI_CACHE_FRESH_SECONDS, DEFAULT_GUARD_CONFIG.sharedCacheFreshSeconds))
  );
  const sharedCacheRetentionSeconds = Math.max(
    sharedCacheFreshSeconds + 60,
    Math.floor(readNumber(env.AI_CACHE_RETENTION_SECONDS, DEFAULT_GUARD_CONFIG.sharedCacheRetentionSeconds))
  );

  const legacyOpenAiMaxOutputTokens = env.OPENAI_MAX_OUTPUT_TOKENS;
  const openAiMaxOutputTokensLetter = Math.max(
    100,
    Math.floor(readNumber(
      env.OPENAI_MAX_OUTPUT_TOKENS_LETTER ?? legacyOpenAiMaxOutputTokens,
      DEFAULT_GUARD_CONFIG.openAiMaxOutputTokensLetter
    ))
  );
  const openAiMaxOutputTokensDeep = Math.max(
    openAiMaxOutputTokensLetter,
    Math.floor(readNumber(
      env.OPENAI_MAX_OUTPUT_TOKENS_DEEP ?? legacyOpenAiMaxOutputTokens,
      DEFAULT_GUARD_CONFIG.openAiMaxOutputTokensDeep
    ))
  );
  const openAiRetryMaxOutputTokensLetter = Math.max(
    openAiMaxOutputTokensLetter,
    Math.floor(readNumber(
      env.OPENAI_RETRY_MAX_OUTPUT_TOKENS_LETTER,
      DEFAULT_GUARD_CONFIG.openAiRetryMaxOutputTokensLetter
    ))
  );
  const openAiRetryMaxOutputTokensDeep = Math.max(
    openAiMaxOutputTokensDeep,
    Math.floor(readNumber(
      env.OPENAI_RETRY_MAX_OUTPUT_TOKENS_DEEP,
      DEFAULT_GUARD_CONFIG.openAiRetryMaxOutputTokensDeep
    ))
  );

  return {
    aiEnabled: readBoolean(env.AI_ENABLED, DEFAULT_GUARD_CONFIG.aiEnabled),
    atomicUsageCounterEnabled: readBoolean(
      env.AI_USAGE_ATOMIC_COUNTER_ENABLED,
      DEFAULT_GUARD_CONFIG.atomicUsageCounterEnabled
    ),
    sharedCountLimitsEnabled: readBoolean(
      env.AI_SHARED_COUNT_LIMITS_ENABLED,
      DEFAULT_GUARD_CONFIG.sharedCountLimitsEnabled
    ),
    publicDemoApprovedSampleEnabled: readBoolean(
      env.AI_PUBLIC_DEMO_APPROVED_SAMPLE_ENABLED,
      DEFAULT_GUARD_CONFIG.publicDemoApprovedSampleEnabled
    ),
    provider,
    openAiModel: env.OPENAI_MODEL || DEFAULT_GUARD_CONFIG.openAiModel,
    openAiMaxOutputTokensLetter,
    openAiMaxOutputTokensDeep,
    openAiRetryMaxOutputTokensLetter,
    openAiRetryMaxOutputTokensDeep,
    turnstileRequired: readBoolean(env.TURNSTILE_REQUIRED, DEFAULT_GUARD_CONFIG.turnstileRequired),
    sharedCacheEnabled: readBoolean(env.AI_CACHE_ENABLED, DEFAULT_GUARD_CONFIG.sharedCacheEnabled),
    sharedCacheFreshSeconds,
    sharedCacheRetentionSeconds,
    dailyGenerationLimit: Math.max(0, Math.floor(readNumber(env.AI_DAILY_GENERATION_LIMIT, DEFAULT_GUARD_CONFIG.dailyGenerationLimit))),
    slotGenerationLimit: Math.max(0, Math.floor(readNumber(env.AI_SLOT_GENERATION_LIMIT, DEFAULT_GUARD_CONFIG.slotGenerationLimit))),
    monthlyBudgetJpy,
    warningBudgetJpy,
    stopBudgetJpy,
    timezoneOffsetHours: readNumber(env.AI_TIMEZONE_OFFSET_HOURS, DEFAULT_GUARD_CONFIG.timezoneOffsetHours),
    inputPriceJpyPerMillionTokens: readNumber(env.AI_INPUT_PRICE_JPY_PER_1M_TOKENS, DEFAULT_GUARD_CONFIG.inputPriceJpyPerMillionTokens),
    outputPriceJpyPerMillionTokens: readNumber(env.AI_OUTPUT_PRICE_JPY_PER_1M_TOKENS, DEFAULT_GUARD_CONFIG.outputPriceJpyPerMillionTokens)
  };
}

function getShiftedDate(date = new Date(), timezoneOffsetHours = 9) {
  return new Date(date.getTime() + timezoneOffsetHours * 60 * 60 * 1000);
}

function getDayKey(date = new Date(), timezoneOffsetHours = 9) {
  return getShiftedDate(date, timezoneOffsetHours).toISOString().slice(0, 10);
}

function getMonthKey(date = new Date(), timezoneOffsetHours = 9) {
  return getShiftedDate(date, timezoneOffsetHours).toISOString().slice(0, 7);
}

function createEmptySlotCounts() {
  return {
    morning: 0,
    afternoon: 0,
    night: 0,
    unknown: 0
  };
}

function createEmptyModeCounts() {
  return {
    letter: 0,
    deep: 0
  };
}

function createEmptyModeSlotCounts() {
  return {
    letter: createEmptySlotCounts(),
    deep: createEmptySlotCounts()
  };
}

function normalizeSlot(slot) {
  return LETTER_SLOT_KEYS.includes(slot) ? slot : "unknown";
}

function normalizeAnalysisMode(mode) {
  return ANALYSIS_MODE_KEYS.includes(mode) ? mode : "letter";
}

function getAnalysisMode(payload = {}, summary = {}) {
  return normalizeAnalysisMode(payload.analysisMode || summary.analysisMode);
}


function normalizeCacheIdentityPart(value, fallback = "unknown", maxLength = 180) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function getSharedCacheIdentity(summary = {}) {
  return {
    schema: AI_LETTER_CACHE_SCHEMA_VERSION,
    pageMode: normalizeCacheIdentityPart(summary.pageMode, "unknown-page", 80),
    language: summary.language === "en" ? "en" : "ja",
    period: normalizeCacheIdentityPart(summary.period, "unknown-period", 40),
    slot: normalizeSlot(summary.slot),
    analysisMode: normalizeAnalysisMode(summary.analysisMode),
    range: normalizeCacheIdentityPart(summary.cacheRangeKey || summary.rangeLabel, "unknown-range", 180)
  };
}

async function sha256Hex(value) {
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function buildSharedCacheKey(summary = {}) {
  const identity = getSharedCacheIdentity(summary);
  const hash = await sha256Hex(JSON.stringify(identity));
  return `gluco-letter:${AI_LETTER_CACHE_SCHEMA_VERSION}:${hash}`;
}

function getSharedCacheBinding(env = {}) {
  return env?.AI_LETTER_CACHE && typeof env.AI_LETTER_CACHE.get === "function"
    ? env.AI_LETTER_CACHE
    : null;
}

function getSharedCacheAvailability(env = {}, config = DEFAULT_GUARD_CONFIG) {
  return Boolean(config.sharedCacheEnabled && getSharedCacheBinding(env));
}

function getCacheTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function buildCacheTiming(generatedAt, config = DEFAULT_GUARD_CONFIG, now = new Date()) {
  const generatedAtMs = getCacheTimestamp(generatedAt) ?? now.getTime();
  const freshUntilMs = generatedAtMs + config.sharedCacheFreshSeconds * 1000;
  const expiresAtMs = generatedAtMs + config.sharedCacheRetentionSeconds * 1000;

  return {
    generatedAt: new Date(generatedAtMs).toISOString(),
    freshUntil: new Date(freshUntilMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    ageSeconds: Math.max(0, Math.floor((now.getTime() - generatedAtMs) / 1000)),
    fresh: now.getTime() < freshUntilMs,
    retained: now.getTime() < expiresAtMs
  };
}

function isValidSharedCacheEntry(entry = {}) {
  return Boolean(
    entry
    && entry.version === AI_LETTER_CACHE_SCHEMA_VERSION
    && typeof entry.text === "string"
    && entry.text.trim()
    && getCacheTimestamp(entry.generatedAt) !== null
  );
}

async function readSharedCache({ env, config, summary }) {
  if (!shouldUseSharedCacheForSummary(summary)) {
    return {
      available: false,
      key: null,
      status: "browser-local-only",
      entry: null,
      timing: null
    };
  }

  const available = getSharedCacheAvailability(env, config);
  const key = await buildSharedCacheKey(summary);

  if (!available) {
    return {
      available: false,
      key,
      status: config.sharedCacheEnabled ? "binding-missing" : "disabled",
      entry: null,
      timing: null
    };
  }

  try {
    const entry = await getSharedCacheBinding(env).get(key, {
      type: "json",
      cacheTtl: 30
    });

    if (!isValidSharedCacheEntry(entry)) {
      return {
        available: true,
        key,
        status: "miss",
        entry: null,
        timing: null
      };
    }

    const timing = buildCacheTiming(entry.generatedAt, config);
    if (!timing.retained) {
      return {
        available: true,
        key,
        status: "expired",
        entry: null,
        timing
      };
    }

    return {
      available: true,
      key,
      status: timing.fresh ? "fresh" : "stale",
      entry,
      timing
    };
  } catch (error) {
    console.error("AI letter shared cache read failed", error);
    return {
      available: true,
      key,
      status: "read-error",
      entry: null,
      timing: null,
      errorCode: error?.name || "cache_read_error"
    };
  }
}

async function writeSharedCache({ env, config, summary, generationResult }) {
  if (!shouldUseSharedCacheForSummary(summary)) {
    return {
      available: false,
      key: null,
      status: "browser-local-only",
      entry: null,
      timing: null
    };
  }

  const available = getSharedCacheAvailability(env, config);
  const key = await buildSharedCacheKey(summary);

  if (!available) {
    return {
      available: false,
      key,
      status: config.sharedCacheEnabled ? "binding-missing" : "disabled",
      timing: null
    };
  }

  const timing = buildCacheTiming(new Date().toISOString(), config);
  const entry = {
    version: AI_LETTER_CACHE_SCHEMA_VERSION,
    text: generationResult.text,
    language: summary.language === "en" ? "en" : "ja",
    analysisMode: normalizeAnalysisMode(summary.analysisMode),
    generatedAt: timing.generatedAt,
    provider: generationResult.provider || "unknown",
    model: generationResult.model || "unknown",
    slot: normalizeSlot(summary.slot)
  };

  try {
    await getSharedCacheBinding(env).put(key, JSON.stringify(entry), {
      expirationTtl: config.sharedCacheRetentionSeconds,
      metadata: {
        version: AI_LETTER_CACHE_SCHEMA_VERSION,
        generatedAt: timing.generatedAt,
        analysisMode: entry.analysisMode,
        slot: entry.slot
      }
    });

    return {
      available: true,
      key,
      status: "stored",
      entry,
      timing
    };
  } catch (error) {
    console.error("AI letter shared cache write failed", error);
    return {
      available: true,
      key,
      status: "write-error",
      timing,
      errorCode: error?.name || "cache_write_error"
    };
  }
}

function buildCachedGenerationResult(cacheRead) {
  const entry = cacheRead?.entry || {};
  return {
    text: entry.text,
    provider: entry.provider || "unknown",
    model: entry.model || "unknown",
    generatedAt: entry.generatedAt,
    usage: emptyRequestUsage()
  };
}

function buildCachePayload({ cacheResult = {}, config = DEFAULT_GUARD_CONFIG, fallbackReason = null }) {
  const timing = cacheResult.timing || null;
  const approvedDemoSample = cacheResult.status === "approved-demo-sample";
  return {
    status: cacheResult.status || "unavailable",
    storage: approvedDemoSample
      ? "human-reviewed-static-sample"
      : cacheResult.available
        ? "cloudflare-workers-kv"
        : "unavailable",
    bindingAvailable: Boolean(cacheResult.available),
    key: cacheResult.key || null,
    fresh: Boolean(timing?.fresh),
    ageSeconds: timing?.ageSeconds ?? null,
    generatedAt: timing?.generatedAt || cacheResult.entry?.generatedAt || null,
    freshUntil: timing?.freshUntil || null,
    expiresAt: timing?.expiresAt || null,
    freshSeconds: config.sharedCacheFreshSeconds,
    retentionSeconds: config.sharedCacheRetentionSeconds,
    fallbackReason
  };
}

function getAnalysisModeLabel(mode = "letter", language = "ja") {
  const normalizedMode = normalizeAnalysisMode(mode);
  if (language === "en") return normalizedMode === "deep" ? "detailed analysis" : "gentle analysis";
  return normalizedMode === "deep" ? "しっかり分析" : "やさしい分析";
}

function getSlotLabel(summary = {}, language = "ja") {
  if (summary.slotLabel) return summary.slotLabel;

  const slot = normalizeSlot(summary.slot);
  if (language === "en") {
    if (slot === "morning") return "morning letter";
    if (slot === "afternoon") return "afternoon letter";
    if (slot === "night") return "night letter";
    return "current letter";
  }

  if (slot === "morning") return "朝のお手紙";
  if (slot === "afternoon") return "昼のお手紙";
  if (slot === "night") return "夜のお手紙";
  return "今のお手紙";
}

function createUsageState(now = new Date(), config = DEFAULT_GUARD_CONFIG) {
  return {
    kind: "durable-object-sqlite",
    note: "Persisted in a singleton Cloudflare Durable Object. No glucose values or letter text are stored in this usage counter.",
    dayKey: getDayKey(now, config.timezoneOffsetHours),
    monthKey: getMonthKey(now, config.timezoneOffsetHours),
    dailyGenerationCount: 0,
    dailyCacheHitCount: 0,
    dailyRateLimitedCount: 0,
    dailyTurnstileVerifiedCount: 0,
    dailyTurnstileFailedCount: 0,
    dailyModeGenerationCounts: createEmptyModeCounts(),
    dailyModeCacheHitCounts: createEmptyModeCounts(),
    dailyModeRateLimitedCounts: createEmptyModeCounts(),
    dailySlotGenerationCounts: createEmptySlotCounts(),
    dailySlotCacheHitCounts: createEmptySlotCounts(),
    dailySlotRateLimitedCounts: createEmptySlotCounts(),
    dailyModeSlotGenerationCounts: createEmptyModeSlotCounts(),
    dailyModeSlotCacheHitCounts: createEmptyModeSlotCounts(),
    dailyModeSlotRateLimitedCounts: createEmptyModeSlotCounts(),
    monthlyGenerationCount: 0,
    monthlyCacheHitCount: 0,
    monthlyBudgetBlockedCount: 0,
    monthlyAiDisabledCount: 0,
    monthlyTurnstileVerifiedCount: 0,
    monthlyModeGenerationCounts: createEmptyModeCounts(),
    monthlyModeCacheHitCounts: createEmptyModeCounts(),
    monthlyTurnstileFailedCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostJpy: 0,
    startedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

function ensureModeCounters(state) {
  state.dailyModeGenerationCounts = {
    ...createEmptyModeCounts(),
    ...(state.dailyModeGenerationCounts || {})
  };
  state.dailyModeCacheHitCounts = {
    ...createEmptyModeCounts(),
    ...(state.dailyModeCacheHitCounts || {})
  };
  state.dailyModeRateLimitedCounts = {
    ...createEmptyModeCounts(),
    ...(state.dailyModeRateLimitedCounts || {})
  };
  state.monthlyModeGenerationCounts = {
    ...createEmptyModeCounts(),
    ...(state.monthlyModeGenerationCounts || {})
  };
  state.monthlyModeCacheHitCounts = {
    ...createEmptyModeCounts(),
    ...(state.monthlyModeCacheHitCounts || {})
  };
}

function ensureModeSlotCounters(state) {
  state.dailyModeSlotGenerationCounts = {
    ...createEmptyModeSlotCounts(),
    ...(state.dailyModeSlotGenerationCounts || {})
  };
  state.dailyModeSlotCacheHitCounts = {
    ...createEmptyModeSlotCounts(),
    ...(state.dailyModeSlotCacheHitCounts || {})
  };
  state.dailyModeSlotRateLimitedCounts = {
    ...createEmptyModeSlotCounts(),
    ...(state.dailyModeSlotRateLimitedCounts || {})
  };

  for (const mode of ANALYSIS_MODE_KEYS) {
    state.dailyModeSlotGenerationCounts[mode] = {
      ...createEmptySlotCounts(),
      ...(state.dailyModeSlotGenerationCounts[mode] || {})
    };
    state.dailyModeSlotCacheHitCounts[mode] = {
      ...createEmptySlotCounts(),
      ...(state.dailyModeSlotCacheHitCounts[mode] || {})
    };
    state.dailyModeSlotRateLimitedCounts[mode] = {
      ...createEmptySlotCounts(),
      ...(state.dailyModeSlotRateLimitedCounts[mode] || {})
    };
  }
}

function ensureSlotCounters(state) {
  state.dailySlotGenerationCounts = {
    ...createEmptySlotCounts(),
    ...(state.dailySlotGenerationCounts || {})
  };
  state.dailySlotCacheHitCounts = {
    ...createEmptySlotCounts(),
    ...(state.dailySlotCacheHitCounts || {})
  };
  state.dailySlotRateLimitedCounts = {
    ...createEmptySlotCounts(),
    ...(state.dailySlotRateLimitedCounts || {})
  };
  ensureModeCounters(state);
  ensureModeSlotCounters(state);
}

function normalizeUsageState(storedState, config, now = new Date()) {
  const dayKey = getDayKey(now, config.timezoneOffsetHours);
  const monthKey = getMonthKey(now, config.timezoneOffsetHours);
  let state = storedState && typeof storedState === "object"
    ? cloneUsageState(storedState)
    : createUsageState(now, config);

  if (state.monthKey !== monthKey) {
    state = carryAtomicUsageStateAcrossMonth(state, createUsageState(now, config));
  }

  state.kind = "durable-object-sqlite";
  state.note = "Persisted in a singleton Cloudflare Durable Object. No glucose values or letter text are stored in this usage counter.";
  ensureSlotCounters(state);

  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.dailyGenerationCount = 0;
    state.dailyCacheHitCount = 0;
    state.dailyRateLimitedCount = 0;
    state.dailyTurnstileVerifiedCount = 0;
    state.dailyTurnstileFailedCount = 0;
    state.dailyModeGenerationCounts = createEmptyModeCounts();
    state.dailyModeCacheHitCounts = createEmptyModeCounts();
    state.dailyModeRateLimitedCounts = createEmptyModeCounts();
    state.dailySlotGenerationCounts = createEmptySlotCounts();
    state.dailySlotCacheHitCounts = createEmptySlotCounts();
    state.dailySlotRateLimitedCounts = createEmptySlotCounts();
    state.dailyModeSlotGenerationCounts = createEmptyModeSlotCounts();
    state.dailyModeSlotCacheHitCounts = createEmptyModeSlotCounts();
    state.dailyModeSlotRateLimitedCounts = createEmptyModeSlotCounts();
  }

  state.updatedAt = state.updatedAt || now.toISOString();
  return state;
}

async function loadUsageState(env, config) {
  const stub = getUsageCounterStub(env?.USAGE_COUNTER);
  if (stub) {
    return stub.getState(config);
  }

  fallbackUsageState = normalizeUsageState(fallbackUsageState, config);
  fallbackUsageState.kind = "fallback-memory";
  fallbackUsageState.note = "Fallback only. Deploy with the USAGE_COUNTER Durable Object binding for persistent counters.";
  return cloneUsageState(fallbackUsageState);
}

async function persistUsageState(env, state, config) {
  const normalized = normalizeUsageState(state, config);
  normalized.updatedAt = new Date().toISOString();

  const stub = getUsageCounterStub(env?.USAGE_COUNTER);
  if (stub) {
    return stub.saveState(normalized, config);
  }

  fallbackUsageState = cloneUsageState(normalized);
  fallbackUsageState.kind = "fallback-memory";
  fallbackUsageState.note = "Fallback only. Deploy with the USAGE_COUNTER Durable Object binding for persistent counters.";
  return cloneUsageState(fallbackUsageState);
}

function cloneUsageState(state) {
  return JSON.parse(JSON.stringify(state));
}

function applyDebugUsageOverrides(state, payload = {}) {
  const debug = payload?.debug || {};
  const nextState = cloneUsageState(state);
  ensureSlotCounters(nextState);

  if (Number.isFinite(Number(debug.mockDailyGenerationCount))) {
    nextState.dailyGenerationCount = Number(debug.mockDailyGenerationCount);
  }

  if (Number.isFinite(Number(debug.mockMonthlyGenerationCount))) {
    nextState.monthlyGenerationCount = Number(debug.mockMonthlyGenerationCount);
  }

  if (Number.isFinite(Number(debug.mockMonthlyEstimatedCostJpy))) {
    nextState.estimatedCostJpy = Number(debug.mockMonthlyEstimatedCostJpy);
  }

  if (Number.isFinite(Number(debug.mockInputTokens))) {
    nextState.inputTokens = Number(debug.mockInputTokens);
  }

  if (Number.isFinite(Number(debug.mockOutputTokens))) {
    nextState.outputTokens = Number(debug.mockOutputTokens);
  }

  const mockSlot = normalizeSlot(debug.mockSlot || payload?.summary?.slot);
  const mockMode = getAnalysisMode(payload, payload?.summary || {});
  if (Number.isFinite(Number(debug.mockSlotGenerationCount))) {
    const mockCount = Number(debug.mockSlotGenerationCount);
    nextState.dailySlotGenerationCounts[mockSlot] = mockCount;
    nextState.dailyModeSlotGenerationCounts[mockMode][mockSlot] = mockCount;
    nextState.dailyModeGenerationCounts[mockMode] = Math.max(nextState.dailyModeGenerationCounts[mockMode] || 0, mockCount);
  }

  return nextState;
}

function estimateTokensFromText(text, charsPerToken = 4) {
  if (!text) return 0;
  return Math.max(1, Math.ceil(String(text).length / charsPerToken));
}

function estimateInputTokens(summary = {}) {
  return estimateTokensFromText(JSON.stringify(summary), 4);
}

function estimateOutputTokens(letterText = "") {
  return estimateTokensFromText(letterText, 2.5);
}

function estimateCostJpy({ inputTokens, outputTokens, config }) {
  const inputCost = inputTokens * config.inputPriceJpyPerMillionTokens / 1_000_000;
  const outputCost = outputTokens * config.outputPriceJpyPerMillionTokens / 1_000_000;
  return Number((inputCost + outputCost).toFixed(4));
}

function getPrototypeStatus(payload = {}) {
  const requestedStatus = payload?.debug?.forceStatus || payload?.forceStatus;

  if (requestedStatus === "cached") return "cached";
  if (requestedStatus === "rate_limited") return "rate_limited";
  if (requestedStatus === "budget_stopped") return "budget_stopped";
  if (requestedStatus === "ai_disabled") return "ai_disabled";
  return "success";
}

function buildCelebrationClues(summary = {}) {
  const language = summary.language === "en" ? "en" : "ja";
  const metrics = summary.metrics || {};
  const tir = Number(metrics.tir);
  const cv = Number(metrics.cv);
  const latestGlucose = Number(summary.currentGlucose ?? summary.latestGlucoseReading);
  const isTodayView = summary.period === "today";
  const unicornEligible = isUnicornEligibleSummary(summary);
  const clues = [];

  if (language === "en") {
    if (unicornEligible) {
      clues.push("🦄 You caught a unicorn! The latest reading is exactly 100mg/dL — a small lucky GlucoScope moment worth smiling about.");
    } else if (isTodayView && Number.isFinite(latestGlucose) && latestGlucose >= 90 && latestGlucose <= 110) {
      clues.push(`The latest reading is ${latestGlucose}mg/dL, nicely close to 100 — a lovely little moment in the flow.`);
    }

    if (tir === 100) {
      clues.push("TIR is 100%! Every available reading in this view is inside the target range. That is a beautiful flow and absolutely worth celebrating 🍀");
    } else if (tir >= 90) {
      clues.push(`TIR is ${metrics.tir}%! Almost all of the available readings are in range — a really beautiful flow 🍀`);
    } else if (tir >= 75) {
      clues.push(`TIR is ${metrics.tir}%! A strong amount of in-range time has built up here, and that is genuinely lovely to see 🍀`);
    }

    if (Number.isFinite(cv) && cv < 24) {
      clues.push(`CV is ${metrics.cv}%! The glucose flow is remarkably calm and steady — this is a genuinely beautiful pattern 🍀`);
    } else if (Number.isFinite(cv) && cv < 30) {
      clues.push(`CV is ${metrics.cv}%, showing a very calm and steady glucose flow. That is a lovely strength in this view 🍀`);
    }

    return clues;
  }

  if (unicornEligible) {
    clues.push("🦄 ユニコーンをつかまえた！ 最新の測定はぴったり100mg/dL。小さな幸運に出会えたね🍀");
  } else if (isTodayView && Number.isFinite(latestGlucose) && latestGlucose >= 90 && latestGlucose <= 110) {
    clues.push(`最新の測定は${latestGlucose}mg/dLで、100に近いきれいな数字が見えているよ。ちょっとうれしい瞬間だね🍀`);
  }

  if (tir === 100) {
    clues.push("TIRは100％！ 表示中のデータはすべて目標範囲の中。これは思いきり一緒に喜びたい、とてもきれいな流れだよ🍀");
  } else if (tir >= 90) {
    clues.push(`TIRは${metrics.tir}％！ 表示中のほとんどの時間が目標範囲の中だね。とてもきれいな流れだよ🍀`);
  } else if (tir >= 75) {
    clues.push(`TIRは${metrics.tir}％！ 目標範囲で過ごせた時間がしっかり積み重なっているね。これは素直にうれしい流れだよ🍀`);
  }

  if (Number.isFinite(cv) && cv < 24) {
    clues.push(`CVは${metrics.cv}％！ ばらつきがとても小さく、かなり穏やかな流れだよ。これはすごくきれいだね🍀`);
  } else if (Number.isFinite(cv) && cv < 30) {
    clues.push(`CVは${metrics.cv}％で、血糖の流れがかなり穏やかだよ。うれしい安定感が見えているね🍀`);
  }

  return clues;
}

function buildPrototypeLetter(summary = {}, mode = "letter") {
  const language = summary.language === "en" ? "en" : "ja";
  const metrics = summary.metrics || {};
  const slotLabel = getSlotLabel(summary, language);
  const analysisMode = normalizeAnalysisMode(mode);
  const modeLabel = getAnalysisModeLabel(analysisMode, language);
  const rangeLabel = summary.rangeLabel || "--";
  const tir = metrics.tir ?? "--";
  const tar = metrics.tar ?? "--";
  const tbr = metrics.tbr ?? "--";
  const avg = metrics.averageGlucose ?? "--";
  const cv = metrics.cv ?? "--";
  const scorePolicy = getGlucoScoreMentionPolicy(summary);
  const score = metrics.glucoScore ?? "--";
  const scoreOverviewEn = scorePolicy.mention ? `, GlucoScore ${score}` : "";
  const scoreOverviewJa = scorePolicy.mention ? ` / GlucoScore ${score}` : "";
  const scoreSentenceEn = scorePolicy.mention ? `, and GlucoScore is ${score}` : "";
  const scoreSentenceJa = scorePolicy.mention ? `、GlucoScoreは${score}` : "";
  const celebrationClues = buildCelebrationClues(summary);
  const hints = filterGeneratedLetterPatternHints(summary, analysisMode === "deep" ? 4 : 2);

  if (analysisMode === "deep") {
    if (language === "en") {
      const celebrationSection = celebrationClues.length
        ? `\n\nWorth celebrating\n${celebrationClues.map((clue) => `- ${clue}`).join("\n")}`
        : "";
      const hintLines = hints.length ? hints.map((hint) => `- ${hint}`).join("\n") : "- The selected range has clues we can look back on gently.";
      return `Gluco is here 🍀
I'm glad you came by. Before the numbers, here is a small pause just for you.
I looked at the selected range gently.${celebrationSection}

Overview
- Range: ${rangeLabel}
- TIR ${tir}%, TAR ${tar}%, TBR ${tbr}%
- Average glucose ${avg}mg/dL, CV ${cv}%${scoreOverviewEn}

Clues visible in the summary
${hintLines}

This is not a diagnosis or a treatment instruction. It is a gentle map for noticing patterns and discussing anything concerning with your healthcare team.
You are always more than these numbers. I'm right here with you 🍀`;
    }

    const celebrationSection = celebrationClues.length
      ? `\n\nうれしい手がかり\n${celebrationClues.map((clue) => `・${clue}`).join("\n")}`
      : "";
    const hintLines = hints.length ? hints.map((hint) => `・${hint}`).join("\n") : "・表示中の期間には、あとでやさしく見返せる手がかりがありそうだよ。";
    return `グルコだよ🍀
来てくれてうれしいよ。数字を見る前に、ここでちょっとひと息つこうね。
表示中のデータを、少し詳しく一緒に見ていくね。${celebrationSection}

全体の流れ
・表示範囲: ${rangeLabel}
・TIR ${tir}% / TAR ${tar}% / TBR ${tbr}%
・平均血糖 ${avg}mg/dL / CV ${cv}%${scoreOverviewJa}

見えている手がかり
${hintLines}

これは診断や治療の指示ではなく、あとで主治医さんとも話しやすくするための、やさしい振り返りだよ。
どんな数字の日も、あなたはあなたのままで大切だよ。ぼくはここにいるよ🍀`;
  }

  if (language === "en") {
    const celebrationLine = celebrationClues.length ? `\n${celebrationClues.slice(0, 2).join("\n")}` : "";
    const hintLine = hints.length ? `\nI also noticed: ${hints.join(" / ")}` : "";
    return `Gluco is here 🍀
I'm glad you came by. Let's take a tiny pause before the numbers.
I looked at the selected range gently: ${rangeLabel}.${celebrationLine}
TIR is ${tir}%, and average glucose is ${avg}mg/dL${scoreSentenceEn}.${hintLine}
The numbers are not here to judge you; they are small clues for understanding today and improving tomorrow.
Showing up to look is already a small step. I'm right here with you 🍀`;
  }

  const celebrationLine = celebrationClues.length ? `\n${celebrationClues.slice(0, 2).join("\n")}` : "";
  const hintLine = hints.length ? `\n見えている手がかり: ${hints.join(" / ")}` : "";
  return `グルコだよ🍀
来てくれてうれしいよ。まずは、ちょっとひと息つこうね。
表示範囲は ${rangeLabel} だね。${celebrationLine}
TIRは${tir}%、平均血糖は${avg}mg/dL${scoreSentenceJa}だったよ。${hintLine}
血糖はあなたを責める数字じゃなくて、今日を理解して明日を少し楽にするための手がかりだよ。
ここを見に来てくれたことも、小さな一歩だよ。ぼくはここにいるよ🍀`;
}

function getUtf8ByteLength(value) {
  return new TextEncoder().encode(String(value ?? "")).byteLength;
}

function estimateReservedGenerationCostJpy({ summary = {}, config = DEFAULT_GUARD_CONFIG }) {
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);
  if (config.provider !== "openai") {
    const prototypeText = buildPrototypeLetter(summary, analysisMode);
    return estimateCostJpy({
      inputTokens: estimateInputTokens(summary),
      outputTokens: estimateOutputTokens(prototypeText),
      config
    });
  }

  const language = summary.language === "en" ? "en" : "ja";
  const instructions = buildOpenAiInstructions(language, analysisMode, summary);
  const initialPrompt = buildOpenAiPrompt(summary, analysisMode);
  const incompleteRetryPrompt = buildOpenAiRetryPrompt(summary, analysisMode, "incomplete");
  const qualityRetryPrompt = buildOpenAiRetryPrompt(summary, analysisMode, "quality");
  const retryPromptBytes = Math.max(
    getUtf8ByteLength(incompleteRetryPrompt),
    getUtf8ByteLength(qualityRetryPrompt)
  );
  const limits = getOpenAiTokenLimits(config, analysisMode);
  return estimateMaximumOpenAiCostJpy({
    instructionsUtf8Bytes: getUtf8ByteLength(instructions),
    initialPromptUtf8Bytes: getUtf8ByteLength(initialPrompt),
    retryPromptUtf8Bytes: retryPromptBytes,
    initialMaxOutputTokens: limits.initial,
    retryMaxOutputTokens: limits.retry,
    inputPriceJpyPerMillionTokens: config.inputPriceJpyPerMillionTokens,
    outputPriceJpyPerMillionTokens: config.outputPriceJpyPerMillionTokens,
    framingInputTokensPerCall: 4096,
    transportAttemptsPerStage: 2
  }).reservedCostJpy;
}

function getAtomicUsageRequestId(payload = {}, quotaRequest = null) {
  const candidate = quotaRequest?.reserveInput?.requestId || payload?.requestId;
  return normalizeUsageRequestId(candidate) || crypto.randomUUID();
}

function buildUsageCounterUnavailableResponse() {
  return errorResponse({
    code: "usage_counter_unavailable",
    message: "The atomic AI usage counter is temporarily unavailable.",
    userMessage: "AI利用回数を安全に確認できませんでした。血糖表示はそのまま使えるので、少し時間をおいてもう一度試してね🍀",
    retryable: true
  }, 503);
}

async function invokeRequiredAtomicUsageCounter({ env, config, method, input = {} }) {
  const options = {
    enabled: config.atomicUsageCounterEnabled,
    namespace: env.USAGE_COUNTER,
    method,
    input,
    config
  };
  const outcome = method === "completeGeneration" || method === "releaseGeneration"
    ? invokeAtomicUsageFinalization(options)
    : invokeAtomicUsageCounter(options);
  const result = await outcome;
  if (!result.ok) {
    console.error("Atomic usage counter RPC failed", {
      method,
      reason: result.reason || result.error || "unknown"
    });
  }
  return result;
}

function buildOpenAiInstructions(language = "ja", mode = "letter", summary = {}) {
  const analysisMode = normalizeAnalysisMode(mode);
  const scorePolicy = getGlucoScoreMentionPolicy(summary);

  if (language === "en") {
    const modeInstruction = analysisMode === "deep"
      ? "Write a structured detailed reflection, not a medical report. Use short sections and bullet points."
      : "Write as a short warm letter, not as a medical report.";

    return [
      "You are gluco, GlucoScope's gentle AI companion.",
      "You help people living with diabetes reflect on summarized glucose data with kindness.",
      "Do not diagnose, judge, blame, scare, or give treatment decisions.",
      "Do not recommend insulin doses, medication changes, pump settings, or device-setting changes.",
      "Use the provided summarized data only. Do not invent measurements.",
      modeInstruction,
      "Welcome the person as a whole person, not as a set of readings. Include one brief greeting or encouraging companionship line near the beginning.",
      "Include one short everyday aside unrelated to glucose near the beginning or end, such as taking a small pause or enjoying a favorite sound.",
      "The aside may offer rest or a change of pace, but must not claim a health benefit, imply it changes glucose, or become advice about food, exercise, medication, supplements, or sleep.",
      "Because the response may be shown later from cache, avoid real-time wording such as 'right now' or 'current glucose'.",
      "When mentioning the latest glucose value, say 'the latest reading' or include the provided measurement time.",
      "Treat the supplied metrics as reflection clues, not grades.",
      scorePolicy.mention
        ? "GlucoScore may appear once as an optional reflection clue, never as a grade, achievement, or judgment of effort."
        : "Omit GlucoScore completely in this response, including its value and comparisons.",
      "When the summary contains positive clues, celebrate them clearly and early instead of minimizing them with phrases like 'not bad', 'not perfect', or 'not too wavy'.",
      "TIR of 100% deserves enthusiastic celebration as a TIR result. TIR 100% never creates or implies a unicorn.",
      "Unicorn wording is allowed only when the latest reading in today's view is exactly 100mg/dL. TIR 100%, average glucose 100mg/dL, and GlucoScore 100 never qualify.",
      "When unicorn wording is allowed, connect it explicitly to the latest 100mg/dL reading in a separate sentence or bullet, never to TIR.",
      "Do not assume how hard the person worked or make praise about their worth. Praise the observed flow, not the person as a grade.",
      "Positive recognition must not hide notable lower or higher periods; celebrate first, then mention important clues gently.",
      "Do not expose variable names, JSON keys, camelCase labels, or other implementation details in the response.",
      "Keep it concrete, gentle, and clear. End with companionship, reassurance, or one optional reflection clue rather than an assignment."
    ].join(" ");
  }

  const modeInstruction = analysisMode === "deep"
    ? "医療レポートではなく、絵文字アイコン付きの短い見出しと箇条書きを使った、少し詳しい分析として書きます。"
    : "医療レポートではなく、グルコからの短くやさしい分析として書きます。";

  return [
    "あなたはGlucoScope公式AIパートナーのグルコです。",
    "糖尿病とともに生きる人が、血糖データを責められることなくやさしく振り返るための文章を書きます。",
    "診断、治療判断、インスリン量、薬、ポンプ設定、デバイス設定の変更指示はしません。",
    "血糖値の良し悪しを決めつけず、評価・採点・反省を迫る言い方を避けます。",
    "与えられた集計済みサマリーだけを使い、測定値や出来事を作りません。",
    modeInstruction,
    "数字の持ち主である一人の人を歓迎し、冒頭近くに短い挨拶や『来てくれてうれしいよ』『ぼくはここにいるよ』のような寄り添いを1文入れます。",
    "冒頭か最後に、血糖とは関係のない日常の短いひと言を1文入れてよいです。『ちょっとひと息つこうね』『好きな音をひとつ思い出すのもいいね』など、休息や気分転換のやさしい言葉にします。",
    "日常のひと言は健康効果や血糖への効果を断定せず、食事、運動、薬、サプリ、睡眠の助言にはしません。季節、天気、居場所、時刻も作りません。",
    "話し方は、そばにいる小さなともだちのような自然な常体に統一します。文末に『です』『ます』『でした』『ました』『あります』『ありません』『ください』『ましょう』『でしょう』を使いません。",
    "文末は『だよ』『だね』『見えているよ』『一緒に見ていこうね』など、グルコらしいやわらかい言葉にします。",
    "『グルコだよ🍀』と短い見出し以外の普通の文は、自然な『。』『！』『？』で終えます。ただし、文末に絵文字を添える普通の文では『。』を付けず、『ぼくはここにいるよ🍀』のようにします。",
    "『一緒に』は連続する2文で繰り返しません。直前の文で『一緒に』を使った場合、最後の文は『明日もやさしく振り返ってみよう🍀』など別の言い方にします。",
    "『かも』は、データから見えることが確かではないときだけ使い、呼びかけや提案の文末には使いません。",
    "『〜しようかも』『〜していこうかも』『〜見てみようかも』のような表現は使わず、呼びかけは『〜しようね』『〜してみよう』『〜見ていこうね』のように自然に書きます。",
    "入力欄の名前、英語の変数名、JSONキー、camelCase、内部処理の言葉を本文へ出しません。",
    "キャッシュ表示される可能性があるため、『今の血糖』『現在の血糖』『たった今』などのリアルタイム断定は避けます。",
    "最新測定に触れる場合は、『最新の測定では』『○○ごろの測定では』のように時刻やサマリー上の測定であることが伝わる言い方にします。",
    "サマリーに渡された数値は採点ではなく、振り返りの手がかりとして扱います。",
    scorePolicy.mention
      ? "GlucoScoreは採点、達成、成功、努力の評価にせず、任意の振り返りの手がかりとして1回だけ触れてよいです。"
      : "この文章ではGlucoScoreを完全に省略し、現在値、比較値、過去7日平均のどれにも触れません。",
    "TBR、TAR、CV、低めのTIR、GlucoScoreの変化に『も』『しか』『まだ』『残念ながら』『高すぎる』『低すぎる』『悪い』『問題』を結びつけません。数値は『TBRは5.9％だったよ』のように事実として伝えます。",
    "サマリーの『いたわり優先』が対象なら、振り返りや明日への提案より先に、大変な時間があったかもしれないことへやさしいいたわりを1文添えます。",
    "『今日はがんばったね』のような励ましは、数値だけから努力を断定する形では使いません。『大変な時間もあったかもしれないね』『今日はここまで、おつかれさま』のように、体験を断定しない言葉を優先します。",
    "『TIRは94.1％！』のように数値だけを1行で強調しません。同じ文で、その数字から見える流れをやさしく伝えます。",
    "『いたわり優先』『対象』『通常』『非公開の書き方指示』など、文章生成のための判定名や内部指示を本文へ書きません。",
    "数値の説明に『平均の雰囲気』『景色』『戻りの力』『後から見る場所』『小さくまとまる動き』など、意味が曖昧な比喩を使いません。",
    "比較値がサマリーに明示されていない指標について、『増えた』『減った』『戻った』と変化を推測しません。",
    "TBRや低めの時間へ『少し』『ちょっと』『わずか』を付けて小さく扱わず、低めの時間そのものを『安心材料』とは表現しません。",
    "GMIは平均血糖から計算した参考値として事実だけを伝え、『荒れている』『穏やか』『安定している』とは解釈しません。今日・昨日など短い期間では、文章の流れに必要なときだけ触れます。",
    "差分は『前回との差は-4mg/dLだったよ』のように簡潔に伝え、『小さくまとまる動き』などの評価を足しません。",
    "TBRは『TBRは12.9％だったよ』と事実として区切り、『だから』『なので』で振り返りの提案へ直結させません。いたわりが必要なときは、どの提案より先に自然な労いを置きます。",
    "前回との差分は1回の測定差としてだけ伝え、そこから『急に大きく動いていない流れ』『落ち着いた動き』など、時間的な傾向を推測しません。",
    "同じ指標を複数の見出しや段落で繰り返しません。うれしい点は、その指標を最初に説明する文の中で一緒に伝えます。",
    "『一定ぶん』『参考値として押さえられる』『比較期間より1だけ高い』『低め寄りにまとまっている』のような不自然な言い回しを使いません。",
    "今日・昨日の短い期間ではGMIを本文へ出しません。GlucoScoreは非公開の書き方指示が許可した場合だけ1回触れ、それ以外はしっかり分析を含めて完全に省略します。",
    "振り返りの提案や締めの呼びかけは最後に1つだけ置き、似た意味の『見返してみようね』『一緒に見ていこうね』を続けません。",
    "TIR、TAR、TBR、CV、GlucoScoreを、明日の達成目標・改善課題・維持課題へ変換しません。数値は理解と振り返りの手がかりとして扱います。",
    "『目標の時間を増やす』『TBRを減らす』『数値を維持する』『改善する』『これだけ意識して進めよう』『目指そう』『できるようにしよう』のような、数値改善を求める指導表現を使いません。",
    "最後は行動目標を課さず、『今日の数字を急いで答えにしなくて大丈夫だよ』『ぼくはここにいるよ』のように、理解や安心を支える言葉で締めます。振り返りを勧める場合も任意の誘いにします。",
    "TBRが1％以上、またはTIRが70％以下のときは、TIRを増やす・TBRを減らすといった最適化提案をせず、いたわりを先に置いたうえで、必要なら余裕のあるときの振り返りだけを提案します。",
    "良い手がかりがあるときは、文章の早い段階で、遠慮せず具体的に一緒に喜びます。『悪くない』『完璧ではないけど』『ばらつきはゼロではないけど』『大きく乱れていない』のように、褒め言葉を弱める言い方はしません。",
    "TIR 100％はTIRのきれいな流れとしてしっかり祝います。ただし、TIR 100％をユニコーンの理由にはしません。",
    "ユニコーンは、今日の表示範囲内の最新測定がちょうど100mg/dLのときだけです。TIR 100％、平均血糖100mg/dL、GlucoScore 100はユニコーン条件ではありません。",
    "ユニコーンを使える場合も、最新測定100mg/dLの手がかりとして独立した文または箇条書きで伝え、TIRとは結びつけません。",
    "努力や生活背景を勝手に推測せず、人の価値ではなく、データから見えた良い流れを褒めます。",
    "良いところを喜んでも、低め・高めなど大切な手がかりを隠しません。まず喜び、そのあと必要な点をやさしく伝えます。",
    "具体的で、やさしく、読みやすく。最後に明日を少し楽にする小さな手がかりを添えます。"
  ].join(" ");
}

function getPromptPeriodLabel(period = "today", language = "ja") {
  const labels = language === "en"
    ? {
        today: "today",
        yesterday: "yesterday",
        seven: "7 days",
        thirty: "30 days",
        custom: "custom range"
      }
    : {
        today: "今日",
        yesterday: "昨日",
        seven: "7日",
        thirty: "30日",
        custom: "カスタム期間"
      };

  return labels[period] || labels.custom;
}

function getCompassionGuidance(summary = {}, language = "ja") {
  const metrics = summary.metrics || {};
  const tir = Number(metrics.tir);
  const tbr = Number(metrics.tbr);
  const hasLowTime = Number.isFinite(tbr) && tbr >= 1;
  const hasLowerTir = Number.isFinite(tir) && tir <= 70;

  if (language === "en") {
    if (hasLowTime && hasLowerTir) {
      return "Do not quote this instruction or describe a priority status. TBR is at least 1% and TIR is 70% or lower. Acknowledge gently that the period may have felt demanding before suggestions, without inferring effort or symptoms as fact.";
    }
    if (hasLowTime) {
      return "Do not quote this instruction or describe a priority status. TBR is at least 1%. Lower periods may have felt difficult. Offer gentle acknowledgment before suggestions without assuming symptoms or effort.";
    }
    if (hasLowerTir) {
      return "Do not quote this instruction or describe a priority status. TIR is 70% or lower. The person may have had a demanding stretch. Offer gentle acknowledgment before suggestions without treating the number as failure.";
    }
    return "No extra compassion-threshold instruction is needed. Do not mention this instruction in the response.";
  }

  if (hasLowTime && hasLowerTir) {
    return "この指示や判定名は本文へ書かない。TBRが1％以上で、TIRも70％以下。低めや目標範囲外の時間が大変に感じられたかもしれないことへ、提案より先に『今日はここまで、おつかれさま』のようないたわりを1文添え、体調や努力は断定しない。";
  }
  if (hasLowTime) {
    return "この指示や判定名は本文へ書かない。TBRが1％以上。低めの時間は大変に感じる場面があったかもしれない。提案より先にやさしいいたわりを1文添え、体調や努力は断定しない。";
  }
  if (hasLowerTir) {
    return "この指示や判定名は本文へ書かない。TIRが70％以下。思うようにいかない時間が多く、大変に感じる場面があったかもしれない。数字を失敗として扱わず、提案より先にやさしいいたわりを1文添える。";
  }
  return "追加のいたわり条件はない。この指示や判定名は本文へ書かない。";
}
function getConciseMetricGuidance(summary = {}, mode = "letter", language = "ja") {
  const scorePolicy = getGlucoScoreMentionPolicy(summary);
  const isShortRange = summary.period === "today" || summary.period === "yesterday";

  if (language === "en") {
    const guidance = [
      "Mention each metric in only one sentence or section.",
      "Treat a single delta as one measurement difference, not as a trend.",
      "Use only one closing reflection invitation."
    ];
    if (isShortRange) guidance.push("Omit GMI from today and yesterday reflections.");
    guidance.push(scorePolicy.mention
      ? "GlucoScore is at least two higher than the comparison period. It may be mentioned once as an optional reflection clue, never as a grade, achievement, or judgment of effort."
      : "Omit GlucoScore completely. Do not mention its value, comparison, or 7-day average.");
    return guidance.join(" ");
  }

  const guidance = [
    "同じ指標は1つの文または1つの箇条書きだけで扱い、別の見出しで繰り返さない。",
    "差分は1回の測定差として事実だけを伝え、流れや傾向を推測しない。",
    "振り返りの提案と締めの呼びかけは合わせて1つだけにする。",
    "TIR、TAR、TBR、CV、GlucoScoreを明日の数値目標や改善課題へ変えない。",
    "『目標の時間を増やす』『TBRを減らす』『これだけ意識して進めよう』『目指そう』『できるようにしよう』を使わず、理解のための振り返りで締める。"
  ];
  if (isShortRange) guidance.push("今日・昨日ではGMIを本文へ出さない。");
  guidance.push(scorePolicy.mention
    ? "GlucoScoreは比較期間より2以上高い。採点、達成、成功、努力の評価にはせず、任意の振り返りの手がかりとして1回だけ触れてよい。"
    : "GlucoScoreは完全に省略し、現在値、比較値、過去7日平均のどれにも触れない。");
  return guidance.join(" ");
}

function isShortPromptPeriod(period = "today") {
  return period === "today" || period === "yesterday";
}

function buildOpenAiSummaryText(summary = {}, mode = "letter", language = "ja") {
  const analysisMode = normalizeAnalysisMode(mode);
  const metrics = summary.metrics || {};
  const scorePolicy = getGlucoScoreMentionPolicy(summary);
  const celebrationClues = buildCelebrationClues(summary);
  const privateWritingGuidance = [
    getCompassionGuidance(summary, language),
    getConciseMetricGuidance(summary, analysisMode, language)
  ].filter(Boolean).join(" ");
  const patternHints = filterGeneratedLetterPatternHints(summary, analysisMode === "deep" ? 6 : 4);
  const valueOrDash = (value) => value === null || value === undefined || value === "" ? "--" : value;

  if (language === "en") {
    const metricLines = [
      `- Period: ${getPromptPeriodLabel(summary.period, language)}`,
      `- Letter time: ${getSlotLabel(summary, language)}`,
      `- Displayed range: ${valueOrDash(summary.rangeLabel)}`,
      `- Latest measured at in the selected range: ${valueOrDash(summary.latestMeasuredAt)}`,
      `- Latest glucose reading in the selected range: ${valueOrDash(summary.currentGlucose)} mg/dL`,
      `- Unicorn eligibility: ${isUnicornEligibleSummary(summary) ? "eligible — today's latest reading is exactly 100mg/dL" : "not eligible — do not use unicorn wording"}`,
      `- Direction: ${valueOrDash(summary.direction)}`,
      `- Difference from the previous reading: ${valueOrDash(summary.delta)} mg/dL`,
      `- TIR: ${valueOrDash(metrics.tir)}%`,
      `- TAR: ${valueOrDash(metrics.tar)}%`,
      `- TBR: ${valueOrDash(metrics.tbr)}%`,
      `- Average glucose: ${valueOrDash(metrics.averageGlucose)} mg/dL`,
      `- CV: ${valueOrDash(metrics.cv)}%`,
      ...(isShortPromptPeriod(summary.period) ? [] : [`- GMI estimate: ${valueOrDash(metrics.gmi)}%`]),
      ...(scorePolicy.mention ? [
        `- GlucoScore: ${valueOrDash(metrics.glucoScore)}`,
        `- Previous comparison GlucoScore: ${valueOrDash(metrics.previousScore)}`
      ] : []),
      `- Private writing guidance (never quote this label or instruction): ${privateWritingGuidance}`,
      "- Positive clues:",
      ...(celebrationClues.length ? celebrationClues.map((clue) => `  - ${clue}`) : ["  - none"]),
      "- Reflection clues:",
      ...(patternHints.length ? patternHints.map((hint) => `  - ${hint}`) : ["  - none"])
    ];
    return metricLines.join("\n");
  }

  const metricLines = [
    `・期間: ${getPromptPeriodLabel(summary.period, language)}`,
    `・お手紙の時間: ${getSlotLabel(summary, language)}`,
    `・表示範囲: ${valueOrDash(summary.rangeLabel)}`,
    `・表示範囲内の最新測定: ${valueOrDash(summary.latestMeasuredAt)}`,
    `・表示範囲内の最新の血糖測定: ${valueOrDash(summary.currentGlucose)} mg/dL`,
    `・ユニコーン判定: ${isUnicornEligibleSummary(summary) ? "対象（今日の最新測定が100mg/dL）" : "対象外（ユニコーン表現を使わない）"}`,
    `・矢印: ${valueOrDash(summary.direction)}`,
    `・前回との差分: ${valueOrDash(summary.delta)} mg/dL`,
    `・TIR: ${valueOrDash(metrics.tir)}%`,
    `・TAR: ${valueOrDash(metrics.tar)}%`,
    `・TBR: ${valueOrDash(metrics.tbr)}%`,
    `・平均血糖: ${valueOrDash(metrics.averageGlucose)} mg/dL`,
    `・CV: ${valueOrDash(metrics.cv)}%`,
    ...(isShortPromptPeriod(summary.period) ? [] : [`・GMI目安: ${valueOrDash(metrics.gmi)}%`]),
    ...(scorePolicy.mention ? [
      `・GlucoScore: ${valueOrDash(metrics.glucoScore)}`,
      `・比較期間のGlucoScore: ${valueOrDash(metrics.previousScore)}`
    ] : []),
    `・非公開の書き方指示（見出しや判定語を本文へ書かない）: ${privateWritingGuidance}`,
    "・うれしい手がかり:",
    ...(celebrationClues.length ? celebrationClues.map((clue) => `  ・${clue}`) : ["  ・なし"]),
    "・振り返りの手がかり:",
    ...(patternHints.length ? patternHints.map((hint) => `  ・${hint}`) : ["  ・なし"])
  ];
  return metricLines.join("\n");
}

function buildOpenAiPrompt(summary = {}, mode = "letter") {
  const language = summary.language === "en" ? "en" : "ja";
  const analysisMode = normalizeAnalysisMode(mode);
  const scorePolicy = getGlucoScoreMentionPolicy(summary);
  const modeLabel = getAnalysisModeLabel(analysisMode, language);
  const slotLabel = getSlotLabel(summary, language);
  const summaryText = buildOpenAiSummaryText(summary, analysisMode, language);

  if (language === "en") {
    if (analysisMode === "deep") {
      return `Create one detailed Gluco reflection for this summarized glucose view.

Requirements:
- Start with exactly "Gluco is here 🍀", then add a short, varied welcome on the next line
- Near the beginning or end, include one brief everyday aside unrelated to glucose, such as taking a small pause or enjoying a favorite sound
- Keep that aside free of health claims and do not turn it into food, exercise, medication, supplement, or sleep advice
- Use short emoji section labels, such as 🍀 Flow / 📊 Metric clues / 🔎 Pattern clues / 🌱 A small next reflection
- Do not use Markdown heading marks such as #, ##, or ###
- Do not write meta labels such as "This is a prototype", "This is the detailed analysis", or "This is the ${slotLabel}"
- Mention the active time only if it reads naturally; do not force it
- Include TIR, TAR, TBR, average glucose, and CV when available${scorePolicy.mention ? "; GlucoScore may appear once as an optional clue" : "; omit GlucoScore completely"}
- If positive clues are listed, mention one or more near the beginning and celebrate them clearly
- Celebrate TIR 100% enthusiastically as a TIR result only; it never means unicorn
- Follow the "Unicorn eligibility" line exactly and never infer unicorn from TIR, average glucose, or GlucoScore
- If eligible, connect unicorn wording to the latest 100mg/dL reading in a separate sentence or bullet, never to TIR
- Do not weaken praise with "not bad", "not perfect", or similar backhanded wording
- Do not frame numbers as grades or success/failure
- Do not output field names, variable names, JSON keys, camelCase, or implementation details
- Avoid real-time wording such as "right now" because this may be shown later from cache
- Avoid medical advice, dosing advice, diagnosis, blame, fear, or strict instructions
- Keep it readable: about 11 to 17 short lines
- End with companionship or reassurance; a reflection invitation must feel optional, never like homework

Summarized data:
${summaryText}`;
    }

    return `Write one Gluco letter for this summarized glucose view.

Requirements:
- Start with exactly "Gluco is here 🍀", then add a short, varied welcome on the next line
- 6 to 9 short lines
- Near the beginning or end, include one brief everyday aside unrelated to glucose, such as taking a small pause or enjoying a favorite sound
- Keep that aside free of health claims and do not turn it into food, exercise, medication, supplement, or sleep advice
- Do not write meta labels such as "This is a prototype" or "This is today’s ${slotLabel}"
- Mention the active letter time only if it reads naturally; do not force it
- Mention 1 to 3 concrete clues from the summary
- If positive clues are listed, mention at least one early and celebrate it clearly
- Celebrate TIR 100% as a TIR result only; it never means unicorn
- Follow the "Unicorn eligibility" line exactly. If eligible, connect unicorn wording only to the latest 100mg/dL reading and keep it separate from TIR
- Do not weaken praise with "not bad", "not perfect", or similar backhanded wording
- Do not output field names, variable names, JSON keys, camelCase, or implementation details
- If mentioning glucose value, use "the latest reading" and include the measurement time when available
- Avoid real-time wording such as "right now" because the letter may be shown later from cache
- Avoid medical advice, dosing advice, diagnosis, blame, fear, or strict instructions
- Use gentle, plain language
- End with companionship or reassurance; a reflection invitation must feel optional, never like homework

Summarized data:
${summaryText}`;
  }

  if (analysisMode === "deep") {
    return `この集計済み血糖サマリーをもとに、グルコからの「${modeLabel}」を1つ書いて。

条件:
- 最初は必ず「グルコだよ🍀」で始め、次の行に「来てくれてうれしいよ」などの短い挨拶を入れる。挨拶は同じ一文に固定しない
- 「グルコだよ🍀」と短い見出し以外の普通の文は、自然な「。」「！」「？」で終える。ただし、文末に絵文字を添える普通の文では「。」を付けず、「ぼくはここにいるよ🍀」のようにする
- 冒頭か最後に、血糖とは関係のない日常の短いひと言を1文入れる。「ちょっとひと息つこうね」「好きな音をひとつ思い出すのもいいね」など、休息や気分転換のやさしい言葉にする
- 日常のひと言では健康効果や血糖への効果を断定せず、食事、運動、薬、サプリ、睡眠の助言をしない。季節、天気、居場所、時刻も作らない
- 丁寧語の「です」「ます」「でした」「ました」「あります」「ありません」「ください」「ましょう」「でしょう」は使わない
- 文末は「だよ」「だね」「見えているよ」「一緒に見ていこうね」など、グルコらしいやわらかい口調にする
- 連続する2文で「一緒に」を繰り返さない。直前の文で「一緒に」を使った場合、最後の文は別の言い方にする
- 「かも」はデータからの見立てが確かでないときだけ使い、呼びかけや提案の文末には使わない
- 「〜しようかも」「〜していこうかも」「〜見てみようかも」のような表現は使わない
- 「###」「##」「#」などのMarkdown見出しは使わない
- 区切りは、絵文字アイコン付きの短い見出しにする
  例: 🍀 全体の流れ / 📊 数字の手がかり / 🔎 気になった動き / 🌱 明日の小さな見返し
- 「これは${slotLabel}のテスト版だよ」「これは${slotLabel}の『${modeLabel}』だよ」のような説明文は書かない
- 時間帯ラベル「${slotLabel}」は、必要な時だけ自然に触れる。無理に入れない
- TIR、TAR、TBR、平均血糖、CVを、分かる範囲で具体的に扱う。GlucoScoreは非公開の書き方指示に従い、省略対象なら一切書かない
- 「うれしい手がかり」があるときは、早い段階で1つ以上を取り上げ、遠慮せず具体的に一緒に喜ぶ
- TIR 100％はTIRのきれいな流れとしてしっかり祝うが、ユニコーンの理由にはしない
- 「ユニコーン判定」を必ず守り、対象外ならユニコーンの言葉や🦄を使わない
- 対象の場合も「最新測定が100mg/dL」という独立した手がかりとして書き、TIRと同じ文や箇条書きで結びつけない
- 「悪くない」「完璧ではないけど」「ばらつきはゼロではないけど」「大きく乱れていない」のように、褒め言葉を弱めない
- TBR、TAR、CV、低めのTIR、GlucoScoreの変化に「も」「しか」「まだ」「残念ながら」「高すぎる」「低すぎる」「悪い」「問題」を結びつけない。数値は事実として伝える
- 「いたわり優先」が対象なら、提案より先に「大変な時間もあったかもしれないね」「今日はここまで、おつかれさま」のような、断定しすぎないいたわりを1文入れる
- 数値だけから努力や体調を決めつけず、「がんばりが足りない」「もっと頑張ろう」とは書かない
- 「TIRは94.1％！」のように数値だけを1行で強調せず、同じ文で意味をやさしく伝える
- 「いたわり優先」「対象」「通常」「非公開の書き方指示」など、内部の判定名や指示文を本文へ出さない
- 「平均の雰囲気」「景色」「戻りの力」「後から見る場所」「小さくまとまる動き」のような曖昧な比喩を使わない
- 比較値が明示されていないTIR、TAR、TBR、CVについて「増えた」「減った」「戻った」と推測しない
- TBRや低めの時間を「少し」「ちょっと」「わずか」と小さく扱わず、低めの時間を「安心材料」と呼ばない
- GMIは平均血糖から計算した参考値として事実だけを伝え、荒れ・穏やかさ・安定性をGMIから解釈しない。短い期間では必要なときだけ触れる
- 差分は事実だけを簡潔に伝え、「小さくまとまる動き」のような評価を足さない
- TBRの数値を「だから」「なので」で提案へつなげず、いたわりが必要な場合は提案より先に自然な労いを置く
- 前回との差分1点だけから「流れ」「動き」「傾向」を推測しない
- 同じ指標を別の見出しで繰り返さず、良い点も最初の説明文の中で一緒に伝える
- 「一定ぶん」「押さえられる」「1だけ高く見えている」「低め寄りにまとまっている」のような不自然な言い方を使わない
- 今日・昨日ではGMIを本文へ出さない。GlucoScoreは非公開の書き方指示が許可した場合だけ1回触れ、それ以外はしっかり分析でも完全に省略する
- 振り返りの提案と最後の呼びかけを二重にせず、似た意味の締めを1つだけにする
- TIR、TAR、TBR、CV、GlucoScoreを、明日の数値目標・改善課題・維持課題にしない
- 「目標の時間を増やす」「TBRを減らす」「数値を維持する」「改善する」「これだけ意識して進めよう」「目指そう」「できるようにしよう」のような指導表現を使わない
- 最後は行動課題ではなく、「今日の数字を急いで答えにしなくて大丈夫だよ」「余裕があるときに今日の流れをそっと振り返ってみようね」のような、理解を支える一文で締める
- 数字を採点、合否、成功・失敗として扱わない
- 入力欄の名前、英語の変数名、JSONキー、camelCase、内部処理の言葉を本文へ出さない
- キャッシュ表示される可能性があるため、「今」「現在」「たった今」などのリアルタイム断定を避ける
- 医療判断、診断、インスリン量、薬、ポンプ設定、デバイス設定の助言はしない
- 責めない、怖がらせない、急かさない
- 11〜17行くらい。短い見出しと箇条書きを中心に、やさしく自然に書く
- 最後の一文は「ぼくはここにいるよ🍀」「今日もあなたのそばにいるよ🍀」のような寄り添いを基本にする。振り返りを誘う場合も宿題のようにしない

集計済みサマリー:
${summaryText}`;
  }

  return `この集計済み血糖サマリーをもとに、グルコからの短くやさしい分析を1つ書いて。

条件:
- 最初は必ず「グルコだよ🍀」で始め、次の行に「来てくれてうれしいよ」などの短い挨拶を入れる。挨拶は同じ一文に固定しない
- 「グルコだよ🍀」と短い見出し以外の普通の文は、自然な「。」「！」「？」で終える。ただし、文末に絵文字を添える普通の文では「。」を付けず、「ぼくはここにいるよ🍀」のようにする
- 6〜9行くらいの短いお手紙にする
- 冒頭か最後に、血糖とは関係のない日常の短いひと言を1文入れる。「ちょっとひと息つこうね」「好きな音をひとつ思い出すのもいいね」など、休息や気分転換のやさしい言葉にする
- 日常のひと言では健康効果や血糖への効果を断定せず、食事、運動、薬、サプリ、睡眠の助言をしない。季節、天気、居場所、時刻も作らない
- 丁寧語の「です」「ます」「でした」「ました」「あります」「ありません」「ください」「ましょう」「でしょう」は使わない
- 文末は「だよ」「だね」「見えているよ」「一緒に見ていこうね」など、グルコらしいやわらかい口調にする
- 連続する2文で「一緒に」を繰り返さない。直前の文で「一緒に」を使った場合、最後の文は別の言い方にする
- 「かも」はデータからの見立てが確かでないときだけ使い、呼びかけや提案の文末には使わない
- 「〜しようかも」「〜していこうかも」「〜見てみようかも」のような表現は使わない
- 「これは${slotLabel}のテスト版だよ」「これは${slotLabel}の『${modeLabel}』だよ」のような説明文は書かない
- 時間帯ラベル「${slotLabel}」は、必要な時だけ自然に触れる。無理に入れない
- サマリーから見える具体的な手がかりを1〜3個だけ入れる
- 「うれしい手がかり」があるときは、早い段階で少なくとも1つを取り上げ、遠慮せず具体的に一緒に喜ぶ
- TIR 100％はTIRのきれいな流れとしてしっかり祝うが、ユニコーンの理由にはしない
- 「ユニコーン判定」を必ず守り、対象外ならユニコーンの言葉や🦄を使わない
- 対象の場合も「最新測定が100mg/dL」という独立した手がかりとして書き、TIRと同じ文や箇条書きで結びつけない
- 「悪くない」「完璧ではないけど」「ばらつきはゼロではないけど」「大きく乱れていない」のように、褒め言葉を弱めない
- TBR、TAR、CV、低めのTIR、GlucoScoreの変化に「も」「しか」「まだ」「残念ながら」「高すぎる」「低すぎる」「悪い」「問題」を結びつけない。数値は事実として伝える
- 「いたわり優先」が対象なら、提案より先に「大変な時間もあったかもしれないね」「今日はここまで、おつかれさま」のような、断定しすぎないいたわりを1文入れる
- 数値だけから努力や体調を決めつけず、「がんばりが足りない」「もっと頑張ろう」とは書かない
- 「TIRは94.1％！」のように数値だけを1行で強調せず、同じ文で意味をやさしく伝える
- 「いたわり優先」「対象」「通常」「非公開の書き方指示」など、内部の判定名や指示文を本文へ出さない
- 「平均の雰囲気」「景色」「戻りの力」「後から見る場所」「小さくまとまる動き」のような曖昧な比喩を使わない
- 比較値が明示されていないTIR、TAR、TBR、CVについて「増えた」「減った」「戻った」と推測しない
- TBRや低めの時間を「少し」「ちょっと」「わずか」と小さく扱わず、低めの時間を「安心材料」と呼ばない
- GMIは平均血糖から計算した参考値として事実だけを伝え、荒れ・穏やかさ・安定性をGMIから解釈しない。短い期間では必要なときだけ触れる
- 差分は事実だけを簡潔に伝え、「小さくまとまる動き」のような評価を足さない
- TBRの数値を「だから」「なので」で提案へつなげず、いたわりが必要な場合は提案より先に自然な労いを置く
- 前回との差分1点だけから「流れ」「動き」「傾向」を推測しない
- 同じ指標を別の見出しで繰り返さず、良い点も最初の説明文の中で一緒に伝える
- 「一定ぶん」「押さえられる」「1だけ高く見えている」「低め寄りにまとまっている」のような不自然な言い方を使わない
- 今日・昨日ではGMIを本文へ出さない。GlucoScoreは非公開の書き方指示が許可した場合だけ1回触れ、それ以外はしっかり分析でも完全に省略する
- 振り返りの提案と最後の呼びかけを二重にせず、似た意味の締めを1つだけにする
- TIR、TAR、TBR、CV、GlucoScoreを、明日の数値目標・改善課題・維持課題にしない
- 「目標の時間を増やす」「TBRを減らす」「数値を維持する」「改善する」「これだけ意識して進めよう」「目指そう」「できるようにしよう」のような指導表現を使わない
- 最後は行動課題ではなく、「今日の数字を急いで答えにしなくて大丈夫だよ」「余裕があるときに今日の流れをそっと振り返ってみようね」のような、理解を支える一文で締める
- 血糖値に触れる場合は「今の血糖」ではなく、「最新の測定では」または「${summary.latestMeasuredAt || "最新測定"}ごろの測定では」のように書く
- 入力欄の名前、英語の変数名、JSONキー、camelCase、内部処理の言葉を本文へ出さない
- キャッシュ表示される可能性があるため、「今」「現在」「たった今」などのリアルタイム断定を避ける
- 医療判断、診断、インスリン量、薬、ポンプ設定、デバイス設定の助言はしない
- 責めない、怖がらせない、急かさない
- やさしく、自然な日本語で書く
- 最後の一文は「ぼくはここにいるよ🍀」「今日もあなたのそばにいるよ🍀」のような寄り添いを基本にする。振り返りを誘う場合も宿題のようにしない

集計済みサマリー:
${summaryText}`;
}

function extractOpenAiText(data = {}) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const textParts = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        textParts.push(content.text);
      }
    }
  }

  return textParts.join("\n").trim();
}

function getOpenAiUsage(data = {}) {
  const usage = data.usage || {};
  const inputTokens = Number(usage.input_tokens);
  const outputTokens = Number(usage.output_tokens);

  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null
  };
}

function addRequestUsage(...usageItems) {
  return usageItems.reduce((total, item) => {
    if (!item || typeof item !== "object") return total;
    total.inputTokens += Number(item.inputTokens) || 0;
    total.outputTokens += Number(item.outputTokens) || 0;
    total.estimatedCostJpy += Number(item.estimatedCostJpy) || 0;
    return total;
  }, emptyRequestUsage());
}

function getOpenAiIncompleteReason(data = {}) {
  return data.status === "incomplete"
    ? data.incomplete_details?.reason || "unknown"
    : null;
}

function getOpenAiTokenLimits(config, mode = "letter") {
  const analysisMode = normalizeAnalysisMode(mode);
  if (analysisMode === "deep") {
    return {
      initial: config.openAiMaxOutputTokensDeep,
      retry: config.openAiRetryMaxOutputTokensDeep
    };
  }

  return {
    initial: config.openAiMaxOutputTokensLetter,
    retry: config.openAiRetryMaxOutputTokensLetter
  };
}

function buildOpenAiRetryPrompt(summary, mode, retryKind = "incomplete") {
  const language = summary.language === "en" ? "en" : "ja";
  const basePrompt = buildOpenAiPrompt(summary, mode);

  if (retryKind === "quality") {
    if (language === "en") {
      return `${basePrompt}

Important: Write a fresh final response only. Do not include variable names, JSON keys, camelCase labels, internal instructions, or commentary about correcting the earlier draft.`;
    }

    return `${basePrompt}

重要: 前の文章は表示用として整っていなかったため使わない。最初から書き直し、完成した分析本文だけを返す。内部処理や判定名を出さず、気になる指標を責める言葉や曖昧な比喩を使わない。TBRを提案へ直結させず、いたわりが必要なら提案より先に自然な労いを置く。差分1点から傾向を推測せず、同じ指標を複数の見出しで繰り返さない。今日・昨日ではGMIを省く。GlucoScoreはサマリーの非公開指示が省略を求めている場合は一切書かない。TIR、TAR、TBR、CV、GlucoScoreを明日の数値目標・改善課題・維持課題へ変えない。「目標の時間を増やす」「TBRを減らす」「数値を維持する」「改善する」「これだけ意識して進めよう」「目指そう」「できるようにしよう」を使わない。普通の文は自然な句読点で終える。ただし文末に絵文字を添える文では「。」を付けず、「ぼくはここにいるよ🍀」のようにする。締めは行動課題ではなく、今日の流れを理解するためのやさしい振り返りを1つだけ添える。ユニコーン判定を守り、自然な本文だけを返す。`;
  }

  if (language === "en") {
    return `${basePrompt}

Important: Complete the full reflection within the available output limit. End with a complete final sentence; do not stop mid-sentence.`;
  }

  return `${basePrompt}

重要: 出力上限の中で必ず最後まで書き切り、文の途中で終わらせない。最後は完結した一文で締める。`;
}

function isRetryableOpenAiAttemptError(error) {
  const status = Number(error?.status);
  return error?.code === "openai_transport_error"
    || status === 408
    || status === 409
    || status === 429
    || status >= 500;
}

function createRequestAbortError() {
  const error = new Error("AI letter request was aborted.");
  error.name = "AbortError";
  error.code = "request_aborted";
  return error;
}

function throwIfRequestAborted(signal) {
  if (signal?.aborted) throw createRequestAbortError();
}

async function waitForOpenAiRetry(signal, milliseconds = 250) {
  throwIfRequestAborted(signal);
  await new Promise((resolve, reject) => {
    let timeoutId;
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(createRequestAbortError());
    };
    timeoutId = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
  throwIfRequestAborted(signal);
}

async function callOpenAiAttemptOnce({ summary, env, config, mode, maxOutputTokens, retryKind = "", signal }) {
  throwIfRequestAborted(signal);
  const model = config.openAiModel;
  const language = summary.language === "en" ? "en" : "ja";
  const input = retryKind
    ? buildOpenAiRetryPrompt(summary, mode, retryKind)
    : buildOpenAiPrompt(summary, mode);

  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        instructions: buildOpenAiInstructions(language, mode, summary),
        input,
        max_output_tokens: maxOutputTokens,
        tool_choice: "none",
        store: false
      }),
      ...(signal ? { signal } : {})
    });
  } catch (cause) {
    if (cause?.name === "AbortError" || cause?.code === "request_aborted" || signal?.aborted) {
      throw createRequestAbortError();
    }
    const error = new Error("OpenAI request could not be completed.", { cause });
    error.code = "openai_transport_error";
    throw error;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `OpenAI returned ${response.status}`);
    error.code = "openai_api_error";
    error.status = response.status;
    throw error;
  }

  const text = normalizeGeneratedLetterPunctuation(extractOpenAiText(data), language);
  const openAiUsage = getOpenAiUsage(data);
  const inputTokens = openAiUsage.inputTokens ?? estimateInputTokens(summary);
  const outputTokens = openAiUsage.outputTokens ?? estimateOutputTokens(text);

  return {
    text,
    incompleteReason: getOpenAiIncompleteReason(data),
    maxOutputTokens,
    usage: {
      inputTokens,
      outputTokens,
      estimatedCostJpy: estimateCostJpy({
        inputTokens,
        outputTokens,
        config
      })
    }
  };
}

async function callOpenAiAttempt(input) {
  const attemptUsage = [];

  try {
    const result = await callOpenAiAttemptOnce(input);
    attemptUsage.push(result.usage);
    return result;
  } catch (error) {
    attemptUsage.push(error.usage);
    if (!isRetryableOpenAiAttemptError(error)) {
      error.usage = addRequestUsage(...attemptUsage);
      throw error;
    }
  }

  await waitForOpenAiRetry(input.signal, 250);
  try {
    const result = await callOpenAiAttemptOnce(input);
    result.usage = addRequestUsage(...attemptUsage, result.usage);
    return result;
  } catch (error) {
    error.usage = addRequestUsage(...attemptUsage, error.usage);
    throw error;
  }
}

function createIncompleteOutputError({ mode, incompleteReason, attempts, maxOutputTokens, usage }) {
  const error = new Error("OpenAI response was incomplete and was not accepted.");
  error.code = "openai_incomplete_output";
  error.analysisMode = normalizeAnalysisMode(mode);
  error.incompleteReason = incompleteReason || "unknown";
  error.attempts = attempts;
  error.maxOutputTokens = maxOutputTokens;
  error.usage = usage;
  return error;
}

function createOutputQualityError({ mode, issues, attempts, maxOutputTokens, usage }) {
  const error = new Error("OpenAI response did not meet the Gluco wording quality rules and was not accepted.");
  error.code = "openai_output_quality_failed";
  error.analysisMode = normalizeAnalysisMode(mode);
  error.qualityIssues = Array.isArray(issues) ? issues : [];
  error.attempts = attempts;
  error.maxOutputTokens = maxOutputTokens;
  error.usage = usage;
  return error;
}

function buildAcceptedOpenAiResult({
  text,
  model,
  attempts,
  retriedAfterIncomplete,
  initialIncompleteReason,
  maxOutputTokens,
  usage
}) {
  return {
    text,
    provider: "openai",
    model,
    attempts,
    retriedAfterIncomplete,
    initialIncompleteReason,
    maxOutputTokens,
    usage
  };
}

async function callOpenAiLetter({ summary, env, config, mode = "letter", signal }) {
  throwIfRequestAborted(signal);
  if (!env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY");
    error.code = "missing_openai_api_key";
    throw error;
  }

  const model = config.openAiModel;
  const analysisMode = normalizeAnalysisMode(mode);
  const language = summary.language === "en" ? "en" : "ja";
  const limits = getOpenAiTokenLimits(config, analysisMode);
  const metrics = summary.metrics || {};
  const tir = Number(metrics.tir);
  const tbr = Number(metrics.tbr);
  const scorePolicy = getGlucoScoreMentionPolicy(summary);
  const qualityOptions = {
    allowUnicorn: isUnicornEligibleSummary(summary),
    analysisMode,
    period: summary.period,
    compassionRequired: (Number.isFinite(tbr) && tbr >= 1) || (Number.isFinite(tir) && tir <= 70),
    suppressGlucoScore: !scorePolicy.mention
  };
  const firstAttempt = await callOpenAiAttempt({
    summary,
    env,
    config,
    signal,
    mode: analysisMode,
    maxOutputTokens: limits.initial
  });

  if (firstAttempt.incompleteReason) {
    if (firstAttempt.incompleteReason !== "max_output_tokens") {
      throw createIncompleteOutputError({
        mode: analysisMode,
        incompleteReason: firstAttempt.incompleteReason,
        attempts: 1,
        maxOutputTokens: limits.initial,
        usage: firstAttempt.usage
      });
    }

    let retryAttempt;
    try {
      retryAttempt = await callOpenAiAttempt({
        summary,
        env,
        config,
        signal,
        mode: analysisMode,
        maxOutputTokens: limits.retry,
        retryKind: "incomplete"
      });
    } catch (error) {
      error.usage = addRequestUsage(firstAttempt.usage, error.usage);
      error.retryAttempted = true;
      error.analysisMode = analysisMode;
      error.attempts = 2;
      error.maxOutputTokens = limits.retry;
      error.initialIncompleteReason = firstAttempt.incompleteReason;
      throw error;
    }

    const combinedUsage = addRequestUsage(firstAttempt.usage, retryAttempt.usage);
    if (retryAttempt.incompleteReason || !retryAttempt.text) {
      throw createIncompleteOutputError({
        mode: analysisMode,
        incompleteReason: retryAttempt.incompleteReason || "empty_output",
        attempts: 2,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    const retryQualityIssues = getGeneratedLetterQualityIssues(retryAttempt.text, language, qualityOptions);
    const retryQualityAssessment = partitionGeneratedLetterQualityIssues(retryQualityIssues);
    if (retryQualityAssessment.blockingIssues.length) {
      throw createOutputQualityError({
        mode: analysisMode,
        issues: retryQualityIssues,
        attempts: 2,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    return buildAcceptedOpenAiResult({
      text: retryAttempt.text,
      model,
      attempts: 2,
      retriedAfterIncomplete: true,
      initialIncompleteReason: firstAttempt.incompleteReason,
      maxOutputTokens: limits.retry,
      usage: combinedUsage
    });
  }

  if (!firstAttempt.text) {
    let emptyRetry;
    try {
      emptyRetry = await callOpenAiAttempt({
        summary,
        env,
        config,
        signal,
        mode: analysisMode,
        maxOutputTokens: limits.retry,
        retryKind: "incomplete"
      });
    } catch (error) {
      error.usage = addRequestUsage(firstAttempt.usage, error.usage);
      error.retryAttempted = true;
      error.analysisMode = analysisMode;
      error.attempts = 2;
      error.maxOutputTokens = limits.retry;
      throw error;
    }

    const combinedUsage = addRequestUsage(firstAttempt.usage, emptyRetry.usage);
    if (emptyRetry.incompleteReason || !emptyRetry.text) {
      throw createIncompleteOutputError({
        mode: analysisMode,
        incompleteReason: emptyRetry.incompleteReason || "empty_output",
        attempts: 2,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    const emptyRetryQualityIssues = getGeneratedLetterQualityIssues(emptyRetry.text, language, qualityOptions);
    const emptyRetryQualityAssessment = partitionGeneratedLetterQualityIssues(emptyRetryQualityIssues);
    if (emptyRetryQualityAssessment.blockingIssues.length) {
      throw createOutputQualityError({
        mode: analysisMode,
        issues: emptyRetryQualityIssues,
        attempts: 2,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    return buildAcceptedOpenAiResult({
      text: emptyRetry.text,
      model,
      attempts: 2,
      retriedAfterIncomplete: false,
      initialIncompleteReason: null,
      maxOutputTokens: limits.retry,
      usage: combinedUsage
    });
  }

  const firstQualityIssues = getGeneratedLetterQualityIssues(firstAttempt.text, language, qualityOptions);
  if (!firstQualityIssues.length) {
    return buildAcceptedOpenAiResult({
      text: firstAttempt.text,
      model,
      attempts: 1,
      retriedAfterIncomplete: false,
      initialIncompleteReason: null,
      maxOutputTokens: limits.initial,
      usage: firstAttempt.usage
    });
  }

  const firstQualityAssessment = partitionGeneratedLetterQualityIssues(firstQualityIssues);
  const canUseSafeFirstAttempt = (
    firstQualityAssessment.blockingIssues.length === 0
    && firstQualityAssessment.softWarnings.length > 0
  );

  let qualityRetry;
  try {
    qualityRetry = await callOpenAiAttempt({
      summary,
      env,
      config,
      signal,
      mode: analysisMode,
      maxOutputTokens: limits.retry,
      retryKind: "quality"
    });
  } catch (error) {
    const combinedUsage = addRequestUsage(firstAttempt.usage, error.usage);
    if (canUseSafeFirstAttempt) {
      return buildAcceptedOpenAiResult({
        text: firstAttempt.text,
        model,
        attempts: 2,
        retriedAfterIncomplete: false,
        initialIncompleteReason: null,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    error.usage = combinedUsage;
    error.retryAttempted = true;
    error.analysisMode = analysisMode;
    error.attempts = 2;
    error.maxOutputTokens = limits.retry;
    throw error;
  }

  const combinedUsage = addRequestUsage(firstAttempt.usage, qualityRetry.usage);
  if (qualityRetry.incompleteReason || !qualityRetry.text) {
    if (canUseSafeFirstAttempt) {
      return buildAcceptedOpenAiResult({
        text: firstAttempt.text,
        model,
        attempts: 2,
        retriedAfterIncomplete: false,
        initialIncompleteReason: null,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    throw createIncompleteOutputError({
      mode: analysisMode,
      incompleteReason: qualityRetry.incompleteReason || "empty_output",
      attempts: 2,
      maxOutputTokens: limits.retry,
      usage: combinedUsage
    });
  }

  const retryQualityIssues = getGeneratedLetterQualityIssues(qualityRetry.text, language, qualityOptions);
  const retryQualityAssessment = partitionGeneratedLetterQualityIssues(retryQualityIssues);
  if (retryQualityAssessment.blockingIssues.length) {
    if (canUseSafeFirstAttempt) {
      return buildAcceptedOpenAiResult({
        text: firstAttempt.text,
        model,
        attempts: 2,
        retriedAfterIncomplete: false,
        initialIncompleteReason: null,
        maxOutputTokens: limits.retry,
        usage: combinedUsage
      });
    }

    throw createOutputQualityError({
      mode: analysisMode,
      issues: retryQualityIssues,
      attempts: 2,
      maxOutputTokens: limits.retry,
      usage: combinedUsage
    });
  }

  return buildAcceptedOpenAiResult({
    text: qualityRetry.text,
    model,
    attempts: 2,
    retriedAfterIncomplete: false,
    initialIncompleteReason: null,
    maxOutputTokens: limits.retry,
    usage: combinedUsage
  });
}

async function generateLetter({ summary, payload, env, config, status, signal }) {
  const analysisMode = getAnalysisMode(payload, summary);

  if (status === "cached" || config.provider !== "openai") {
    const text = buildPrototypeLetter(summary, analysisMode);
    const inputTokens = estimateInputTokens(summary);
    const outputTokens = estimateOutputTokens(text);

    return {
      text,
      provider: "none",
      model: "prototype-fixed-letter",
      usage: status === "cached"
        ? emptyRequestUsage()
        : {
            inputTokens,
            outputTokens,
            estimatedCostJpy: estimateCostJpy({
              inputTokens,
              outputTokens,
              config
            })
          }
    };
  }

  return callOpenAiLetter({
    summary,
    env,
    config,
    mode: analysisMode,
    signal
  });
}

function buildUsagePayload({ state, requestUsage, config, summary = {} }) {
  ensureSlotCounters(state);

  const slotKey = normalizeSlot(summary.slot);
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);
  const monthlyEstimatedCostJpy = Number(state.estimatedCostJpy.toFixed(4));
  const budgetUsageRate = config.monthlyBudgetJpy > 0
    ? Number((monthlyEstimatedCostJpy / config.monthlyBudgetJpy * 100).toFixed(2))
    : 0;

  return {
    inputTokens: requestUsage.inputTokens,
    outputTokens: requestUsage.outputTokens,
    estimatedCostJpy: requestUsage.estimatedCostJpy,
    totalInputTokens: state.inputTokens,
    totalOutputTokens: state.outputTokens,
    dailyGenerationCount: state.dailyGenerationCount,
    dailyCacheHitCount: state.dailyCacheHitCount,
    dailyModeGenerationCounts: state.dailyModeGenerationCounts,
    dailyModeCacheHitCounts: state.dailyModeCacheHitCounts,
    dailySlotGenerationCounts: state.dailySlotGenerationCounts,
    dailySlotCacheHitCounts: state.dailySlotCacheHitCounts,
    dailyModeSlotGenerationCounts: state.dailyModeSlotGenerationCounts,
    dailyModeSlotCacheHitCounts: state.dailyModeSlotCacheHitCounts,
    activeMode: {
      key: analysisMode,
      label: getAnalysisModeLabel(analysisMode, summary.language === "en" ? "en" : "ja"),
      generationCount: state.dailyModeGenerationCounts[analysisMode] || 0,
      cacheHitCount: state.dailyModeCacheHitCounts[analysisMode] || 0
    },
    activeSlot: {
      key: slotKey,
      label: getSlotLabel(summary, summary.language === "en" ? "en" : "ja"),
      generationCount: getModeSlotCount(state, analysisMode, slotKey),
      cacheHitCount: getModeSlotCount(state, analysisMode, slotKey, "dailyModeSlotCacheHitCounts"),
      aggregateGenerationCount: state.dailySlotGenerationCounts[slotKey] || 0,
      aggregateCacheHitCount: state.dailySlotCacheHitCounts[slotKey] || 0
    },
    monthlyGenerationCount: state.monthlyGenerationCount,
    monthlyCacheHitCount: state.monthlyCacheHitCount,
    monthlyEstimatedCostJpy,
    monthlyBudgetJpy: config.monthlyBudgetJpy,
    budgetUsageRate,
    currency: "JPY",
    dayKey: state.dayKey,
    monthKey: state.monthKey,
    storage: state.kind
  };
}

function getTurnstileToken(payload = {}) {
  return payload.turnstileToken || payload?.turnstile?.token || "";
}

async function verifyTurnstileToken({ payload, request, env, config }) {
  if (!config.turnstileRequired) {
    return {
      required: false,
      verified: false,
      skipped: true
    };
  }

  const token = getTurnstileToken(payload);
  if (!token) {
    return {
      required: true,
      verified: false,
      skipped: false,
      code: "missing_turnstile_token",
      message: "Missing Turnstile token."
    };
  }

  if (!env.TURNSTILE_SECRET_KEY) {
    return {
      required: true,
      verified: false,
      skipped: false,
      code: "missing_turnstile_secret",
      message: "Missing TURNSTILE_SECRET_KEY."
    };
  }

  const formData = new URLSearchParams();
  formData.append("secret", env.TURNSTILE_SECRET_KEY);
  formData.append("response", token);

  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) formData.append("remoteip", remoteIp);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || !isExpectedTurnstileResult(result, env)) {
      return {
        required: true,
        verified: false,
        skipped: false,
        code: "turnstile_failed",
        message: "Turnstile verification failed.",
        details: {
          errorCodes: result["error-codes"] || []
        }
      };
    }

    return {
      required: true,
      verified: true,
      skipped: false,
      challengeTs: result.challenge_ts || null,
      hostname: result.hostname || null
    };
  } catch (error) {
    return {
      required: true,
      verified: false,
      skipped: false,
      code: "turnstile_unavailable",
      message: error.message || "Turnstile verification request failed."
    };
  }
}

function buildTurnstileError(turnstileVerification = {}) {
  return {
    code: "turnstile_failed",
    message: turnstileVerification.message || "Turnstile verification failed.",
    userMessage: "AI分析の安全確認がうまくいきませんでした。少し時間をおいて、もう一度試してください🍀",
    retryable: true,
    details: {
      reason: turnstileVerification.code || "turnstile_failed",
      turnstile: {
        required: true,
        verified: false,
        skipped: false
      },
      provider: "cloudflare-turnstile",
      ...(turnstileVerification.details || {})
    }
  };
}

function getModeSlotCount(state, mode, slot, field = "dailyModeSlotGenerationCounts") {
  ensureSlotCounters(state);
  const normalizedMode = normalizeAnalysisMode(mode);
  const normalizedSlot = normalizeSlot(slot);
  return state[field]?.[normalizedMode]?.[normalizedSlot] || 0;
}

function incrementModeCount(state, field, mode, amount = 1) {
  ensureSlotCounters(state);
  const normalizedMode = normalizeAnalysisMode(mode);
  state[field][normalizedMode] = (state[field][normalizedMode] || 0) + amount;
}

function incrementModeSlotCount(state, field, mode, slot, amount = 1) {
  ensureSlotCounters(state);
  const normalizedMode = normalizeAnalysisMode(mode);
  const normalizedSlot = normalizeSlot(slot);
  state[field][normalizedMode][normalizedSlot] = (state[field][normalizedMode][normalizedSlot] || 0) + amount;
}

function buildSlotRemainingCounts(state, config) {
  ensureSlotCounters(state);

  return {
    morning: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.morning || 0)),
    afternoon: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.afternoon || 0)),
    night: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.night || 0)),
    unknown: Math.max(0, config.slotGenerationLimit - (state.dailySlotGenerationCounts.unknown || 0))
  };
}

function buildModeSlotRemainingCounts(state, config) {
  ensureSlotCounters(state);

  if (!config.sharedCountLimitsEnabled) return null;

  const remaining = {};
  for (const mode of ANALYSIS_MODE_KEYS) {
    remaining[mode] = {};
    for (const slot of [...LETTER_SLOT_KEYS, "unknown"]) {
      const aggregateSlotCount = state.dailySlotGenerationCounts[slot] || 0;
      remaining[mode][slot] = Math.max(0, config.slotGenerationLimit - aggregateSlotCount);
    }
  }
  return remaining;
}

function isAnyModeSlotRateLimited(state, config) {
  ensureSlotCounters(state);
  if (!config.sharedCountLimitsEnabled) return false;
  return Object.values(state.dailySlotGenerationCounts || {}).some((count) => count >= config.slotGenerationLimit);
}

function buildGuardPayload({ state, config, budgetBlocked = false, summary = {}, turnstileVerification = {} }) {
  ensureSlotCounters(state);

  const slotKey = normalizeSlot(summary.slot);
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);
  const slotGenerationCount = state.dailySlotGenerationCounts[slotKey] || 0;
  const modeSlotGenerationCount = getModeSlotCount(state, analysisMode, slotKey);
  const monthlyEstimatedCostJpy = Number(state.estimatedCostJpy.toFixed(4));
  const budgetWarning = monthlyEstimatedCostJpy >= config.warningBudgetJpy;
  const dailyGenerationRemaining = config.sharedCountLimitsEnabled
    ? Math.max(0, config.dailyGenerationLimit - state.dailyGenerationCount)
    : null;
  const slotGenerationRemaining = config.sharedCountLimitsEnabled
    ? Math.max(0, config.slotGenerationLimit - slotGenerationCount)
    : null;
  const totalRateLimited = config.sharedCountLimitsEnabled
    && state.dailyGenerationCount >= config.dailyGenerationLimit;
  const slotRateLimited = config.sharedCountLimitsEnabled
    && slotGenerationCount >= config.slotGenerationLimit;

  return {
    turnstileRequired: config.turnstileRequired,
    turnstileVerified: Boolean(turnstileVerification.verified),
    rateLimited: totalRateLimited || slotRateLimited,
    totalRateLimited,
    slotRateLimited,
    budgetBlocked,
    budgetWarning,
    aiEnabled: config.aiEnabled,
    sharedCountLimitsEnabled: config.sharedCountLimitsEnabled,
    dailyGenerationLimit: config.sharedCountLimitsEnabled ? config.dailyGenerationLimit : null,
    dailyGenerationRemaining,
    slotGenerationLimit: config.sharedCountLimitsEnabled ? config.slotGenerationLimit : null,
    slotGenerationRemaining,
    activeMode: {
      key: analysisMode,
      label: getAnalysisModeLabel(analysisMode, summary.language === "en" ? "en" : "ja"),
      generationCount: state.dailyModeGenerationCounts[analysisMode] || 0
    },
    activeSlot: {
      key: slotKey,
      label: getSlotLabel(summary, summary.language === "en" ? "en" : "ja"),
      generationCount: slotGenerationCount,
      modeGenerationCount: modeSlotGenerationCount,
      aggregateGenerationCount: slotGenerationCount
    },
    dailyModeGenerationCounts: state.dailyModeGenerationCounts,
    dailySlotGenerationCounts: state.dailySlotGenerationCounts,
    dailyModeSlotGenerationCounts: state.dailyModeSlotGenerationCounts,
    modeSlotGenerationRemainingBySlot: buildModeSlotRemainingCounts(state, config),
    monthlyBudgetJpy: config.monthlyBudgetJpy,
    warningBudgetJpy: config.warningBudgetJpy,
    stopBudgetJpy: config.stopBudgetJpy,
    monthlyEstimatedCostJpy
  };
}

function buildSuccessPayload({
  summary,
  payload,
  status,
  usageState,
  requestUsage,
  config,
  generationResult,
  turnstileVerification = {},
  cacheResult = {},
  cacheFallbackReason = null,
  quotaPayload = null
}) {
  const cached = status === "cached";
  const servedFromSharedCache = cached && Boolean(cacheResult?.entry);
  const generatedAt = generationResult.generatedAt || cacheResult?.timing?.generatedAt || new Date().toISOString();
  const source = servedFromSharedCache
    ? "cloudflare-kv"
    : generationResult.provider === "approved-demo-sample"
      ? "approved-demo-sample"
    : generationResult.provider === "openai"
      ? "openai"
      : "prototype-worker";
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);
  const language = summary.language === "en" ? "en" : "ja";

  return {
    status,
    source,
    clientMode: getClientMode(payload),
    ...(quotaPayload ? { quota: quotaPayload } : {}),
    letter: {
      text: generationResult.text,
      language,
      analysisMode,
      mode: {
        key: analysisMode,
        label: getAnalysisModeLabel(analysisMode, language)
      },
      generatedAt,
      provider: generationResult.provider,
      model: generationResult.model,
      cached,
      cacheKey: cacheResult.key || null,
      slot: {
        key: normalizeSlot(summary.slot),
        label: getSlotLabel(summary, summary.language === "en" ? "en" : "ja")
      }
    },
    generation: {
      complete: true,
      attempts: Number(generationResult.attempts) || 0,
      retriedAfterIncomplete: Boolean(generationResult.retriedAfterIncomplete),
      initialIncompleteReason: generationResult.initialIncompleteReason || null,
      maxOutputTokens: Number(generationResult.maxOutputTokens) || null
    },
    cache: buildCachePayload({
      cacheResult,
      config,
      fallbackReason: cacheFallbackReason
    }),
    usage: buildUsagePayload({
      state: usageState,
      requestUsage,
      config,
      summary
    }),
    guard: buildGuardPayload({
      state: usageState,
      config,
      budgetBlocked: cacheFallbackReason === "budget_stopped",
      summary,
      turnstileVerification
    })
  };
}

function buildPrototypeCacheKey(summary = {}) {
  return [
    summary.pageMode || "unknown-page",
    summary.period || "unknown-period",
    normalizeSlot(summary.slot),
    normalizeAnalysisMode(summary.analysisMode),
    summary.rangeLabel || "unknown-range"
  ].join(":");
}

function buildRateLimitedUserMessage({ summary = {}, reason = "total" }) {
  const language = summary.language === "en" ? "en" : "ja";
  const slotLabel = getSlotLabel(summary, language);
  if (language === "en") {
    if (reason === "slot") {
      return `Today's new ${slotLabel} reflections have reached their shared limit. The reflection on screen stays available, and the ChatGPT copy feature still works 🍀`;
    }

    return "Today's new AI reflections have reached the limit. The reflection on screen stays available, and the ChatGPT copy feature still works 🍀";
  }

  if (reason === "slot") {
    return `今日の新しい${slotLabel}は共通上限に達しました。表示中または保存済みの振り返りはそのまま読めます。ChatGPTコピー機能も使えます🍀`;
  }

  return "今日の新しいAI振り返りは上限に達しました。表示中または保存済みの振り返りはそのまま読めます。ChatGPTコピー機能も使えます🍀";
}

function buildGuardError(status, {
  usageState,
  config,
  payload,
  summary = {},
  reason = "manual",
  turnstileVerification = {},
  recordEvent = true
}) {
  ensureSlotCounters(usageState);
  const slotKey = normalizeSlot(summary.slot);
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);

  if (status === "rate_limited") {
    if (recordEvent) {
      usageState.dailyRateLimitedCount += 1;
      usageState.dailySlotRateLimitedCounts[slotKey] = (usageState.dailySlotRateLimitedCounts[slotKey] || 0) + 1;
      incrementModeCount(usageState, "dailyModeRateLimitedCounts", analysisMode);
      incrementModeSlotCount(usageState, "dailyModeSlotRateLimitedCounts", analysisMode, slotKey);
      usageState.updatedAt = new Date().toISOString();
    }

    return {
      code: "rate_limited",
      message: reason === "slot" ? "Daily AI generation limit reached for this slot." : "Daily AI generation limit reached.",
      userMessage: buildRateLimitedUserMessage({ summary, reason }),
      retryable: false,
      status: 429,
      details: {
        reason,
        usage: buildUsagePayload({ state: usageState, requestUsage: emptyRequestUsage(), config, summary }),
        guard: buildGuardPayload({ state: usageState, config, budgetBlocked: false, summary, turnstileVerification }),
        clientMode: getClientMode(payload)
      }
    };
  }

  if (status === "budget_stopped") {
    if (recordEvent) {
      usageState.monthlyBudgetBlockedCount += 1;
      usageState.updatedAt = new Date().toISOString();
    }

    return {
      code: "budget_stopped",
      message: "Monthly AI budget guard is active.",
      userMessage: "今月のAI分析は利用上限に近づいたため、新しいお手紙を少しお休みしています。",
      retryable: false,
      status: 402,
      details: {
        usage: buildUsagePayload({ state: usageState, requestUsage: emptyRequestUsage(), config, summary }),
        guard: buildGuardPayload({ state: usageState, config, budgetBlocked: true, summary, turnstileVerification }),
        clientMode: getClientMode(payload)
      }
    };
  }

  if (status === "ai_disabled") {
    if (recordEvent) {
      usageState.monthlyAiDisabledCount += 1;
      usageState.updatedAt = new Date().toISOString();
    }

    return {
      code: "ai_disabled",
      message: "AI generation is currently disabled.",
      userMessage: "AI分析はただいまお休み中です。いつものグルコのお話とChatGPTコピー機能は使えます🍀",
      retryable: false,
      status: 503,
      details: {
        usage: buildUsagePayload({ state: usageState, requestUsage: emptyRequestUsage(), config, summary }),
        guard: buildGuardPayload({ state: usageState, config, budgetBlocked: false, summary, turnstileVerification }),
        clientMode: getClientMode(payload)
      }
    };
  }

  return null;
}

function emptyRequestUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostJpy: 0
  };
}

function recordTurnstileVerification({ usageState, config, turnstileVerification }) {
  if (!config.turnstileRequired) return;

  if (turnstileVerification?.verified) {
    usageState.dailyTurnstileVerifiedCount = (usageState.dailyTurnstileVerifiedCount || 0) + 1;
    usageState.monthlyTurnstileVerifiedCount = (usageState.monthlyTurnstileVerifiedCount || 0) + 1;
  } else {
    usageState.dailyTurnstileFailedCount = (usageState.dailyTurnstileFailedCount || 0) + 1;
    usageState.monthlyTurnstileFailedCount = (usageState.monthlyTurnstileFailedCount || 0) + 1;
  }

  usageState.updatedAt = new Date().toISOString();
}

function getGuardBlock({ status, usageState, config, summary = {} }) {
  if (status === "cached") return null;
  if (!config.aiEnabled) return { status: "ai_disabled", reason: "ai_disabled" };
  if (usageState.estimatedCostJpy >= config.stopBudgetJpy) return { status: "budget_stopped", reason: "budget" };
  if (!config.sharedCountLimitsEnabled) return null;
  if (usageState.dailyGenerationCount >= config.dailyGenerationLimit) return { status: "rate_limited", reason: "total" };

  const slotKey = normalizeSlot(summary.slot);
  const slotGenerationCount = usageState.dailySlotGenerationCounts[slotKey] || 0;
  if (slotGenerationCount >= config.slotGenerationLimit) {
    return { status: "rate_limited", reason: "slot" };
  }

  return null;
}

function recordProviderUsage({ usageState, requestUsage }) {
  const usage = requestUsage || emptyRequestUsage();
  usageState.inputTokens += Number(usage.inputTokens) || 0;
  usageState.outputTokens += Number(usage.outputTokens) || 0;
  usageState.estimatedCostJpy = Number((
    usageState.estimatedCostJpy + (Number(usage.estimatedCostJpy) || 0)
  ).toFixed(4));
  usageState.updatedAt = new Date().toISOString();
}

function recordSuccess({ usageState, status, requestUsage, summary = {} }) {
  ensureSlotCounters(usageState);
  const slotKey = normalizeSlot(summary.slot);
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);

  if (status === "cached") {
    usageState.dailyCacheHitCount += 1;
    usageState.monthlyCacheHitCount += 1;
    usageState.dailySlotCacheHitCounts[slotKey] = (usageState.dailySlotCacheHitCounts[slotKey] || 0) + 1;
    incrementModeCount(usageState, "dailyModeCacheHitCounts", analysisMode);
    incrementModeCount(usageState, "monthlyModeCacheHitCounts", analysisMode);
    incrementModeSlotCount(usageState, "dailyModeSlotCacheHitCounts", analysisMode, slotKey);
  } else {
    usageState.dailyGenerationCount += 1;
    usageState.monthlyGenerationCount += 1;
    usageState.dailySlotGenerationCounts[slotKey] = (usageState.dailySlotGenerationCounts[slotKey] || 0) + 1;
    incrementModeCount(usageState, "dailyModeGenerationCounts", analysisMode);
    incrementModeCount(usageState, "monthlyModeGenerationCounts", analysisMode);
    incrementModeSlotCount(usageState, "dailyModeSlotGenerationCounts", analysisMode, slotKey);
    usageState.inputTokens += requestUsage.inputTokens;
    usageState.outputTokens += requestUsage.outputTokens;
    usageState.estimatedCostJpy = Number((usageState.estimatedCostJpy + requestUsage.estimatedCostJpy).toFixed(4));
  }

  usageState.updatedAt = new Date().toISOString();
}

function buildUsageReport({ state, config, cacheAvailable = false, publicUserUsage }) {
  ensureSlotCounters(state);

  return {
    status: "usage",
    source: state.kind === "durable-object-sqlite" ? "cloudflare-durable-object" : "worker-fallback",
    report: {
      today: {
        dayKey: state.dayKey,
        aiGenerationCount: state.dailyGenerationCount,
        cacheHitCount: state.dailyCacheHitCount,
        rateLimitedCount: state.dailyRateLimitedCount,
        turnstileVerifiedCount: state.dailyTurnstileVerifiedCount || 0,
        turnstileFailedCount: state.dailyTurnstileFailedCount || 0,
        modeGenerationCounts: state.dailyModeGenerationCounts,
        modeCacheHitCounts: state.dailyModeCacheHitCounts,
        modeRateLimitedCounts: state.dailyModeRateLimitedCounts,
        slotGenerationCounts: state.dailySlotGenerationCounts,
        slotCacheHitCounts: state.dailySlotCacheHitCounts,
        slotRateLimitedCounts: state.dailySlotRateLimitedCounts,
        modeSlotGenerationCounts: state.dailyModeSlotGenerationCounts,
        modeSlotCacheHitCounts: state.dailyModeSlotCacheHitCounts,
        modeSlotRateLimitedCounts: state.dailyModeSlotRateLimitedCounts,
        slotGenerationLimit: config.sharedCountLimitsEnabled ? config.slotGenerationLimit : null
      },
      month: {
        monthKey: state.monthKey,
        aiGenerationCount: state.monthlyGenerationCount,
        cacheHitCount: state.monthlyCacheHitCount,
        budgetBlockedCount: state.monthlyBudgetBlockedCount,
        aiDisabledCount: state.monthlyAiDisabledCount,
        turnstileVerifiedCount: state.monthlyTurnstileVerifiedCount || 0,
        turnstileFailedCount: state.monthlyTurnstileFailedCount || 0,
        modeGenerationCounts: state.monthlyModeGenerationCounts,
        modeCacheHitCounts: state.monthlyModeCacheHitCounts,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        estimatedCostJpy: Number(state.estimatedCostJpy.toFixed(4)),
        monthlyBudgetJpy: config.monthlyBudgetJpy,
        budgetUsageRate: config.monthlyBudgetJpy > 0
          ? Number((state.estimatedCostJpy / config.monthlyBudgetJpy * 100).toFixed(2))
          : 0
      },
      guard: {
        turnstileRequired: config.turnstileRequired,
        turnstileVerified: null,
        turnstileStatus: config.turnstileRequired ? "not_applicable_for_usage_report" : "not_required",
        turnstileVerifiedCount: state.dailyTurnstileVerifiedCount || 0,
        turnstileFailedCount: state.dailyTurnstileFailedCount || 0,
        sharedCountLimitsEnabled: config.sharedCountLimitsEnabled,
        rateLimited: config.sharedCountLimitsEnabled
          && state.dailyGenerationCount >= config.dailyGenerationLimit,
        totalRateLimited: config.sharedCountLimitsEnabled
          && state.dailyGenerationCount >= config.dailyGenerationLimit,
        slotRateLimited: isAnyModeSlotRateLimited(state, config),
        budgetBlocked: state.estimatedCostJpy >= config.stopBudgetJpy,
        budgetWarning: state.estimatedCostJpy >= config.warningBudgetJpy,
        aiEnabled: config.aiEnabled,
        dailyGenerationLimit: config.sharedCountLimitsEnabled ? config.dailyGenerationLimit : null,
        dailyGenerationRemaining: config.sharedCountLimitsEnabled
          ? Math.max(0, config.dailyGenerationLimit - state.dailyGenerationCount)
          : null,
        slotGenerationLimit: config.sharedCountLimitsEnabled ? config.slotGenerationLimit : null,
        slotGenerationRemainingBySlot: config.sharedCountLimitsEnabled
          ? buildSlotRemainingCounts(state, config)
          : null,
        modeSlotGenerationRemainingBySlot: buildModeSlotRemainingCounts(state, config),
        dailyModeGenerationCounts: state.dailyModeGenerationCounts,
        dailySlotGenerationCounts: state.dailySlotGenerationCounts,
        dailyModeSlotGenerationCounts: state.dailyModeSlotGenerationCounts,
        monthlyBudgetJpy: config.monthlyBudgetJpy,
        warningBudgetJpy: config.warningBudgetJpy,
        stopBudgetJpy: config.stopBudgetJpy,
        monthlyEstimatedCostJpy: Number(state.estimatedCostJpy.toFixed(4))
      },
      cache: {
        enabled: config.sharedCacheEnabled,
        bindingAvailable: cacheAvailable,
        storage: config.sharedCacheEnabled
          ? (cacheAvailable ? "cloudflare-workers-kv" : "unavailable")
          : "disabled",
        freshSeconds: config.sharedCacheFreshSeconds,
        retentionSeconds: config.sharedCacheRetentionSeconds,
        note: !config.sharedCacheEnabled
          ? "Shared cache is intentionally disabled during personal-user early access. Every mode uses browser-local cache only."
          : cacheAvailable
            ? "Generated AI letter text and minimal metadata are retained temporarily in Workers KV. Glucose summaries are not stored in the shared cache."
            : "Shared cache is inactive until the AI_LETTER_CACHE KV binding is configured."
      },
      storage: {
        kind: state.kind,
        note: state.note,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt
      },
      personalUserUsage: publicUserUsage || { status: "unavailable" }
    }
  };
}


export class GlucoUsageCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.usageState = null;

    ctx.blockConcurrencyWhile(async () => {
      this.usageState = await ctx.storage.get("usage-state");
    });
  }

  async getState(config = DEFAULT_GUARD_CONFIG) {
    this.usageState = normalizeUsageState(this.usageState, config);
    await this.ctx.storage.put("usage-state", this.usageState);
    return cloneUsageState(this.usageState);
  }

  async saveState(nextState, config = DEFAULT_GUARD_CONFIG) {
    const currentState = normalizeUsageState(this.usageState, config);
    const boundary = applyLegacyUsageStateSaveBoundary(currentState, nextState);
    this.usageState = normalizeUsageState(boundary.state, config);
    if (!boundary.accepted) {
      await this.ctx.storage.put("usage-state", this.usageState);
      return cloneUsageState(this.usageState);
    }
    this.usageState.updatedAt = new Date().toISOString();
    await this.ctx.storage.put("usage-state", this.usageState);
    return cloneUsageState(this.usageState);
  }

  async _commitAtomic(transition, config = DEFAULT_GUARD_CONFIG) {
    const now = new Date();
    this.usageState = normalizeUsageState(this.usageState, config, now);
    const result = transition(this.usageState, now);
    const { state, ...metadata } = result;
    this.usageState = markAtomicUsageState(normalizeUsageState(state, config, now), now);
    this.usageState.updatedAt = now.toISOString();
    await this.ctx.storage.put("usage-state", this.usageState);
    return {
      ...metadata,
      state: cloneUsageState(this.usageState)
    };
  }

  async recordTurnstileEvent(input = {}, config = DEFAULT_GUARD_CONFIG) {
    return this._commitAtomic(
      (state, now) => applyAtomicTurnstileEvent(state, input, now),
      config
    );
  }

  async reserveGeneration(input = {}, config = DEFAULT_GUARD_CONFIG) {
    return this._commitAtomic(
      (state, now) => applyAtomicGenerationReserve(state, input, config, now),
      config
    );
  }

  async completeGeneration(input = {}, config = DEFAULT_GUARD_CONFIG) {
    return this._commitAtomic(
      (state, now) => applyAtomicGenerationComplete(state, input, now),
      config
    );
  }

  async releaseGeneration(input = {}, config = DEFAULT_GUARD_CONFIG) {
    return this._commitAtomic(
      (state, now) => applyAtomicGenerationRelease(state, input, now),
      config
    );
  }

  async recordCacheHit(input = {}, config = DEFAULT_GUARD_CONFIG) {
    return this._commitAtomic(
      (state, now) => applyAtomicCacheHit(state, input, now),
      config
    );
  }
}

function buildAiQuotaErrorResponse(result, summary = {}) {
  const code = String(result?.error || "quota_service_unavailable");
  const language = summary.language === "en" ? "en" : "ja";
  const quota = result?.quota
    ? buildAuthoritativeQuotaPayload(result.quota, { consumed: false })
    : buildAuthoritativeQuotaPayload(null, { consumed: false });
  const status = code === "authentication_required"
    ? 401
    : code === "invalid_quota_request"
      ? 400
      : code === "plus_required"
        ? 403
      : code === "daily_limit_reached"
        ? 429
        : code === "request_in_progress" || code === "request_already_succeeded"
          ? 409
          : code === "request_aborted"
            ? 408
            : 503;
  const userMessage = language === "en"
    ? code === "daily_limit_reached"
      ? "Today's successful AI analyses have reached your current limit. Your glucose display is still available, so please try again tomorrow 🍀"
      : code === "plus_required"
        ? "Detailed analysis is included with Plus. Free includes one gentle analysis per day, and your glucose display is still available 🍀"
      : code === "authentication_required"
        ? "Gluco could not confirm the usage profile for AI analysis. Your glucose display is still available 🍀"
        : "Gluco could not safely confirm the AI usage count. Your glucose display is still available, so please try again a little later 🍀"
    : code === "daily_limit_reached"
      ? "きょう使えるAI分析の回数に達したよ。血糖表示はそのまま見られるから、また明日試してね🍀"
      : code === "plus_required"
        ? "しっかり分析はPlusで使えるよ。Freeでは、やさしい分析を1日1回試せるよ。血糖表示はそのまま見られるよ🍀"
      : code === "authentication_required"
        ? "AI分析に使う利用プロフィールを確認できなかったよ。血糖表示はそのまま見られるよ🍀"
        : "AI分析の利用回数を安全に確認できなかったよ。血糖表示はそのまま使えるから、少し時間をおいて試してね🍀";

  return errorResponse({
    code,
    message: "The server-authoritative AI quota request could not be completed.",
    userMessage,
    retryable: status >= 500 || code === "request_aborted",
    details: { quota }
  }, status);
}


async function serveSharedCachedLetter({
  cacheRead,
  fallbackReason = null,
  usageState,
  env,
  config,
  summary,
  payload,
  turnstileVerification,
  quotaPayload = null
}) {
  const responseCacheResult = {
    ...cacheRead,
    status: fallbackReason ? "stale-fallback" : "fresh"
  };
  const generationResult = buildCachedGenerationResult(cacheRead);
  const requestUsage = emptyRequestUsage();

  recordSuccess({
    usageState,
    status: "cached",
    requestUsage,
    summary
  });

  const persistedUsageState = await persistUsageState(env, usageState, config);

  return okResponse(buildSuccessPayload({
    summary,
    payload,
    status: "cached",
    usageState: persistedUsageState,
    requestUsage,
    config,
    generationResult,
    turnstileVerification,
    cacheResult: responseCacheResult,
    cacheFallbackReason: fallbackReason,
    quotaPayload
  }));
}

async function serveAtomicSharedCachedLetter({
  cacheRead,
  fallbackReason = null,
  env,
  config,
  summary,
  payload,
  turnstileVerification,
  quotaPayload = null
}) {
  const cacheEvent = await invokeRequiredAtomicUsageCounter({
    env,
    config,
    method: "recordCacheHit",
    input: {
      slot: normalizeSlot(summary.slot),
      analysisMode: normalizeAnalysisMode(summary.analysisMode)
    }
  });
  if (!cacheEvent.ok || cacheEvent.result?.ok !== true) {
    return buildUsageCounterUnavailableResponse();
  }

  const responseCacheResult = {
    ...cacheRead,
    status: fallbackReason ? "stale-fallback" : "fresh"
  };
  const generationResult = buildCachedGenerationResult(cacheRead);
  const requestUsage = emptyRequestUsage();
  return okResponse(buildSuccessPayload({
    summary,
    payload,
    status: "cached",
    usageState: cacheEvent.result.state,
    requestUsage,
    config,
    generationResult,
    turnstileVerification,
    cacheResult: responseCacheResult,
    cacheFallbackReason: fallbackReason,
    quotaPayload
  }));
}

function buildAtomicReservationConflictResponse(result = {}) {
  const status = result.status || "usage_request_conflict";
  return errorResponse({
    code: status,
    message: "This AI generation request has already been reserved or finalized.",
    userMessage: "このAIお手紙の受付状態を安全に確認できませんでした。少し時間をおいて、もう一度試してね🍀",
    retryable: status === "request_in_progress",
    details: { reason: result.reason || status }
  }, 409);
}

function buildAtomicProviderErrorResponse({
  error,
  usageState,
  failedUsage,
  config,
  summary
}) {
  const incompleteOutput = error.code === "openai_incomplete_output";
  const qualityOutput = error.code === "openai_output_quality_failed";
  const language = summary.language === "en" ? "en" : "ja";
  const userMessage = language === "en"
    ? incompleteOutput
      ? "Gluco could not finish the whole reflection this time. Nothing incomplete was saved, so please try again a little later 🍀"
      : qualityOutput
        ? "Gluco could not shape the reflection safely this time. Nothing was displayed or saved, so please try again a little later 🍀"
        : "A small error occurred while Gluco was preparing the AI reflection. Your glucose display and saved reflections are still available 🍀"
    : incompleteOutput
      ? "AIお手紙を最後までまとめきれませんでした。途中の文章は保存していないので、少し時間をおいてもう一度試してね🍀"
      : qualityOutput
        ? "グルコらしい文章の形に安全に整えられませんでした。今回は表示も保存もしていないので、少し時間をおいてもう一度試してね🍀"
        : "AIお手紙を作る途中で小さなエラーが起きました。血糖表示や保存済みのふりかえりは、そのまま使えるよ🍀";

  return errorResponse({
    code: incompleteOutput
      ? "generation_incomplete"
      : qualityOutput
        ? "generation_quality_failed"
        : "provider_error",
    message: error.message || "AI letter provider failed.",
    userMessage,
    retryable: true,
    details: {
      provider: config.provider,
      model: config.openAiModel,
      errorCode: error.code || "unknown_provider_error",
      analysisMode: error.analysisMode || normalizeAnalysisMode(summary.analysisMode),
      incompleteReason: error.incompleteReason || null,
      qualityIssues: Array.isArray(error.qualityIssues) ? error.qualityIssues : [],
      attempts: Number(error.attempts) || (error.retryAttempted ? 2 : 1),
      maxOutputTokens: Number(error.maxOutputTokens) || null,
      usage: buildUsagePayload({
        state: usageState,
        requestUsage: failedUsage,
        config,
        summary
      })
    }
  }, 502);
}

async function handleApprovedPublicDemoRequest({
  request,
  env,
  config,
  usageState,
  payload,
  summary
}) {
  const turnstileVerification = await verifyTurnstileToken({
    payload,
    request,
    env,
    config
  });
  let currentUsageState = usageState;

  if (config.atomicUsageCounterEnabled) {
    const turnstileEvent = await invokeRequiredAtomicUsageCounter({
      env,
      config,
      method: "recordTurnstileEvent",
      input: {
        required: config.turnstileRequired,
        verified: turnstileVerification.verified === true
      }
    });
    if (!turnstileEvent.ok || turnstileEvent.result?.ok !== true) {
      return buildUsageCounterUnavailableResponse();
    }
    currentUsageState = turnstileEvent.result.state;
  } else {
    recordTurnstileVerification({
      usageState: currentUsageState,
      config,
      turnstileVerification
    });
  }

  if (config.turnstileRequired && !turnstileVerification.verified) {
    if (!config.atomicUsageCounterEnabled) {
      await persistUsageState(env, currentUsageState, config);
    }
    return errorResponse(
      buildTurnstileError(turnstileVerification),
      turnstileVerification.code === "missing_turnstile_secret" ? 500 : 403
    );
  }

  const generationResult = buildApprovedPublicDemoLetter(summary);
  if (!generationResult) {
    return errorResponse({
      code: "invalid_demo_request",
      message: "The approved public-demo sample could not be selected.",
      userMessage: summary.language === "en"
        ? "The public-demo sample could not be displayed. Please try again later 🍀"
        : "公開デモのサンプルを表示できませんでした。少し時間をおいて、もう一度試してね🍀",
      retryable: false
    }, 400);
  }

  if (config.atomicUsageCounterEnabled) {
    const sampleEvent = await invokeRequiredAtomicUsageCounter({
      env,
      config,
      method: "recordCacheHit",
      input: {
        slot: normalizeSlot(summary.slot),
        analysisMode: normalizeAnalysisMode(summary.analysisMode)
      }
    });
    if (!sampleEvent.ok || sampleEvent.result?.ok !== true) {
      return buildUsageCounterUnavailableResponse();
    }
    currentUsageState = sampleEvent.result.state;
  } else {
    recordSuccess({
      usageState: currentUsageState,
      status: "cached",
      requestUsage: emptyRequestUsage(),
      summary
    });
    currentUsageState = await persistUsageState(env, currentUsageState, config);
  }

  return okResponse(buildSuccessPayload({
    summary,
    payload,
    status: "cached",
    usageState: currentUsageState,
    requestUsage: emptyRequestUsage(),
    config,
    generationResult,
    turnstileVerification,
    cacheResult: {
      available: false,
      key: null,
      status: "approved-demo-sample",
      entry: null,
      timing: {
        generatedAt: generationResult.generatedAt,
        fresh: true,
        ageSeconds: 0,
        freshUntil: null,
        expiresAt: null
      }
    },
    quotaPayload: null
  }));
}

async function handleAtomicGenerationRequest({
  request,
  env,
  config,
  quotaConfig,
  usageState,
  payload,
  summary,
  quotaRequest
}) {
  let currentUsageState = usageState;
  const turnstileVerification = await verifyTurnstileToken({
    payload,
    request,
    env,
    config
  });
  const turnstileEvent = await invokeRequiredAtomicUsageCounter({
    env,
    config,
    method: "recordTurnstileEvent",
    input: {
      required: config.turnstileRequired,
      verified: turnstileVerification.verified === true
    }
  });
  if (!turnstileEvent.ok || turnstileEvent.result?.ok !== true) {
    return buildUsageCounterUnavailableResponse();
  }
  currentUsageState = turnstileEvent.result.state;

  if (config.turnstileRequired && !turnstileVerification.verified) {
    return errorResponse(
      buildTurnstileError(turnstileVerification),
      turnstileVerification.code === "missing_turnstile_secret" ? 500 : 403
    );
  }

  const cacheRead = await readSharedCache({ env, config, summary });
  if (cacheRead.status === "fresh" && cacheRead.entry) {
    return serveAtomicSharedCachedLetter({
      cacheRead,
      env,
      config,
      summary,
      payload,
      turnstileVerification,
      quotaPayload: quotaConfig.enabled
        ? buildAuthoritativeQuotaPayload(null, { consumed: false })
        : null
    });
  }

  const staleCacheAvailable = cacheRead.status === "stale" && Boolean(cacheRead.entry);
  const prototypeStatus = quotaConfig.enabled ? "success" : getPrototypeStatus(payload);
  if (prototypeStatus === "cached") {
    const generationResult = await generateLetter({
      summary,
      payload,
      env,
      config,
      status: prototypeStatus
    });
    const cacheEvent = await invokeRequiredAtomicUsageCounter({
      env,
      config,
      method: "recordCacheHit",
      input: {
        slot: normalizeSlot(summary.slot),
        analysisMode: normalizeAnalysisMode(summary.analysisMode)
      }
    });
    if (!cacheEvent.ok || cacheEvent.result?.ok !== true) {
      return buildUsageCounterUnavailableResponse();
    }
    return okResponse(buildSuccessPayload({
      summary,
      payload,
      status: "cached",
      usageState: cacheEvent.result.state,
      requestUsage: emptyRequestUsage(),
      config,
      generationResult,
      turnstileVerification,
      cacheResult: cacheRead,
      quotaPayload: null
    }));
  }

  const effectiveUsageState = quotaConfig.enabled
    ? currentUsageState
    : applyDebugUsageOverrides(currentUsageState, payload);
  const manualGuardStatus = ["rate_limited", "budget_stopped", "ai_disabled"].includes(prototypeStatus)
    ? { status: prototypeStatus, reason: "manual" }
    : null;
  const preflightGuard = manualGuardStatus || getGuardBlock({
    status: prototypeStatus,
    usageState: effectiveUsageState,
    config,
    summary
  });
  const requestId = getAtomicUsageRequestId(payload, quotaRequest);
  const reservedCostJpy = preflightGuard
    ? 0
    : estimateReservedGenerationCostJpy({ summary, config });
  const reservationOutcome = await invokeRequiredAtomicUsageCounter({
    env,
    config,
    method: "reserveGeneration",
    input: {
      requestId,
      slot: normalizeSlot(summary.slot),
      analysisMode: normalizeAnalysisMode(summary.analysisMode),
      reservedCostJpy,
      forcedStatus: preflightGuard?.status || null,
      forcedReason: preflightGuard?.reason || null
    }
  });
  if (!reservationOutcome.ok) return buildUsageCounterUnavailableResponse();
  const reservation = reservationOutcome.result;
  currentUsageState = reservation.state;

  if (!reservation.ok) {
    if (["rate_limited", "budget_stopped", "ai_disabled"].includes(reservation.status)) {
      const guardError = buildGuardError(reservation.status, {
        usageState: currentUsageState,
        config,
        payload,
        summary,
        reason: reservation.reason,
        turnstileVerification,
        recordEvent: false
      });
      if (staleCacheAvailable) {
        return serveAtomicSharedCachedLetter({
          cacheRead,
          fallbackReason: reservation.status,
          env,
          config,
          summary,
          payload,
          turnstileVerification,
          quotaPayload: quotaConfig.enabled
            ? buildAuthoritativeQuotaPayload(null, { consumed: false })
            : null
        });
      }
      const { status, ...errorBody } = guardError;
      return errorResponse(errorBody, status);
    }
    return buildAtomicReservationConflictResponse(reservation);
  }

  let generationResult;
  let quotaPayload = null;
  const execution = await runWithAtomicUsageReservation({
    signal: request.signal,
    run: async (generationSignal) => {
      const outcome = await runAiQuotaGeneration({
        enabled: quotaConfig.enabled,
        service: env.AI_QUOTA,
        reserveInput: quotaRequest?.reserveInput,
        signal: generationSignal,
        generate: () => generateLetter({
          summary,
          payload,
          env,
          config,
          status: prototypeStatus,
          signal: generationSignal
        })
      });
      if (!outcome.ok && outcome.generationError) {
        outcome.generationError.aiQuota = outcome.quota || null;
        throw outcome.generationError;
      }
      return outcome;
    },
    release: (error) => invokeRequiredAtomicUsageCounter({
      env,
      config,
      method: "releaseGeneration",
      input: {
        requestId,
        reason: error.code || "provider_error",
        actualUsage: error.usage || emptyRequestUsage()
      }
    })
  });

  if (!execution.ok) {
    const error = execution.error;
    console.error("AI letter provider failed", error);
    const failedUsage = error.usage || emptyRequestUsage();
    const released = execution.releaseResult;
    if (execution.releaseError || !released?.ok || released.result?.ok !== true) {
      return buildUsageCounterUnavailableResponse();
    }
    currentUsageState = released.result.state;
    const fallbackReason = error.code === "openai_incomplete_output"
      ? "generation_incomplete"
      : error.code === "openai_output_quality_failed"
        ? "generation_quality_failed"
        : "provider_error";
    if (staleCacheAvailable) {
      return serveAtomicSharedCachedLetter({
        cacheRead,
        fallbackReason,
        env,
        config,
        summary,
        payload,
        turnstileVerification,
        quotaPayload: quotaConfig.enabled
          ? buildAuthoritativeQuotaPayload(error.aiQuota, { consumed: false })
          : null
      });
    }
    return buildAtomicProviderErrorResponse({
      error,
      usageState: currentUsageState,
      failedUsage,
      config,
      summary
    });
  }

  const quotaOutcome = execution.result;
  if (!quotaOutcome.ok) {
    const released = await invokeRequiredAtomicUsageCounter({
      env,
      config,
      method: "releaseGeneration",
      input: {
        requestId,
        reason: quotaOutcome.error || "quota_service_unavailable",
        actualUsage: quotaOutcome.knownUsage || emptyRequestUsage()
      }
    });
    if (!released.ok || released.result?.ok !== true) {
      return buildUsageCounterUnavailableResponse();
    }
    return buildAiQuotaErrorResponse(quotaOutcome, summary);
  }

  generationResult = quotaOutcome.result;
  quotaPayload = quotaConfig.enabled
    ? buildAuthoritativeQuotaPayload(quotaOutcome.quota, { consumed: true })
    : null;

  const requestUsage = generationResult.usage || emptyRequestUsage();
  const completed = await invokeRequiredAtomicUsageCounter({
    env,
    config,
    method: "completeGeneration",
    input: { requestId, actualUsage: requestUsage }
  });
  if (!completed.ok || completed.result?.ok !== true) {
    return buildUsageCounterUnavailableResponse();
  }
  currentUsageState = completed.result.state;

  const cacheWrite = await writeSharedCache({
    env,
    config,
    summary,
    generationResult
  });
  if (cacheWrite?.entry?.generatedAt) {
    generationResult.generatedAt = cacheWrite.entry.generatedAt;
  }

  return okResponse(buildSuccessPayload({
    summary,
    payload,
    status: prototypeStatus,
    usageState: currentUsageState,
    requestUsage,
    config,
    generationResult,
    turnstileVerification,
    cacheResult: cacheWrite,
    quotaPayload
  }));
}

async function handleApiRequest(request, env = {}) {
    let config = readGuardConfig(env);
    const quotaConfig = readAiQuotaClientConfig(env);
    let usageState;
    try {
      usageState = await loadUsageState(env, config);
    } catch (error) {
      if (config.atomicUsageCounterEnabled) {
        console.error("Atomic usage counter state load failed", error);
        return buildUsageCounterUnavailableResponse();
      }
      throw error;
    }
    const atomicUsageCounterRequired = shouldUseAtomicUsageCounter(config, usageState);
    if (atomicUsageCounterRequired && usageState.kind !== "durable-object-sqlite") {
      return buildUsageCounterUnavailableResponse();
    }
    if (atomicUsageCounterRequired && !config.atomicUsageCounterEnabled) {
      config = { ...config, atomicUsageCounterEnabled: true };
    }

    const url = new URL(request.url);
    if (url.pathname === "/api/gluco-letter/usage" && request.method === "GET") {
      const publicUserUsage = await loadPublicUsageAggregate(env.USER_USAGE_SUMMARY);
      return okResponse(buildUsageReport({
        state: usageState,
        config,
        cacheAvailable: getSharedCacheAvailability(env, config),
        publicUserUsage
      }));
    }

    if (url.pathname !== "/api/gluco-letter") {
      return errorResponse({
        code: "not_found",
        message: "Not found",
        userMessage: "AI分析の入口が見つかりませんでした。"
      }, 404);
    }

    if (request.method !== "POST") {
      return errorResponse({
        code: "method_not_allowed",
        message: "Method not allowed",
        userMessage: "AI分析の呼び出し方法が違うようです。"
      }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (error) {
      return errorResponse({
        code: "invalid_json",
        message: "Invalid JSON",
        userMessage: "AI分析用のデータを読み取れませんでした。"
      }, 400);
    }

    let summary = payload?.summary;
    if (!summary || typeof summary !== "object") {
      return errorResponse({
        code: "missing_summary",
        message: "Missing summary",
        userMessage: "AI分析用の血糖サマリーが見つかりませんでした。"
      }, 400);
    }

    summary = {
      ...summary,
      analysisMode: getAnalysisMode(payload, summary)
    };

    const requestAudience = classifyAiRequestAudience(summary);
    if (quotaConfig.enabled && requestAudience === "public_demo") {
      if (!config.publicDemoApprovedSampleEnabled) {
        return errorResponse({
          code: "public_demo_sample_unavailable",
          message: "The approved public-demo sample is not enabled.",
          userMessage: summary.language === "en"
            ? "The public-demo sample is being prepared. Your glucose display is still available 🍀"
            : "公開デモのお手紙サンプルは準備中です。血糖表示はそのまま使えるよ🍀",
          retryable: true
        }, 503);
      }
      return handleApprovedPublicDemoRequest({
        request,
        env,
        config,
        usageState,
        payload,
        summary
      });
    }
    if (quotaConfig.enabled && requestAudience !== "personal_user") {
      return buildAiQuotaErrorResponse({
        error: "authentication_required",
        retryable: false
      }, summary);
    }

    let quotaRequest = null;
    if (quotaConfig.enabled) {
      if (config.provider !== "openai") {
        return buildAiQuotaErrorResponse({
          error: "quota_requires_openai_provider",
          retryable: true
        }, summary);
      }
      quotaRequest = readAiQuotaRequest(request, payload, summary.analysisMode);
      if (!quotaRequest.ok) {
        return buildAiQuotaErrorResponse(quotaRequest, summary);
      }
    }

    if (config.atomicUsageCounterEnabled) {
      return handleAtomicGenerationRequest({
        request,
        env,
        config,
        quotaConfig,
        usageState,
        payload,
        summary,
        quotaRequest
      });
    }

    const turnstileVerification = await verifyTurnstileToken({
      payload,
      request,
      env,
      config
    });

    if (config.turnstileRequired && !turnstileVerification.verified) {
      recordTurnstileVerification({
        usageState,
        config,
        turnstileVerification
      });
      await persistUsageState(env, usageState, config);

      return errorResponse(
        buildTurnstileError(turnstileVerification),
        turnstileVerification.code === "missing_turnstile_secret" ? 500 : 403
      );
    }

    recordTurnstileVerification({
      usageState,
      config,
      turnstileVerification
    });

    const cacheRead = await readSharedCache({
      env,
      config,
      summary
    });

    if (cacheRead.status === "fresh" && cacheRead.entry) {
      return serveSharedCachedLetter({
        cacheRead,
        usageState,
        env,
        config,
        summary,
        payload,
        turnstileVerification,
        quotaPayload: quotaConfig.enabled
          ? buildAuthoritativeQuotaPayload(null, { consumed: false })
          : null
      });
    }

    const staleCacheAvailable = cacheRead.status === "stale" && Boolean(cacheRead.entry);
    const prototypeStatus = quotaConfig.enabled ? "success" : getPrototypeStatus(payload);
    const effectiveUsageState = quotaConfig.enabled
      ? usageState
      : applyDebugUsageOverrides(usageState, payload);
    const forcedGuardError = buildGuardError(prototypeStatus, {
      usageState,
      config,
      payload,
      summary,
      reason: "manual",
      turnstileVerification
    });

    if (forcedGuardError) {
      if (staleCacheAvailable) {
        return serveSharedCachedLetter({
          cacheRead,
          fallbackReason: prototypeStatus,
          usageState,
          env,
          config,
          summary,
          payload,
          turnstileVerification,
          quotaPayload: quotaConfig.enabled
            ? buildAuthoritativeQuotaPayload(null, { consumed: false })
            : null
        });
      }

      await persistUsageState(env, usageState, config);
      const { status, ...errorBody } = forcedGuardError;
      return errorResponse(errorBody, status);
    }

    const guardBlock = getGuardBlock({
      status: prototypeStatus,
      usageState: effectiveUsageState,
      config,
      summary
    });

    if (guardBlock) {
      const guardError = buildGuardError(guardBlock.status, {
        usageState,
        config,
        payload,
        summary,
        reason: guardBlock.reason,
        turnstileVerification
      });

      if (staleCacheAvailable) {
        return serveSharedCachedLetter({
          cacheRead,
          fallbackReason: guardBlock.status,
          usageState,
          env,
          config,
          summary,
          payload,
          turnstileVerification,
          quotaPayload: quotaConfig.enabled
            ? buildAuthoritativeQuotaPayload(null, { consumed: false })
            : null
        });
      }

      await persistUsageState(env, usageState, config);
      const { status, ...errorBody } = guardError;
      return errorResponse(errorBody, status);
    }

    let generationResult;
    let quotaPayload = null;
    try {
      const quotaOutcome = await runWithGenerationDeadline({
        signal: request.signal,
        run: (generationSignal) => runAiQuotaGeneration({
          enabled: quotaConfig.enabled,
          service: env.AI_QUOTA,
          reserveInput: quotaRequest?.reserveInput,
          signal: generationSignal,
          generate: () => generateLetter({
            summary,
            payload,
            env,
            config,
            status: prototypeStatus,
            signal: generationSignal
          })
        })
      });

      if (!quotaOutcome.ok) {
        if (quotaOutcome.generationError) {
          quotaOutcome.generationError.aiQuota = quotaOutcome.quota || null;
          throw quotaOutcome.generationError;
        }
        if (quotaOutcome.knownUsage) {
          recordProviderUsage({ usageState, requestUsage: quotaOutcome.knownUsage });
          await persistUsageState(env, usageState, config);
        }
        return buildAiQuotaErrorResponse(quotaOutcome, summary);
      }

      generationResult = quotaOutcome.result;
      quotaPayload = quotaConfig.enabled
        ? buildAuthoritativeQuotaPayload(quotaOutcome.quota, { consumed: true })
        : null;
    } catch (error) {
      console.error("AI letter provider failed", error);

      const failedUsage = error.usage || emptyRequestUsage();
      recordProviderUsage({ usageState, requestUsage: failedUsage });
      const incompleteOutput = error.code === "openai_incomplete_output";
      const qualityOutput = error.code === "openai_output_quality_failed";
      const fallbackReason = incompleteOutput
        ? "generation_incomplete"
        : qualityOutput
          ? "generation_quality_failed"
          : "provider_error";

      if (staleCacheAvailable) {
        return serveSharedCachedLetter({
          cacheRead,
          fallbackReason,
          usageState,
          env,
          config,
          summary,
          payload,
          turnstileVerification,
          quotaPayload: quotaConfig.enabled
            ? buildAuthoritativeQuotaPayload(error.aiQuota, { consumed: false })
            : null
        });
      }

      const persistedUsageState = await persistUsageState(env, usageState, config);

      return errorResponse({
        code: incompleteOutput
          ? "generation_incomplete"
          : qualityOutput
            ? "generation_quality_failed"
            : "provider_error",
        message: error.message || "AI letter provider failed.",
        userMessage: incompleteOutput
          ? "AI分析を最後までまとめきれませんでした。途中の文章は保存していないよ。少し時間をおいて、もう一度試してみてね🍀"
          : qualityOutput
            ? "グルコらしい文章の形に整えきれなかったため、今回の文章は表示も保存もしていないよ。少し時間をおいて、もう一度試してみてね🍀"
            : "AIお手紙の生成中に小さなエラーが起きました。表示中のお手紙やChatGPTコピー機能はそのまま使えます🍀",
        retryable: true,
        details: {
          provider: config.provider,
          model: config.openAiModel,
          errorCode: error.code || "unknown_provider_error",
          analysisMode: error.analysisMode || normalizeAnalysisMode(summary.analysisMode),
          incompleteReason: error.incompleteReason || null,
          qualityIssues: Array.isArray(error.qualityIssues) ? error.qualityIssues : [],
          attempts: Number(error.attempts) || (error.retryAttempted ? 2 : 1),
          maxOutputTokens: Number(error.maxOutputTokens) || null,
          usage: buildUsagePayload({
            state: persistedUsageState,
            requestUsage: failedUsage,
            config,
            summary
          })
        }
      }, 502);
    }

    const requestUsage = generationResult.usage || emptyRequestUsage();
    const cacheWrite = prototypeStatus === "cached"
      ? cacheRead
      : await writeSharedCache({
          env,
          config,
          summary,
          generationResult
        });

    if (cacheWrite?.entry?.generatedAt) {
      generationResult.generatedAt = cacheWrite.entry.generatedAt;
    }

    recordSuccess({
      usageState,
      status: prototypeStatus,
      requestUsage,
      summary
    });
    const persistedUsageState = await persistUsageState(env, usageState, config);

    return okResponse(buildSuccessPayload({
      summary,
      payload,
      status: prototypeStatus,
      usageState: persistedUsageState,
      requestUsage,
      config,
      generationResult,
      turnstileVerification,
      cacheResult: cacheWrite,
      quotaPayload
    }));
}

export default {
  async fetch(request, env = {}) {
    const corsDecision = evaluateCorsRequest(request, env);

    if (request.method === "OPTIONS") {
      return handleCorsPreflight(request, corsDecision, env);
    }

    if (isAiGenerationRequest(request) && !corsDecision.origin) {
      return buildCorsErrorResponse({
        ...corsDecision,
        allowed: false,
        reason: "origin_header_required"
      }, 403);
    }

    if (!corsDecision.allowed) {
      return buildCorsErrorResponse(corsDecision, 403);
    }

    const response = await handleApiRequest(request, env);
    return applyCorsHeaders(response, corsDecision);
  }
};
