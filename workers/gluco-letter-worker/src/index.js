import { DurableObject } from "cloudflare:workers";
import { getGeneratedLetterQualityIssues, isUnicornEligibleSummary } from "./letter-quality.js";

const CONTRACT_VERSION = "gluco-ai-letter-worker-response-v0.2";
const AI_LETTER_CACHE_SCHEMA_VERSION = "gluco-ai-letter-cache-v9";
const LETTER_SLOT_KEYS = ["morning", "afternoon", "night"];
const ANALYSIS_MODE_KEYS = ["letter", "deep"];

const DEFAULT_GUARD_CONFIG = {
  aiEnabled: true,
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

const DEFAULT_CORS_ALLOWED_ORIGINS = ["https://afterglow21.github.io"];
const CORS_ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];
const CORS_ALLOWED_REQUEST_HEADERS = ["content-type"];
const CORS_ALLOWED_REQUEST_HEADERS_DISPLAY = "Content-Type";
const CORS_MAX_AGE_SECONDS = 86400;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
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

function handleCorsPreflight(request, corsDecision) {
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

  const requestedHeaders = getRequestedCorsHeaders(request);
  const unsupportedHeader = requestedHeaders.find((header) => !CORS_ALLOWED_REQUEST_HEADERS.includes(header));
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
    "Access-Control-Allow-Headers": CORS_ALLOWED_REQUEST_HEADERS_DISPLAY,
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
  return {
    status: cacheResult.status || "unavailable",
    storage: cacheResult.available ? "cloudflare-workers-kv" : "unavailable",
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
    state = createUsageState(now, config);
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
  if (env?.USAGE_COUNTER?.getByName) {
    const stub = env.USAGE_COUNTER.getByName("glucoscope-global-usage");
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

  if (env?.USAGE_COUNTER?.getByName) {
    const stub = env.USAGE_COUNTER.getByName("glucoscope-global-usage");
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
  const score = metrics.glucoScore ?? "--";
  const celebrationClues = buildCelebrationClues(summary);
  const hints = Array.isArray(summary.patternHints) ? summary.patternHints.slice(0, analysisMode === "deep" ? 4 : 2) : [];

  if (analysisMode === "deep") {
    if (language === "en") {
      const celebrationSection = celebrationClues.length
        ? `\n\nWorth celebrating\n${celebrationClues.map((clue) => `- ${clue}`).join("\n")}`
        : "";
      const hintLines = hints.length ? hints.map((hint) => `- ${hint}`).join("\n") : "- The selected range has clues we can look back on gently.";
      return `Gluco is here 🍀
I looked at the selected range gently.${celebrationSection}

Overview
- Range: ${rangeLabel}
- TIR ${tir}%, TAR ${tar}%, TBR ${tbr}%
- Average glucose ${avg}mg/dL, CV ${cv}%, GlucoScore ${score}

Clues visible in the summary
${hintLines}

This is not a diagnosis or a treatment instruction. It is a gentle map for noticing patterns and discussing anything concerning with your healthcare team.`;
    }

    const celebrationSection = celebrationClues.length
      ? `\n\nうれしい手がかり\n${celebrationClues.map((clue) => `・${clue}`).join("\n")}`
      : "";
    const hintLines = hints.length ? hints.map((hint) => `・${hint}`).join("\n") : "・表示中の期間には、あとでやさしく見返せる手がかりがありそうだよ。";
    return `グルコだよ🍀
表示中のデータを、少し詳しく一緒に見ていくね。${celebrationSection}

全体の流れ
・表示範囲: ${rangeLabel}
・TIR ${tir}% / TAR ${tar}% / TBR ${tbr}%
・平均血糖 ${avg}mg/dL / CV ${cv}% / GlucoScore ${score}

見えている手がかり
${hintLines}

これは診断や治療の指示ではなく、あとで主治医さんとも話しやすくするための、やさしい振り返りだよ。`;
  }

  if (language === "en") {
    const celebrationLine = celebrationClues.length ? `\n${celebrationClues.slice(0, 2).join("\n")}` : "";
    const hintLine = hints.length ? `\nI also noticed: ${hints.join(" / ")}` : "";
    return `Gluco is here 🍀
I looked at the selected range gently: ${rangeLabel}.${celebrationLine}
TIR is ${tir}%, average glucose is ${avg}mg/dL, and GlucoScore is ${score}.${hintLine}
The numbers are not here to judge you; they are small clues for understanding today and improving tomorrow.`;
  }

  const celebrationLine = celebrationClues.length ? `\n${celebrationClues.slice(0, 2).join("\n")}` : "";
  const hintLine = hints.length ? `\n見えている手がかり: ${hints.join(" / ")}` : "";
  return `グルコだよ🍀
表示範囲は ${rangeLabel} だね。${celebrationLine}
TIRは${tir}%、平均血糖は${avg}mg/dL、GlucoScoreは${score}だったよ。${hintLine}
血糖はあなたを責める数字じゃなくて、今日を理解して明日を少し楽にするための手がかりだよ。`;
}

function buildOpenAiInstructions(language = "ja", mode = "letter") {
  const analysisMode = normalizeAnalysisMode(mode);

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
      "Because the response may be shown later from cache, avoid real-time wording such as 'right now' or 'current glucose'.",
      "When mentioning the latest glucose value, say 'the latest reading' or include the provided measurement time.",
      "Treat TIR, TAR, TBR, average glucose, CV, GMI, and GlucoScore as reflection clues, not grades.",
      "When the summary contains positive clues, celebrate them clearly and early instead of minimizing them with phrases like 'not bad', 'not perfect', or 'not too wavy'.",
      "TIR of 100% deserves enthusiastic celebration as a TIR result. TIR 100% never creates or implies a unicorn.",
      "Unicorn wording is allowed only when the latest reading in today's view is exactly 100mg/dL. TIR 100%, average glucose 100mg/dL, and GlucoScore 100 never qualify.",
      "When unicorn wording is allowed, connect it explicitly to the latest 100mg/dL reading in a separate sentence or bullet, never to TIR.",
      "Do not assume how hard the person worked or make praise about their worth. Praise the observed flow, not the person as a grade.",
      "Positive recognition must not hide notable lower or higher periods; celebrate first, then mention important clues gently.",
      "Do not expose variable names, JSON keys, camelCase labels, or other implementation details in the response.",
      "Keep it concrete, gentle, and clear. End with a small reflection clue for tomorrow."
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
    "話し方は、そばにいる小さなともだちのような自然な常体に統一します。文末に『です』『ます』『でした』『ました』『あります』『ありません』『ください』『ましょう』『でしょう』を使いません。",
    "文末は『だよ』『だね』『見えているよ』『一緒に見ていこうね』など、グルコらしいやわらかい言葉にします。",
    "『一緒に』は連続する2文で繰り返しません。直前の文で『一緒に』を使った場合、最後の文は『明日もやさしく振り返ってみよう🍀』など別の言い方にします。",
    "『かも』は、データから見えることが確かではないときだけ使い、呼びかけや提案の文末には使いません。",
    "『〜しようかも』『〜していこうかも』『〜見てみようかも』のような表現は使わず、呼びかけは『〜しようね』『〜してみよう』『〜見ていこうね』のように自然に書きます。",
    "入力欄の名前、英語の変数名、JSONキー、camelCase、内部処理の言葉を本文へ出しません。",
    "キャッシュ表示される可能性があるため、『今の血糖』『現在の血糖』『たった今』などのリアルタイム断定は避けます。",
    "最新測定に触れる場合は、『最新の測定では』『○○ごろの測定では』のように時刻やサマリー上の測定であることが伝わる言い方にします。",
    "TIR、TAR、TBR、平均血糖、CV、GMI、GlucoScoreは採点ではなく、振り返りの手がかりとして扱います。",
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
function buildOpenAiSummaryText(summary = {}, mode = "letter", language = "ja") {
  const analysisMode = normalizeAnalysisMode(mode);
  const metrics = summary.metrics || {};
  const celebrationClues = buildCelebrationClues(summary);
  const compassionGuidance = getCompassionGuidance(summary, language);
  const patternHints = Array.isArray(summary.patternHints)
    ? summary.patternHints.slice(0, analysisMode === "deep" ? 6 : 4)
    : [];
  const valueOrDash = (value) => value === null || value === undefined || value === "" ? "--" : value;

  if (language === "en") {
    return [
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
      `- GMI estimate: ${valueOrDash(metrics.gmi)}%`,
      `- GlucoScore: ${valueOrDash(metrics.glucoScore)}`,
      `- Previous comparison GlucoScore: ${valueOrDash(metrics.previousScore)}`,
      `- 7-day average GlucoScore: ${valueOrDash(metrics.sevenDayAverageScore)}`,
      `- Private writing guidance (never quote this label or instruction): ${compassionGuidance}`,
      "- Positive clues:",
      ...(celebrationClues.length ? celebrationClues.map((clue) => `  - ${clue}`) : ["  - none"]),
      "- Reflection clues:",
      ...(patternHints.length ? patternHints.map((hint) => `  - ${hint}`) : ["  - none"])
    ].join("\n");
  }

  return [
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
    `・GMI目安: ${valueOrDash(metrics.gmi)}%`,
    `・GlucoScore: ${valueOrDash(metrics.glucoScore)}`,
    `・比較期間のGlucoScore: ${valueOrDash(metrics.previousScore)}`,
    `・過去7日平均GlucoScore: ${valueOrDash(metrics.sevenDayAverageScore)}`,
    `・非公開の書き方指示（見出しや判定語を本文へ書かない）: ${compassionGuidance}`,
    "・うれしい手がかり:",
    ...(celebrationClues.length ? celebrationClues.map((clue) => `  ・${clue}`) : ["  ・なし"]),
    "・振り返りの手がかり:",
    ...(patternHints.length ? patternHints.map((hint) => `  ・${hint}`) : ["  ・なし"])
  ].join("\n");
}

function buildOpenAiPrompt(summary = {}, mode = "letter") {
  const language = summary.language === "en" ? "en" : "ja";
  const analysisMode = normalizeAnalysisMode(mode);
  const modeLabel = getAnalysisModeLabel(analysisMode, language);
  const slotLabel = getSlotLabel(summary, language);
  const summaryText = buildOpenAiSummaryText(summary, analysisMode, language);

  if (language === "en") {
    if (analysisMode === "deep") {
      return `Create one detailed Gluco reflection for this summarized glucose view.

Requirements:
- Start with "Gluco is here 🍀"
- Use short emoji section labels, such as 🍀 Flow / 📊 Metric clues / 🔎 Pattern clues / 🌱 A small next reflection
- Do not use Markdown heading marks such as #, ##, or ###
- Do not write meta labels such as "This is a prototype", "This is the detailed analysis", or "This is the ${slotLabel}"
- Mention the active time only if it reads naturally; do not force it
- Include TIR, TAR, TBR, average glucose, CV, and GlucoScore when available
- If positive clues are listed, mention one or more near the beginning and celebrate them clearly
- Celebrate TIR 100% enthusiastically as a TIR result only; it never means unicorn
- Follow the "Unicorn eligibility" line exactly and never infer unicorn from TIR, average glucose, or GlucoScore
- If eligible, connect unicorn wording to the latest 100mg/dL reading in a separate sentence or bullet, never to TIR
- Do not weaken praise with "not bad", "not perfect", or similar backhanded wording
- Do not frame numbers as grades or success/failure
- Do not output field names, variable names, JSON keys, camelCase, or implementation details
- Avoid real-time wording such as "right now" because this may be shown later from cache
- Avoid medical advice, dosing advice, diagnosis, blame, fear, or strict instructions
- Keep it readable: about 10 to 16 short lines

Summarized data:
${summaryText}`;
    }

    return `Write one Gluco letter for this summarized glucose view.

Requirements:
- Start with "Gluco is here 🍀"
- 5 to 8 short lines
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

Summarized data:
${summaryText}`;
  }

  if (analysisMode === "deep") {
    return `この集計済み血糖サマリーをもとに、グルコからの「${modeLabel}」を1つ書いて。

条件:
- 最初は必ず「グルコだよ🍀」で始める
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
- TIR、TAR、TBR、平均血糖、CV、GlucoScoreを、分かる範囲で具体的に扱う
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
- 数字を採点、合否、成功・失敗として扱わない
- 入力欄の名前、英語の変数名、JSONキー、camelCase、内部処理の言葉を本文へ出さない
- キャッシュ表示される可能性があるため、「今」「現在」「たった今」などのリアルタイム断定を避ける
- 医療判断、診断、インスリン量、薬、ポンプ設定、デバイス設定の助言はしない
- 責めない、怖がらせない、急かさない
- 10〜16行くらい。短い見出しと箇条書きを中心に、やさしく自然に書く
- 最後の一文は「一緒に見ていこうね🍀」「明日もやさしく振り返ってみよう🍀」のような、自然で迷いのない一文で締める

集計済みサマリー:
${summaryText}`;
  }

  return `この集計済み血糖サマリーをもとに、グルコからの短くやさしい分析を1つ書いて。

条件:
- 最初は必ず「グルコだよ🍀」で始める
- 5〜8行くらいの短いお手紙にする
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
- 血糖値に触れる場合は「今の血糖」ではなく、「最新の測定では」または「${summary.latestMeasuredAt || "最新測定"}ごろの測定では」のように書く
- 入力欄の名前、英語の変数名、JSONキー、camelCase、内部処理の言葉を本文へ出さない
- キャッシュ表示される可能性があるため、「今」「現在」「たった今」などのリアルタイム断定を避ける
- 医療判断、診断、インスリン量、薬、ポンプ設定、デバイス設定の助言はしない
- 責めない、怖がらせない、急かさない
- やさしく、自然な日本語で書く
- 最後の一文は「一緒に見ていこうね🍀」「明日もやさしく振り返ってみよう🍀」のような、自然で迷いのない一文で締める

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

重要: 前の文章は表示用として整っていなかったため使わない。最初から書き直し、完成した分析本文だけを返す。英語の変数名、JSONキー、camelCase、内部処理、判定名、「いたわり優先」「対象」「通常」「非公開の書き方指示」を本文へ出さない。「〜しようかも」は使わず、連続する2文で「一緒に」を繰り返さない。気になる指標へ「も」「しか」「まだ」「残念ながら」「高すぎる」「低すぎる」「悪い」「問題」を結びつけず、TBRを「少し」と小さく扱わない。数値だけの感嘆文、曖昧な比喩、「平均の雰囲気」「景色」「戻りの力」「後から見る場所」「安心材料」「小さくまとまる動き」を使わない。比較値がない指標の増減を推測せず、GMIから荒れ・安定を解釈しない。低めや目標範囲外の時間へのいたわりは、内部条件を説明せず自然な一文として伝える。ユニコーン判定を守り、最後は自然で迷いのない一文にする。`;
  }

  if (language === "en") {
    return `${basePrompt}

Important: Complete the full reflection within the available output limit. End with a complete final sentence; do not stop mid-sentence.`;
  }

  return `${basePrompt}

重要: 出力上限の中で必ず最後まで書き切り、文の途中で終わらせない。最後は完結した一文で締める。`;
}

async function callOpenAiAttempt({ summary, env, config, mode, maxOutputTokens, retryKind = "" }) {
  const model = config.openAiModel;
  const language = summary.language === "en" ? "en" : "ja";
  const input = retryKind
    ? buildOpenAiRetryPrompt(summary, mode, retryKind)
    : buildOpenAiPrompt(summary, mode);

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      instructions: buildOpenAiInstructions(language, mode),
      input,
      max_output_tokens: maxOutputTokens,
      tool_choice: "none",
      store: false
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.error) {
    const error = new Error(data.error?.message || `OpenAI returned ${response.status}`);
    error.code = "openai_api_error";
    error.status = response.status;
    throw error;
  }

  const text = extractOpenAiText(data);
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

async function callOpenAiLetter({ summary, env, config, mode = "letter" }) {
  if (!env.OPENAI_API_KEY) {
    const error = new Error("Missing OPENAI_API_KEY");
    error.code = "missing_openai_api_key";
    throw error;
  }

  const model = config.openAiModel;
  const analysisMode = normalizeAnalysisMode(mode);
  const language = summary.language === "en" ? "en" : "ja";
  const limits = getOpenAiTokenLimits(config, analysisMode);
  const qualityOptions = {
    allowUnicorn: isUnicornEligibleSummary(summary)
  };
  const firstAttempt = await callOpenAiAttempt({
    summary,
    env,
    config,
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
    if (retryQualityIssues.length) {
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
    const error = new Error("OpenAI response did not include output text.");
    error.code = "openai_empty_output";
    error.usage = firstAttempt.usage;
    throw error;
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

  let qualityRetry;
  try {
    qualityRetry = await callOpenAiAttempt({
      summary,
      env,
      config,
      mode: analysisMode,
      maxOutputTokens: limits.retry,
      retryKind: "quality"
    });
  } catch (error) {
    error.usage = addRequestUsage(firstAttempt.usage, error.usage);
    error.retryAttempted = true;
    error.analysisMode = analysisMode;
    error.attempts = 2;
    error.maxOutputTokens = limits.retry;
    throw error;
  }

  const combinedUsage = addRequestUsage(firstAttempt.usage, qualityRetry.usage);
  if (qualityRetry.incompleteReason || !qualityRetry.text) {
    throw createIncompleteOutputError({
      mode: analysisMode,
      incompleteReason: qualityRetry.incompleteReason || "empty_output",
      attempts: 2,
      maxOutputTokens: limits.retry,
      usage: combinedUsage
    });
  }

  const retryQualityIssues = getGeneratedLetterQualityIssues(qualityRetry.text, language, qualityOptions);
  if (retryQualityIssues.length) {
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

async function generateLetter({ summary, payload, env, config, status }) {
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
    mode: analysisMode
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
    if (!response.ok || result.success !== true) {
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
  const dailyGenerationRemaining = Math.max(0, config.dailyGenerationLimit - state.dailyGenerationCount);
  const slotGenerationRemaining = Math.max(0, config.slotGenerationLimit - slotGenerationCount);
  const totalRateLimited = state.dailyGenerationCount >= config.dailyGenerationLimit;
  const slotRateLimited = slotGenerationCount >= config.slotGenerationLimit;

  return {
    turnstileRequired: config.turnstileRequired,
    turnstileVerified: Boolean(turnstileVerification.verified),
    rateLimited: totalRateLimited || slotRateLimited,
    totalRateLimited,
    slotRateLimited,
    budgetBlocked,
    budgetWarning,
    aiEnabled: config.aiEnabled,
    dailyGenerationLimit: config.dailyGenerationLimit,
    dailyGenerationRemaining,
    slotGenerationLimit: config.slotGenerationLimit,
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
  cacheFallbackReason = null
}) {
  const cached = status === "cached";
  const servedFromSharedCache = cached && Boolean(cacheResult?.entry);
  const generatedAt = generationResult.generatedAt || cacheResult?.timing?.generatedAt || new Date().toISOString();
  const source = servedFromSharedCache
    ? "cloudflare-kv"
    : generationResult.provider === "openai"
      ? "openai"
      : "prototype-worker";
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);
  const language = summary.language === "en" ? "en" : "ja";

  return {
    status,
    source,
    clientMode: getClientMode(payload),
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

function buildGuardError(status, { usageState, config, payload, summary = {}, reason = "manual", turnstileVerification = {} }) {
  ensureSlotCounters(usageState);
  const slotKey = normalizeSlot(summary.slot);
  const analysisMode = normalizeAnalysisMode(summary.analysisMode);

  if (status === "rate_limited") {
    usageState.dailyRateLimitedCount += 1;
    usageState.dailySlotRateLimitedCounts[slotKey] = (usageState.dailySlotRateLimitedCounts[slotKey] || 0) + 1;
    incrementModeCount(usageState, "dailyModeRateLimitedCounts", analysisMode);
    incrementModeSlotCount(usageState, "dailyModeSlotRateLimitedCounts", analysisMode, slotKey);
    usageState.updatedAt = new Date().toISOString();

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
    usageState.monthlyBudgetBlockedCount += 1;
    usageState.updatedAt = new Date().toISOString();

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
    usageState.monthlyAiDisabledCount += 1;
    usageState.updatedAt = new Date().toISOString();

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

function buildUsageReport({ state, config, cacheAvailable = false }) {
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
        slotGenerationLimit: config.slotGenerationLimit
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
        rateLimited: state.dailyGenerationCount >= config.dailyGenerationLimit,
        totalRateLimited: state.dailyGenerationCount >= config.dailyGenerationLimit,
        slotRateLimited: isAnyModeSlotRateLimited(state, config),
        budgetBlocked: state.estimatedCostJpy >= config.stopBudgetJpy,
        budgetWarning: state.estimatedCostJpy >= config.warningBudgetJpy,
        aiEnabled: config.aiEnabled,
        dailyGenerationLimit: config.dailyGenerationLimit,
        dailyGenerationRemaining: Math.max(0, config.dailyGenerationLimit - state.dailyGenerationCount),
        slotGenerationLimit: config.slotGenerationLimit,
        slotGenerationRemainingBySlot: buildSlotRemainingCounts(state, config),
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
        storage: cacheAvailable ? "cloudflare-workers-kv" : "unavailable",
        freshSeconds: config.sharedCacheFreshSeconds,
        retentionSeconds: config.sharedCacheRetentionSeconds,
        note: cacheAvailable
          ? "Generated AI letter text and minimal metadata are retained temporarily in Workers KV. Glucose summaries are not stored in the shared cache."
          : "Shared cache is inactive until the AI_LETTER_CACHE KV binding is configured."
      },
      storage: {
        kind: state.kind,
        note: state.note,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt
      }
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
    this.usageState = normalizeUsageState(nextState, config);
    this.usageState.updatedAt = new Date().toISOString();
    await this.ctx.storage.put("usage-state", this.usageState);
    return cloneUsageState(this.usageState);
  }
}


async function serveSharedCachedLetter({
  cacheRead,
  fallbackReason = null,
  usageState,
  env,
  config,
  summary,
  payload,
  turnstileVerification
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
    cacheFallbackReason: fallbackReason
  }));
}

async function handleApiRequest(request, env = {}) {
    const config = readGuardConfig(env);
    const usageState = await loadUsageState(env, config);

    const url = new URL(request.url);
    if (url.pathname === "/api/gluco-letter/usage" && request.method === "GET") {
      return okResponse(buildUsageReport({
        state: usageState,
        config,
        cacheAvailable: getSharedCacheAvailability(env, config)
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
        turnstileVerification
      });
    }

    const staleCacheAvailable = cacheRead.status === "stale" && Boolean(cacheRead.entry);
    const prototypeStatus = getPrototypeStatus(payload);
    const effectiveUsageState = applyDebugUsageOverrides(usageState, payload);
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
          turnstileVerification
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
          turnstileVerification
        });
      }

      await persistUsageState(env, usageState, config);
      const { status, ...errorBody } = guardError;
      return errorResponse(errorBody, status);
    }

    let generationResult;
    try {
      generationResult = await generateLetter({
        summary,
        payload,
        env,
        config,
        status: prototypeStatus
      });
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
          turnstileVerification
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
      cacheResult: cacheWrite
    }));
}

export default {
  async fetch(request, env = {}) {
    const corsDecision = evaluateCorsRequest(request, env);

    if (request.method === "OPTIONS") {
      return handleCorsPreflight(request, corsDecision);
    }

    if (!corsDecision.allowed) {
      return buildCorsErrorResponse(corsDecision, 403);
    }

    const response = await handleApiRequest(request, env);
    return applyCorsHeaders(response, corsDecision);
  }
};
