const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_ORIGIN = "https://afterglow21.github.io";
const ALLOWED_METHODS = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"];
const ALLOWED_HEADERS = new Set(["authorization", "content-type"]);
const DISPLAY_NAME_LIMIT = 30;
const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const EVENT_TYPES = new Set([
  "visit_day",
  "ai_generation_success",
  "ordinary_gluco_memory_count",
]);

const DEFAULTS = Object.freeze({
  enabled: false,
  noticeVersion: "2026-08-12-simple-connection-1",
  timezoneOffsetHours: 9,
  maxRequestBytes: 8192,
  maxEventsPerRequest: 20,
  profileDailyRequestLimit: 250,
  aiDailyLimit: 30,
  dailyRetentionDays: 90,
  receiptRetentionDays: 7,
  inactiveProfileRetentionDays: 90,
});

export class UsageApiError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "UsageApiError";
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

function normalizeConfiguredOrigin(value) {
  const raw = String(value || "").trim();
  try {
    const url = new URL(raw);
    return url.origin === raw && !url.username && !url.password ? raw : null;
  } catch {
    return null;
  }
}

export function readUsageConfig(env = {}) {
  return Object.freeze({
    enabled: readBoolean(env.USAGE_COLLECTION_ENABLED, DEFAULTS.enabled),
    noticeVersion: String(env.USAGE_NOTICE_VERSION || DEFAULTS.noticeVersion).slice(0, 64),
    timezoneOffsetHours: readInteger(
      env.USAGE_TIMEZONE_OFFSET_HOURS,
      DEFAULTS.timezoneOffsetHours,
      -12,
      14,
    ),
    allowedOrigin: normalizeConfiguredOrigin(env.CORS_ALLOWED_ORIGIN) || ALLOWED_ORIGIN,
    maxRequestBytes: readInteger(env.MAX_REQUEST_BYTES, DEFAULTS.maxRequestBytes, 1024, 8192),
    maxEventsPerRequest: readInteger(
      env.MAX_EVENTS_PER_REQUEST,
      DEFAULTS.maxEventsPerRequest,
      1,
      20,
    ),
    profileDailyRequestLimit: readInteger(
      env.PROFILE_DAILY_REQUEST_LIMIT,
      DEFAULTS.profileDailyRequestLimit,
      1,
      1000,
    ),
    aiDailyLimit: readInteger(
      env.AI_GENERATION_SUCCESS_DAILY_LIMIT,
      DEFAULTS.aiDailyLimit,
      1,
      30,
    ),
    dailyRetentionDays: readInteger(
      env.DAILY_USAGE_RETENTION_DAYS,
      DEFAULTS.dailyRetentionDays,
      1,
      90,
    ),
    receiptRetentionDays: readInteger(
      env.EVENT_RECEIPT_RETENTION_DAYS,
      DEFAULTS.receiptRetentionDays,
      1,
      7,
    ),
    inactiveProfileRetentionDays: readInteger(
      env.INACTIVE_PROFILE_RETENTION_DAYS,
      DEFAULTS.inactiveProfileRetentionDays,
      1,
      90,
    ),
  });
}

export function normalizeDisplayName(value) {
  let text;
  try {
    text = String(value ?? "");
  } catch {
    return "";
  }

  return Array.from(
    text
      .replace(/\s+/gu, " ")
      .replace(CONTROL_AND_BIDI_PATTERN, "")
      .trim(),
  )
    .slice(0, DISPLAY_NAME_LIMIT)
    .join("")
    .trim();
}

function requirePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new UsageApiError("invalid_request");
  }
  return value;
}

function requireAllowedKeys(value, allowedKeys) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new UsageApiError("invalid_request");
  }
}

function validateTurnstileToken(value) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > 2048
    || /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new UsageApiError("turnstile_failed", 403);
  }
  return value;
}

function validateCreateProfilePayload(payload) {
  const value = requirePlainObject(payload);
  requireAllowedKeys(value, new Set(["displayName", "turnstileToken"]));
  const displayName = normalizeDisplayName(value.displayName);
  if (!displayName) throw new UsageApiError("invalid_request");
  return Object.freeze({
    displayName,
    turnstileToken: validateTurnstileToken(value.turnstileToken),
  });
}

function validatePatchProfilePayload(payload) {
  const value = requirePlainObject(payload);
  requireAllowedKeys(value, new Set(["displayName", "collectionEnabled"]));

  const hasDisplayName = Object.hasOwn(value, "displayName");
  const hasCollectionEnabled = Object.hasOwn(value, "collectionEnabled");
  if (!hasDisplayName && !hasCollectionEnabled) throw new UsageApiError("invalid_request");
  if (hasCollectionEnabled && typeof value.collectionEnabled !== "boolean") {
    throw new UsageApiError("invalid_request");
  }

  return Object.freeze({
    hasDisplayName,
    displayName: hasDisplayName ? normalizeDisplayName(value.displayName) : undefined,
    hasCollectionEnabled,
    collectionEnabled: hasCollectionEnabled ? value.collectionEnabled : undefined,
  });
}

