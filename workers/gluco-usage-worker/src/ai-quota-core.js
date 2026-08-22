const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SAFE_ACCOUNT_SUBJECT_PATTERN = /^[A-Za-z0-9_.:-]{8,160}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/u;
const ANALYSIS_MODES = new Set(["letter", "deep"]);
const SUBJECT_KINDS = new Set(["device_profile", "account"]);
const RELEASE_REASONS = new Set([
  "provider_error",
  "quality_failed",
  "generation_incomplete",
  "cache_fallback",
  "request_aborted",
  "internal_error",
]);

const DEFAULTS = Object.freeze({
  enabled: false,
  timezoneOffsetHours: 9,
  freeDailyLimit: 1,
  plusDailyLimit: 5,
  reservationTtlSeconds: 600,
  retentionDays: 90,
});

export class AiQuotaError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "AiQuotaError";
    this.code = code;
    this.status = status;
  }
}

function readBoolean(value, fallback) {
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function readInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function readAiQuotaConfig(env = {}) {
  return Object.freeze({
    enabled: readBoolean(env.AI_PER_USER_QUOTA_ENABLED, DEFAULTS.enabled),
    timezoneOffsetHours: readInteger(
      env.AI_QUOTA_TIMEZONE_OFFSET_HOURS,
      DEFAULTS.timezoneOffsetHours,
      -12,
      14,
    ),
    freeDailyLimit: readInteger(
      env.AI_FREE_DAILY_LIMIT,
      DEFAULTS.freeDailyLimit,
      1,
      1,
    ),
    plusDailyLimit: readInteger(
      env.AI_PLUS_DAILY_LIMIT,
      DEFAULTS.plusDailyLimit,
      5,
      5,
    ),
    reservationTtlSeconds: readInteger(
      env.AI_QUOTA_RESERVATION_TTL_SECONDS,
      DEFAULTS.reservationTtlSeconds,
      60,
      900,
    ),
    retentionDays: readInteger(
      env.AI_QUOTA_RETENTION_DAYS,
      DEFAULTS.retentionDays,
      1,
      90,
    ),
  });
}

function requirePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiQuotaError("invalid_request");
  }
  return value;
}

function requireAllowedKeys(value, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new AiQuotaError("invalid_request");
  }
}

function validateCredential(rawCredential) {
  const credential = requirePlainObject(rawCredential);
  requireAllowedKeys(credential, new Set(["kind", "token"]));
  const kind = String(credential.kind || "");
  const token = typeof credential.token === "string" ? credential.token : "";
  if (!SUBJECT_KINDS.has(kind) || !token || token.length > 2048 || CONTROL_PATTERN.test(token)) {
    throw new AiQuotaError("authentication_required", 401);
  }
  if (kind === "device_profile" && !TOKEN_PATTERN.test(token)) {
    throw new AiQuotaError("authentication_required", 401);
  }
  if (kind === "account" && token.length < 16) {
    throw new AiQuotaError("authentication_required", 401);
  }
  return Object.freeze({ kind, token });
}

function validateReserveInput(rawInput) {
  const input = requirePlainObject(rawInput);
  requireAllowedKeys(input, new Set(["credential", "requestId", "analysisMode", "shareTrialRequestId"]));
  const requestId = String(input.requestId || "");
  const shareTrialRequestId = String(input.shareTrialRequestId || "");
  const analysisMode = String(input.analysisMode || "");
  if (
    !UUID_PATTERN.test(requestId)
    || (shareTrialRequestId && !UUID_PATTERN.test(shareTrialRequestId))
    || !ANALYSIS_MODES.has(analysisMode)
  ) {
    throw new AiQuotaError("invalid_request");
  }
  const credential = validateCredential(input.credential);
  if (shareTrialRequestId && credential.kind !== "account") {
    throw new AiQuotaError("invalid_request");
  }
  return Object.freeze({
    credential,
    requestId,
    analysisMode,
    ...(shareTrialRequestId ? { shareTrialRequestId } : {}),
  });
}

function validateReservationInput(rawInput, { allowReason = false } = {}) {
  const input = requirePlainObject(rawInput);
  requireAllowedKeys(
    input,
    allowReason ? new Set(["reservationId", "reasonCode"]) : new Set(["reservationId"]),
  );
  const reservationId = String(input.reservationId || "");
  if (!UUID_PATTERN.test(reservationId)) throw new AiQuotaError("invalid_request");
  if (!allowReason) return Object.freeze({ reservationId });
  const reasonCode = String(input.reasonCode || "");
  if (!RELEASE_REASONS.has(reasonCode)) throw new AiQuotaError("invalid_request");
  return Object.freeze({ reservationId, reasonCode });
}