function validateEvent(rawEvent) {
  const event = requirePlainObject(rawEvent);
  const type = String(event.type || "");
  if (!EVENT_TYPES.has(type) || !EVENT_ID_PATTERN.test(String(event.eventId || ""))) {
    throw new UsageApiError("invalid_event");
  }

  const expectedKeys = type === "ordinary_gluco_memory_count"
    ? new Set(["eventId", "type", "count"])
    : new Set(["eventId", "type"]);
  requireAllowedKeys(event, expectedKeys);

  if (type === "ordinary_gluco_memory_count") {
    const count = Number(event.count);
    if (!Number.isSafeInteger(count) || count < 0 || count > 50) {
      throw new UsageApiError("invalid_event");
    }
    return Object.freeze({ eventId: event.eventId, type, count });
  }

  return Object.freeze({ eventId: event.eventId, type });
}

function validateEventsPayload(payload, config) {
  const value = requirePlainObject(payload);
  requireAllowedKeys(value, new Set(["events"]));
  if (
    !Array.isArray(value.events)
    || value.events.length < 1
    || value.events.length > config.maxEventsPerRequest
  ) {
    throw new UsageApiError("invalid_events");
  }
  return Object.freeze(value.events.map(validateEvent));
}

async function readLimitedJson(request, maxBytes) {
  const contentType = request.headers.get("content-type") || "";
  if (!/^application\/json(?:\s*;|$)/iu.test(contentType)) {
    throw new UsageApiError("unsupported_media_type", 415);
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new UsageApiError("request_too_large", 413);
  }

  if (!request.body) throw new UsageApiError("invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new UsageApiError("request_too_large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new UsageApiError("invalid_json");
  }
}

function requireOrigin(request, config) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== config.allowedOrigin) {
    throw new UsageApiError("origin_not_allowed", 403);
  }
  return origin;
}

function baseHeaders(origin, config) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin === config.allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(body, status, origin, config) {
  return new Response(JSON.stringify(body), {
    status,
    headers: baseHeaders(origin, config),
  });
}

function emptyResponse(status, origin, config, extraHeaders = {}) {
  const headers = baseHeaders(origin, config);
  headers.delete("Content-Type");
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(null, { status, headers });
}

function handlePreflight(request, origin, config) {
  const method = request.headers.get("access-control-request-method");
  if (!method || !ALLOWED_METHODS.includes(method) || method === "OPTIONS") {
    throw new UsageApiError("cors_method_not_allowed", 403);
  }
  const requestedHeaders = String(request.headers.get("access-control-request-headers") || "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (requestedHeaders.some((header) => !ALLOWED_HEADERS.has(header))) {
    throw new UsageApiError("cors_header_not_allowed", 403);
  }
  return emptyResponse(204, origin, config, {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
    "Access-Control-Max-Age": "600",
  });
}

function getDayKey(nowMs, timezoneOffsetHours) {
  return new Date(nowMs + timezoneOffsetHours * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

function getCutoffDay(nowMs, timezoneOffsetHours, retentionDays) {
  // Today is one retained calendar day, so a 90-day window starts 89 days ago.
  return getDayKey(nowMs - (retentionDays - 1) * DAY_MS, timezoneOffsetHours);
}

function extractBearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(header);
  if (!match || !TOKEN_PATTERN.test(match[1])) {
    throw new UsageApiError("authentication_required", 401);
  }
  return match[1];
}

function serializeProfile(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    collectionEnabled: Boolean(profile.collectionEnabled),
    noticeVersion: profile.noticeVersion,
    createdAt: new Date(profile.createdAt).toISOString(),
    updatedAt: new Date(profile.updatedAt).toISOString(),
    lastSeenAt: new Date(profile.lastSeenAt).toISOString(),
  };
}

function serializePublicProfile(profile) {
  return {
    id: profile.id,
    displayName: profile.displayName,
    collectionEnabled: Boolean(profile.collectionEnabled),
  };
}

async function requireAuthenticatedProfile(
  request,
  services,
  config,
  nowMs,
  { consumeRequest = false } = {},
) {
  const token = extractBearerToken(request);
  const tokenHash = await services.hashBearerToken(token);
  const result = await services.store.authenticate({
    tokenHash,
    day: getDayKey(nowMs, config.timezoneOffsetHours),
    now: nowMs,
    requestLimit: config.profileDailyRequestLimit,
    consumeRequest,
  });
  if (result?.status === "rate_limited") throw new UsageApiError("rate_limited", 429);
  if (result?.status !== "ok" || !result.profile) {
    throw new UsageApiError("authentication_required", 401);
  }
  return result.profile;
}

function requireServices(services) {
  if (
    !services?.store
    || typeof services.verifyTurnstile !== "function"
    || typeof services.createCredentials !== "function"
    || typeof services.hashBearerToken !== "function"
  ) {
    throw new UsageApiError("service_unavailable", 503);
  }
}

async function createProfile(request, env, services, config, origin, nowMs) {
  if (!config.enabled) throw new UsageApiError("usage_collection_paused", 503);
  const payload = validateCreateProfilePayload(await readLimitedJson(request, config.maxRequestBytes));
  await services.verifyTurnstile({
    token: payload.turnstileToken,
    request,
    env,
    config,
  });
  const credentials = await services.createCredentials();
  const profile = await services.store.createProfile({
    id: credentials.id,
    tokenHash: credentials.tokenHash,
    displayName: payload.displayName,
    noticeVersion: config.noticeVersion,
    day: getDayKey(nowMs, config.timezoneOffsetHours),
    now: nowMs,
  });
  return jsonResponse({
    ok: true,
    profile: serializePublicProfile(profile),
    profileToken: credentials.bearerToken,
  }, 201, origin, config);
}

async function patchProfile(request, services, config, origin, nowMs) {
  const profile = await requireAuthenticatedProfile(request, services, config, nowMs);
  const patch = validatePatchProfilePayload(await readLimitedJson(request, config.maxRequestBytes));
  if (patch.hasCollectionEnabled && patch.collectionEnabled && !config.enabled) {
    throw new UsageApiError("usage_collection_paused", 503);
  }
  const updated = await services.store.updateProfile({
    profileId: profile.id,
    ...patch,
    now: nowMs,
  });
  return jsonResponse({ ok: true, profile: serializePublicProfile(updated) }, 200, origin, config);
}

async function recordEvents(request, services, config, origin, nowMs) {
  if (!config.enabled) throw new UsageApiError("usage_collection_paused", 503);
  const profile = await requireAuthenticatedProfile(
    request,
    services,
    config,
    nowMs,
    { consumeRequest: true },
  );
  if (!profile.collectionEnabled) throw new UsageApiError("usage_collection_stopped", 403);
  const events = validateEventsPayload(
    await readLimitedJson(request, config.maxRequestBytes),
    config,
  );
  const day = getDayKey(nowMs, config.timezoneOffsetHours);
  const receiptExpiresAt = nowMs + config.receiptRetentionDays * DAY_MS;
  const results = [];
  for (const event of events) {
    results.push(await services.store.recordEvent({
      profileId: profile.id,
      day,
      event,
      now: nowMs,
      receiptExpiresAt,
      aiDailyLimit: config.aiDailyLimit,
    }));
  }
  return jsonResponse({ ok: true, results }, 200, origin, config);
}

async function exportProfile(request, services, config, origin, nowMs) {
  const profile = await requireAuthenticatedProfile(request, services, config, nowMs);
  const exported = await services.store.exportProfile({
    profileId: profile.id,
    cutoffDay: getCutoffDay(nowMs, config.timezoneOffsetHours, config.dailyRetentionDays),
  });
  return jsonResponse({
    ok: true,
    export: {
      schemaVersion: 1,
      exportedAt: new Date(nowMs).toISOString(),
      profile: serializeProfile(exported.profile),
      dailyUsage: exported.dailyUsage,
    },
  }, 200, origin, config);
}

async function deleteProfile(request, services, config, origin, nowMs) {
  const profile = await requireAuthenticatedProfile(request, services, config, nowMs);
  await services.store.deleteProfile({ profileId: profile.id });
  return jsonResponse({ ok: true, deleted: true }, 200, origin, config);
}

export async function handleUsageRequest(request, env = {}, services = {}) {
  const config = readUsageConfig(env);
  let origin = null;
  try {
    origin = requireOrigin(request, config);
    if (request.method === "OPTIONS") return handlePreflight(request, origin, config);
    requireServices(services);

    const url = new URL(request.url);
    if (url.search) throw new UsageApiError("invalid_request");
    const nowMs = Number(services.now?.() ?? Date.now());

    if (url.pathname === "/v1/profiles" && request.method === "POST") {
      return await createProfile(request, env, services, config, origin, nowMs);
    }
    if (url.pathname === "/v1/me" && request.method === "PATCH") {
      return await patchProfile(request, services, config, origin, nowMs);
    }
    if (url.pathname === "/v1/events" && request.method === "POST") {
      return await recordEvents(request, services, config, origin, nowMs);
    }
    if (url.pathname === "/v1/me/export" && request.method === "GET") {
      return await exportProfile(request, services, config, origin, nowMs);
    }
    if (url.pathname === "/v1/me" && request.method === "DELETE") {
      return await deleteProfile(request, services, config, origin, nowMs);
    }
    throw new UsageApiError("not_found", 404);
  } catch (error) {
    const apiError = error instanceof UsageApiError
      ? error
      : new UsageApiError("internal_error", 500);
    return jsonResponse({ ok: false, error: apiError.code }, apiError.status, origin, config);
  }
}

export async function runUsageCleanup(store, env = {}, nowMs = Date.now()) {
  const config = readUsageConfig(env);
  return store.cleanup({
    receiptCutoff: nowMs,
    dailyCutoffDay: getCutoffDay(
      nowMs,
      config.timezoneOffsetHours,
      config.dailyRetentionDays,
    ),
    inactiveProfileCutoff: nowMs - config.inactiveProfileRetentionDays * DAY_MS,
  });
}

export const usageCoreTesting = Object.freeze({
  getDayKey,
  validateCreateProfilePayload,
  validateEventsPayload,
  validatePatchProfilePayload,
});