function getDayKey(nowMs, timezoneOffsetHours) {
  return new Date(nowMs + timezoneOffsetHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function getMonthBounds(nowMs, timezoneOffsetHours) {
  const shifted = new Date(nowMs + timezoneOffsetHours * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const start = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const nextMonth = new Date(Date.UTC(year, month + 1, 1));
  const end = nextMonth.toISOString().slice(0, 10);
  return { start, end };
}

function getResetAt(nowMs, timezoneOffsetHours) {
  const shifted = new Date(nowMs + timezoneOffsetHours * 60 * 60 * 1000);
  const resetShiftedMs = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate() + 1,
  );
  return new Date(resetShiftedMs - timezoneOffsetHours * 60 * 60 * 1000).toISOString();
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

export async function hashQuotaSubject(kind, subjectId, cryptoImpl = crypto) {
  if (!SUBJECT_KINDS.has(kind) || !SAFE_ACCOUNT_SUBJECT_PATTERN.test(String(subjectId || ""))) {
    throw new AiQuotaError("authentication_required", 401);
  }
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`glucoscope-ai-quota:${kind}:${subjectId}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function requireServices(services) {
  if (
    !services?.store
    || typeof services.hashBearerToken !== "function"
    || typeof services.createReservationId !== "function"
  ) {
    throw new AiQuotaError("service_unavailable", 503);
  }
}

async function resolveSubject(credential, services, shareTrialRequestId = "") {
  if (credential.kind === "device_profile") {
    const tokenHash = await services.hashBearerToken(credential.token);
    const profile = await services.store.findDeviceProfileByTokenHash({ tokenHash });
    if (!profile?.id) throw new AiQuotaError("authentication_required", 401);
    return { kind: "device_profile", id: String(profile.id), tier: "free" };
  }

  if (typeof services.resolveAccountEntitlement !== "function") {
    throw new AiQuotaError("entitlement_unavailable", 503);
  }
  const result = await services.resolveAccountEntitlement({
    token: credential.token,
    ...(shareTrialRequestId ? { shareTrialRequestId } : {}),
  });
  if (result?.status === "unavailable") {
    throw new AiQuotaError("entitlement_unavailable", 503);
  }
  if (result?.status !== "ok" || !SAFE_ACCOUNT_SUBJECT_PATTERN.test(String(result.subjectId || ""))) {
    throw new AiQuotaError("authentication_required", 401);
  }
  return {
    kind: "account",
    id: String(result.subjectId),
    tier: result.plusActive === true ? "plus" : "free",
    detailedAnalysisAllowed: result.plusActive === true || result.shareTrialReserved === true,
  };
}

function publicQuota(result, resetAt) {
  return {
    tier: result.attempt?.tier || result.tier,
    dailyLimit: Number(result.attempt?.dailyLimit || result.dailyLimit || 0),
    successful: Number(result.successful || 0),
    remaining: Number(result.remaining || 0),
    resetsAt: resetAt,
  };
}

function knownError(error) {
  if (!(error instanceof AiQuotaError)) throw error;
  return {
    ok: false,
    status: "error",
    error: error.code,
    retryable: error.status >= 500,
  };
}

export async function reserveAiGeneration(rawInput, env = {}, services = {}) {
  const config = readAiQuotaConfig(env);
  if (!config.enabled) {
    return {
      ok: false,
      status: "disabled",
      error: "quota_enforcement_disabled",
      retryable: false,
    };
  }

  try {
    requireServices(services);
    const input = validateReserveInput(rawInput);
    const nowMs = Number(services.now?.() ?? Date.now());
    const subject = await resolveSubject(input.credential, services, input.shareTrialRequestId);
    if (subject.tier !== "plus" && subject.detailedAnalysisAllowed !== true && input.analysisMode === "deep") {
      throw new AiQuotaError("plus_required", 403);
    }
    const subjectKey = await hashQuotaSubject(subject.kind, subject.id, services.crypto || crypto);
    const reservationId = String(services.createReservationId());
    if (!UUID_PATTERN.test(reservationId)) throw new AiQuotaError("service_unavailable", 503);
    const dailyLimit = subject.tier === "plus"
      ? config.plusDailyLimit
      : config.freeDailyLimit;
    const result = await services.store.reserve({
      subjectKey,
      subjectKind: subject.kind,
      deviceProfileId: subject.kind === "device_profile" ? subject.id : null,
      day: getDayKey(nowMs, config.timezoneOffsetHours),
      requestId: input.requestId,
      reservationId,
      tier: subject.tier,
      dailyLimit,
      analysisMode: input.analysisMode,
      now: nowMs,
      expiresAt: nowMs + config.reservationTtlSeconds * 1000,
    });
    const resetAt = getResetAt(nowMs, config.timezoneOffsetHours);
    const quota = publicQuota({ ...result, tier: subject.tier, dailyLimit }, resetAt);

    if (result.status === "reserved") {
      return {
        ok: true,
        status: "reserved",
        reservationId: result.attempt.reservationId,
        quota,
      };
    }
    const errorByStatus = {
      limit_reached: "daily_limit_reached",
      in_progress: "request_in_progress",
      already_succeeded: "request_already_succeeded",
      already_released: "request_already_released",
      expired: "reservation_expired",
    };
    return {
      ok: false,
      status: result.status || "error",
      error: errorByStatus[result.status] || "quota_conflict",
      retryable: result.status === "expired" || result.status === "already_released",
      quota,
    };
  } catch (error) {
    return knownError(error);
  }
}

export async function completeAiGeneration(rawInput, env = {}, services = {}) {
  try {
    requireServices(services);
    const input = validateReservationInput(rawInput);
    const config = readAiQuotaConfig(env);
    const nowMs = Number(services.now?.() ?? Date.now());
    const result = await services.store.complete({ reservationId: input.reservationId, now: nowMs });
    const quota = result.attempt
      ? publicQuota(result, getResetAt(nowMs, config.timezoneOffsetHours))
      : null;
    if (result.status === "completed" || result.status === "already_succeeded") {
      return { ok: true, status: result.status, quota };
    }
    return {
      ok: false,
      status: result.status || "error",
      error: result.status === "expired" ? "reservation_expired" : "quota_finalize_failed",
      retryable: result.status === "conflict",
      quota,
    };
  } catch (error) {
    return knownError(error);
  }
}

export async function releaseAiGeneration(rawInput, env = {}, services = {}) {
  try {
    requireServices(services);
    const input = validateReservationInput(rawInput, { allowReason: true });
    const config = readAiQuotaConfig(env);
    const nowMs = Number(services.now?.() ?? Date.now());
    const result = await services.store.release({
      reservationId: input.reservationId,
      reasonCode: input.reasonCode,
      now: nowMs,
    });
    const quota = result.attempt
      ? publicQuota(result, getResetAt(nowMs, config.timezoneOffsetHours))
      : null;
    if (result.status === "released" || result.status === "already_released") {
      return { ok: true, status: result.status, quota };
    }
    return {
      ok: false,
      status: result.status || "error",
      error: result.status === "already_succeeded"
        ? "request_already_succeeded"
        : "quota_release_failed",
      retryable: false,
      quota,
    };
  } catch (error) {
    return knownError(error);
  }
}

export async function getAggregateAiUsage(env = {}, services = {}) {
  try {
    requireServices(services);
    const config = readAiQuotaConfig(env);
    const nowMs = Number(services.now?.() ?? Date.now());
    const day = getDayKey(nowMs, config.timezoneOffsetHours);
    const month = getMonthBounds(nowMs, config.timezoneOffsetHours);
    const aggregate = await services.store.getAggregate({
      day,
      monthStartDay: month.start,
      monthEndDay: month.end,
    });
    return {
      ok: true,
      status: "usage",
      dayKey: day,
      monthKey: month.start.slice(0, 7),
      resetAt: getResetAt(nowMs, config.timezoneOffsetHours),
      ...aggregate,
    };
  } catch (error) {
    return knownError(error);
  }
}

export async function runAiQuotaCleanup(store, env = {}, nowMs = Date.now()) {
  const config = readAiQuotaConfig(env);
  if (!config.enabled) {
    return {
      attemptsDeleted: 0,
      daysDeleted: 0,
    };
  }
  const cutoffMs = nowMs - config.retentionDays * DAY_MS;
  return store.cleanup({
    attemptCutoff: cutoffMs,
    dayCutoff: getDayKey(cutoffMs, config.timezoneOffsetHours),
  });
}

export const aiQuotaCoreTesting = Object.freeze({
  getDayKey,
  getMonthBounds,
  getResetAt,
  validateReserveInput,
  validateReservationInput,
});
