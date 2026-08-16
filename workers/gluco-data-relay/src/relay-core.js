const DEFAULTS = Object.freeze({
  allowedOrigins: ["https://glucoscope.app"],
  allowRequestsWithoutOrigin: false,
  enabled: false,
  glurooHostSuffix: ".ns.gluroo.com",
  maxEntries: 12_000,
  maxRangeDays: 31,
  maxRequestBytes: 8_192,
  maxUpstreamBytes: 6 * 1024 * 1024,
  upstreamTimeoutMs: 15_000,
  turnstileExpectedHostname: "glucoscope.app",
  turnstileExpectedAction: "glucoscope-data-relay",
  turnstileTimeoutMs: 10_000,
  deviceSessionsEnabled: false,
  deviceSessionIdleTtlSeconds: 180 * 24 * 60 * 60,
  deviceSessionDailyLimit: 3_000,
  globalWarningDaily: 20_000,
  globalHardDaily: 50_000,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_SOURCE_URL_LENGTH = 2_048;
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;
const DEVICE_SESSION_COOKIE_NAME = "__Host-glucoscope_relay_session";
const DEVICE_SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DEVICE_SESSION_PATHS = new Set(["/v1/device-session", "/v1/device-session/status"]);
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_DIAGNOSTIC_CODES = Object.freeze({
  networkOrTimeout: "710001",
  siteverifyHttp: "710002",
  siteverifyResponse: "710003",
  missingInputSecret: "710101",
  invalidInputSecret: "710102",
  missingInputResponse: "710201",
  invalidInputResponse: "710202",
  badRequest: "710301",
  timeoutOrDuplicate: "710401",
  internalError: "710501",
  hostnameMismatch: "710601",
  actionMismatch: "710602",
  unknownFailure: "710999",
});
const TURNSTILE_SITEVERIFY_ERROR_CODES = new Map([
  ["missing-input-secret", TURNSTILE_DIAGNOSTIC_CODES.missingInputSecret],
  ["invalid-input-secret", TURNSTILE_DIAGNOSTIC_CODES.invalidInputSecret],
  ["missing-input-response", TURNSTILE_DIAGNOSTIC_CODES.missingInputResponse],
  ["invalid-input-response", TURNSTILE_DIAGNOSTIC_CODES.invalidInputResponse],
  ["bad-request", TURNSTILE_DIAGNOSTIC_CODES.badRequest],
  ["timeout-or-duplicate", TURNSTILE_DIAGNOSTIC_CODES.timeoutOrDuplicate],
  ["internal-error", TURNSTILE_DIAGNOSTIC_CODES.internalError],
]);
const SAFE_TURNSTILE_DIAGNOSTIC_PATTERN = /^71\d{4}$/u;
const ENTRY_KEYS = new Set(["sourceUrl", "credential", "from", "to", "limit"]);
const SESSION_KEYS = new Set(["turnstileToken", "sourceUrl", "credential"]);
const DEVICE_SESSION_STATUS_KEYS = new Set();
const ALLOWED_DIRECTIONS = new Set([
  "DoubleUp",
  "SingleUp",
  "FortyFiveUp",
  "Flat",
  "FortyFiveDown",
  "SingleDown",
  "DoubleDown",
  "NOT COMPUTABLE",
  "RATE OUT OF RANGE",
  "None",
]);

export class RelayError extends Error {
  constructor(code, status = 400, details = {}) {
    super(code);
    this.name = "RelayError";
    this.code = code;
    this.status = status;
    const turnstileErrorCode = String(details.turnstileErrorCode || "");
    if (SAFE_TURNSTILE_DIAGNOSTIC_PATTERN.test(turnstileErrorCode)) {
      this.turnstileErrorCode = turnstileErrorCode;
    }
  }
}

function getTurnstileFailureDiagnostic(result) {
  const errorCodes = Array.isArray(result?.["error-codes"]) ? result["error-codes"] : [];
  for (const errorCode of errorCodes) {
    const diagnosticCode = TURNSTILE_SITEVERIFY_ERROR_CODES.get(String(errorCode));
    if (diagnosticCode) return diagnosticCode;
  }
  return TURNSTILE_DIAGNOSTIC_CODES.unknownFailure;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).toLowerCase() === "true";
}

function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function readConfig(env = {}) {
  const allowedOrigins = String(env.CORS_ALLOWED_ORIGINS || DEFAULTS.allowedOrigins.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const globalHardDaily = parsePositiveInteger(
    env.GLOBAL_HARD_DAILY,
    DEFAULTS.globalHardDaily,
    { max: 1_000_000 },
  );
  const globalWarningDaily = Math.min(
    parsePositiveInteger(env.GLOBAL_WARNING_DAILY, DEFAULTS.globalWarningDaily, {
      max: 1_000_000,
    }),
    globalHardDaily,
  );

  return Object.freeze({
    allowedOrigins,
    allowRequestsWithoutOrigin: parseBoolean(
      env.CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN,
      DEFAULTS.allowRequestsWithoutOrigin,
    ),
    enabled: parseBoolean(env.RELAY_ENABLED, DEFAULTS.enabled),
    glurooHostSuffix: String(env.GLUROO_HOST_SUFFIX || DEFAULTS.glurooHostSuffix).toLowerCase(),
    maxEntries: parsePositiveInteger(env.MAX_ENTRIES, DEFAULTS.maxEntries, { max: 100_000 }),
    maxRangeDays: parsePositiveInteger(env.MAX_RANGE_DAYS, DEFAULTS.maxRangeDays, { max: 366 }),
    maxRequestBytes: parsePositiveInteger(env.MAX_REQUEST_BYTES, DEFAULTS.maxRequestBytes, {
      max: 1024 * 1024,
    }),
    maxUpstreamBytes: parsePositiveInteger(env.MAX_UPSTREAM_BYTES, DEFAULTS.maxUpstreamBytes, {
      max: 50 * 1024 * 1024,
    }),
    upstreamTimeoutMs: parsePositiveInteger(
      env.UPSTREAM_TIMEOUT_MS,
      DEFAULTS.upstreamTimeoutMs,
      { max: 60_000 },
    ),
    turnstileExpectedHostname: String(
      env.TURNSTILE_EXPECTED_HOSTNAME || DEFAULTS.turnstileExpectedHostname,
    ).toLowerCase(),
    turnstileExpectedAction: String(
      env.TURNSTILE_EXPECTED_ACTION || DEFAULTS.turnstileExpectedAction,
    ),
    turnstileTimeoutMs: parsePositiveInteger(
      env.TURNSTILE_TIMEOUT_MS,
      DEFAULTS.turnstileTimeoutMs,
      { max: 30_000 },
    ),
    deviceSessionsEnabled: parseBoolean(
      env.RELAY_DEVICE_SESSIONS_ENABLED,
      DEFAULTS.deviceSessionsEnabled,
    ),
    deviceSessionIdleTtlSeconds: parsePositiveInteger(
      env.RELAY_DEVICE_SESSION_IDLE_TTL_SECONDS,
      DEFAULTS.deviceSessionIdleTtlSeconds,
      { min: 60, max: 366 * 24 * 60 * 60 },
    ),
    deviceSessionDailyLimit: parsePositiveInteger(
      env.RELAY_DEVICE_SESSION_DAILY_LIMIT,
      DEFAULTS.deviceSessionDailyLimit,
      { max: 1_000_000 },
    ),
    globalWarningDaily,
    globalHardDaily,
  });
}

export function validateSourceUrl(rawSourceUrl, hostSuffix = DEFAULTS.glurooHostSuffix) {
  if (
    typeof rawSourceUrl !== "string" ||
    rawSourceUrl.length < 1 ||
    rawSourceUrl.length > MAX_SOURCE_URL_LENGTH
  ) {
    throw new RelayError("invalid_request");
  }

  let parsed;
  try {
    parsed = new URL(rawSourceUrl);
  } catch {
    throw new RelayError("invalid_request");
  }

  if (parsed.protocol !== "https:") throw new RelayError("destination_not_allowed");
  if (parsed.username || parsed.password) throw new RelayError("destination_not_allowed");
  if (parsed.port) throw new RelayError("destination_not_allowed");
  if (parsed.hash) throw new RelayError("destination_not_allowed");

  const hostname = parsed.hostname.toLowerCase();
  const normalizedSuffix = String(hostSuffix).toLowerCase();
  const suffixHost = normalizedSuffix.startsWith(".") ? normalizedSuffix.slice(1) : normalizedSuffix;

  if (!normalizedSuffix.startsWith(".")) throw new RelayError("destination_not_allowed");
  if (hostname === suffixHost || !hostname.endsWith(normalizedSuffix)) {
    throw new RelayError("destination_not_allowed");
  }

  const instanceLabel = hostname.slice(0, -normalizedSuffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(instanceLabel)) {
    throw new RelayError("destination_not_allowed");
  }

  return `https://${hostname}`;
}

function parseIsoDate(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 40) {
    throw new RelayError("invalid_request");
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new RelayError("invalid_request");
  return { timestamp, iso: new Date(timestamp).toISOString() };
}

export function validateRelayPayload(payload, config = readConfig()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RelayError("invalid_request");
  }

  for (const key of Object.keys(payload)) {
    if (!ENTRY_KEYS.has(key)) throw new RelayError("invalid_request");
  }

  const sourceUrl = validateSourceUrl(payload.sourceUrl, config.glurooHostSuffix);

  if (
    typeof payload.credential !== "string" ||
    payload.credential.length < 1 ||
    payload.credential.length > MAX_CREDENTIAL_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(payload.credential)
  ) {
    throw new RelayError("invalid_request");
  }

  const limit = payload.limit === undefined ? 2 : Number(payload.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > config.maxEntries) {
    throw new RelayError("invalid_request");
  }

  let from;
  let to;
  if (payload.from !== undefined || payload.to !== undefined) {
    if (payload.from === undefined || payload.to === undefined) {
      throw new RelayError("invalid_request");
    }
    const parsedFrom = parseIsoDate(payload.from);
    const parsedTo = parseIsoDate(payload.to);
    if (parsedTo.timestamp < parsedFrom.timestamp) throw new RelayError("invalid_request");
    if (parsedTo.timestamp - parsedFrom.timestamp > config.maxRangeDays * DAY_MS) {
      throw new RelayError("invalid_request");
    }
    from = parsedFrom.iso;
    to = parsedTo.iso;
  }

  return Object.freeze({
    sourceUrl,
    credential: payload.credential,
    limit,
    from,
    to,
  });
}

function validateTurnstileTokenValue(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_TURNSTILE_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new RelayError("turnstile_failed", 403);
  }
  return value;
}

export function validateDeviceSessionCreationPayload(payload, config = readConfig()) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RelayError("invalid_request");
  }
  for (const key of Object.keys(payload)) {
    if (!SESSION_KEYS.has(key)) throw new RelayError("invalid_request");
  }
  const connection = validateRelayPayload({
    sourceUrl: payload.sourceUrl,
    credential: payload.credential,
    limit: 2,
  }, config);
  return Object.freeze({
    turnstileToken: validateTurnstileTokenValue(payload.turnstileToken),
    sourceUrl: connection.sourceUrl,
    credential: connection.credential,
  });
}

export function validateDeviceSessionStatusPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RelayError("invalid_request");
  }
  for (const key of Object.keys(payload)) {
    if (!DEVICE_SESSION_STATUS_KEYS.has(key)) throw new RelayError("invalid_request");
  }
  return Object.freeze({});
}

export function buildUpstreamUrl(payload, config = readConfig()) {
  const validated = validateRelayPayload(payload, config);
  const upstream = new URL("/api/v1/entries.json", `${validated.sourceUrl}/`);
  upstream.searchParams.set("count", String(validated.limit));
  if (validated.from && validated.to) {
    upstream.searchParams.set("find[dateString][$gte]", validated.from);
    upstream.searchParams.set("find[dateString][$lte]", validated.to);
  }
  upstream.searchParams.set("token", validated.credential);
  return { upstream, validated };
}

async function readLimitedStream(stream, maxBytes, errorCode, status) {
  if (!stream) throw new RelayError(errorCode, status);

  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RelayError(errorCode, status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function parseJsonRequest(request, config = readConfig()) {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (!Number.isFinite(length) || length < 0 || length > config.maxRequestBytes) {
      throw new RelayError("invalid_request", 413);
    }
  }

  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RelayError("invalid_request", 415);
  }

  const contentEncoding = (request.headers.get("content-encoding") || "identity").toLowerCase();
  if (contentEncoding !== "identity") throw new RelayError("invalid_request", 415);

  const bytes = await readLimitedStream(
    request.body,
    config.maxRequestBytes,
    "invalid_request",
    413,
  );

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RelayError("invalid_request");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new RelayError("invalid_request");
  }
}

async function readResponseBytes(response, maxBytes) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new RelayError("upstream_response_too_large", 502);
    }
  }

  if (!response.body) return new Uint8Array();
  return readLimitedStream(response.body, maxBytes, "upstream_response_too_large", 502);
}

function normalizeDate(entry) {
  let timestamp = Number(entry.date);
  if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < 10_000_000_000) {
    timestamp *= 1000;
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    timestamp = Date.parse(entry.dateString);
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8_640_000_000_000_000) {
    return null;
  }
  return timestamp;
}

export function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;

  const sgv = Number(entry.sgv);
  if (!Number.isFinite(sgv) || sgv <= 0 || sgv > 1000) return null;

  const date = normalizeDate(entry);
  if (!date) return null;

  const normalized = {
    sgv: Math.round(sgv),
    date,
    dateString: new Date(date).toISOString(),
  };

  if (typeof entry.direction === "string" && ALLOWED_DIRECTIONS.has(entry.direction)) {
    normalized.direction = entry.direction;
  }

  return normalized;
}

export function normalizeEntries(rawEntries, limit) {
  if (!Array.isArray(rawEntries)) throw new RelayError("unsupported_data_format", 502);
  if (rawEntries.length === 0) return [];

  const normalized = rawEntries
    .map(normalizeEntry)
    .filter(Boolean)
    .slice(0, limit);

  if (normalized.length === 0) throw new RelayError("unsupported_data_format", 502);
  return normalized;
}

export async function fetchGlurooEntries(payload, config = readConfig(), fetchImpl = fetch) {
  const { upstream, validated } = buildUpstreamUrl(payload, config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.upstreamTimeoutMs);

  let response;
  try {
    response = await fetchImpl(upstream.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) throw new RelayError("upstream_timeout", 504);
    throw new RelayError("upstream_unavailable", 502);
  } finally {
    clearTimeout(timer);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new RelayError("destination_not_allowed", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new RelayError("authentication_failed", 401);
  }
  if (!response.ok) throw new RelayError("upstream_unavailable", 502);

  const bytes = await readResponseBytes(response, config.maxUpstreamBytes);
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RelayError("unsupported_data_format", 502);
  }

  return normalizeEntries(parsed, validated.limit);
}

function requireSecret(value, minimumLength = 16) {
  if (typeof value !== "string" || value.length < minimumLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  return value;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

async function importHmacKey(secret, usages) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usages,
  );
}

function validateDeviceSessionToken(value) {
  if (typeof value !== "string" || !DEVICE_SESSION_TOKEN_PATTERN.test(value)) {
    throw new RelayError("device_session_invalid", 401);
  }
  return value;
}

async function deriveDeviceHmac(value, secret, purpose) {
  const hmacSecret = requireSecret(secret, 32);
  const key = await importHmacKey(hmacSecret, ["sign"]);
  const message = new TextEncoder().encode(`${purpose}\u0000${value}`);
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, message)),
  );
}

export function generateDeviceSessionToken(randomBytes = (bytes) => crypto.getRandomValues(bytes)) {
  const bytes = new Uint8Array(32);
  const generated = randomBytes(bytes);
  if (!(generated instanceof Uint8Array) || generated.byteLength !== bytes.byteLength) {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  return bytesToBase64Url(generated);
}

export async function deriveDeviceSessionId(token, secret) {
  return deriveDeviceHmac(validateDeviceSessionToken(token), secret, "device-session-token-v1");
}

export async function deriveSourceCredentialFingerprint(
  sourceUrl,
  credential,
  tokenId,
  secret,
  config = readConfig(),
) {
  validateDeviceSessionToken(tokenId);
  const validated = validateRelayPayload({ sourceUrl, credential, limit: 1 }, config);
  return deriveDeviceHmac(
    `${tokenId}\u0000${validated.sourceUrl}\u0000${validated.credential}`,
    secret,
    "device-session-source-v1",
  );
}

export function readDeviceSessionCookie(request) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const matches = [];
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    if (trimmed.slice(0, separator) === DEVICE_SESSION_COOKIE_NAME) {
      matches.push(trimmed.slice(separator + 1));
    }
  }
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new RelayError("device_session_invalid", 401);
  return validateDeviceSessionToken(matches[0]);
}

export function buildDeviceSessionCookie(token, config = readConfig()) {
  validateDeviceSessionToken(token);
  return [
    `${DEVICE_SESSION_COOKIE_NAME}=${token}`,
    "Path=/",
    `Max-Age=${config.deviceSessionIdleTtlSeconds}`,
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
  ].join("; ");
}

export function buildDeviceSessionClearCookie() {
  return [
    `${DEVICE_SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Secure",
    "HttpOnly",
    "SameSite=Strict",
  ].join("; ");
}

function getDeviceSessionStub(env, tokenId) {
  const binding = env.RELAY_DEVICE_SESSION;
  if (!binding || typeof binding.getByName !== "function") {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  try {
    return binding.getByName(tokenId);
  } catch {
    throw new RelayError("relay_temporarily_paused", 503);
  }
}

function assertDeviceSessionInfrastructure(env) {
  requireSecret(env.RELAY_DEVICE_SESSION_SECRET, 32);
  if (!env.RELAY_DEVICE_SESSION || typeof env.RELAY_DEVICE_SESSION.getByName !== "function") {
    throw new RelayError("relay_temporarily_paused", 503);
  }
}

function validateDeviceSessionResult(result) {
  const allowedStatuses = new Set(["active", "invalid", "source_mismatch", "rate_limited"]);
  if (!result || typeof result !== "object" || !allowedStatuses.has(result.status)) {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  return result;
}

export async function issueDeviceSession({ env, config = readConfig(env), nowMs = Date.now(), randomBytes }) {
  const token = generateDeviceSessionToken(randomBytes);
  const tokenId = await deriveDeviceSessionId(token, env.RELAY_DEVICE_SESSION_SECRET);
  const stub = getDeviceSessionStub(env, tokenId);
  let result;
  try {
    result = await stub.create({
      tokenId,
      nowMs,
      idleTtlMs: config.deviceSessionIdleTtlSeconds * 1000,
    });
  } catch {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  validateDeviceSessionResult(result);
  if (result.status !== "active") throw new RelayError("relay_temporarily_paused", 503);
  return Object.freeze({ token, tokenId });
}

export async function authorizeDeviceSession({
  env,
  token,
  sourceUrl = null,
  credential = null,
  consume = false,
  config = readConfig(env),
  nowMs = Date.now(),
}) {
  const tokenId = await deriveDeviceSessionId(token, env.RELAY_DEVICE_SESSION_SECRET);
  const sourceFingerprint = sourceUrl === null && credential === null
    ? null
    : await deriveSourceCredentialFingerprint(
      sourceUrl,
      credential,
      tokenId,
      env.RELAY_DEVICE_SESSION_SECRET,
      config,
    );
  const stub = getDeviceSessionStub(env, tokenId);
  let result;
  try {
    result = await stub.authorize({
      tokenId,
      sourceFingerprint,
      consume,
      dailyLimit: config.deviceSessionDailyLimit,
      nowMs,
      idleTtlMs: config.deviceSessionIdleTtlSeconds * 1000,
    });
  } catch {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  validateDeviceSessionResult(result);
  if (result.status === "invalid") throw new RelayError("device_session_invalid", 401);
  if (result.status === "source_mismatch") {
    throw new RelayError("device_session_source_mismatch", 401);
  }
  if (result.status === "rate_limited") throw new RelayError("rate_limited", 429);
  return Object.freeze({ tokenId, result });
}

export async function revokeDeviceSession({ env, token }) {
  const tokenId = await deriveDeviceSessionId(token, env.RELAY_DEVICE_SESSION_SECRET);
  const stub = getDeviceSessionStub(env, tokenId);
  try {
    const result = await stub.revoke({ tokenId });
    if (!result || (result.status !== "revoked" && result.status !== "absent")) {
      throw new RelayError("relay_temporarily_paused", 503);
    }
    return result;
  } catch (error) {
    if (error instanceof RelayError) throw error;
    throw new RelayError("relay_temporarily_paused", 503);
  }
}

export async function verifyTurnstileToken(
  turnstileToken,
  env,
  config = readConfig(env),
  fetchImpl = fetch,
) {
  const validatedToken = validateTurnstileTokenValue(turnstileToken);
  const secret = requireSecret(env.TURNSTILE_SECRET_KEY, 16);
  const siteverifyBody = new URLSearchParams({
    secret,
    response: validatedToken,
  });

  let response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: siteverifyBody,
      signal: AbortSignal.timeout(config.turnstileTimeoutMs),
    });
  } catch {
    throw new RelayError("turnstile_failed", 503, {
      turnstileErrorCode: TURNSTILE_DIAGNOSTIC_CODES.networkOrTimeout,
    });
  }

  if (!response.ok) {
    throw new RelayError("turnstile_failed", 503, {
      turnstileErrorCode: TURNSTILE_DIAGNOSTIC_CODES.siteverifyHttp,
    });
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new RelayError("turnstile_failed", 503, {
      turnstileErrorCode: TURNSTILE_DIAGNOSTIC_CODES.siteverifyResponse,
    });
  }

  if (result?.success !== true) {
    throw new RelayError("turnstile_failed", 403, {
      turnstileErrorCode: getTurnstileFailureDiagnostic(result),
    });
  }
  if (String(result.hostname || "").toLowerCase() !== config.turnstileExpectedHostname) {
    throw new RelayError("turnstile_failed", 403, {
      turnstileErrorCode: TURNSTILE_DIAGNOSTIC_CODES.hostnameMismatch,
    });
  }
  if (result.action !== config.turnstileExpectedAction) {
    throw new RelayError("turnstile_failed", 403, {
      turnstileErrorCode: TURNSTILE_DIAGNOSTIC_CODES.actionMismatch,
    });
  }

  return true;
}

async function consumeCounter(binding, objectName, bucket, limit) {
  if (!binding || typeof binding.idFromName !== "function" || typeof binding.get !== "function") {
    throw new RelayError("relay_temporarily_paused", 503);
  }

  let response;
  try {
    const id = binding.idFromName(objectName);
    const stub = binding.get(id);
    response = await stub.fetch("https://relay-counter.internal/consume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket, limit }),
    });
  } catch {
    throw new RelayError("relay_temporarily_paused", 503);
  }

  let result;
  try {
    result = await response.json();
  } catch {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  if (
    (response.status !== 200 && response.status !== 429) ||
    typeof result?.allowed !== "boolean" ||
    !Number.isSafeInteger(result.count)
  ) {
    throw new RelayError("relay_temporarily_paused", 503);
  }
  return result;
}

export async function consumeGlobalRelayLimit(env, config = readConfig(env), nowMs = Date.now()) {
  const bucket = new Date(nowMs).toISOString().slice(0, 10);
  const globalResult = await consumeCounter(
    env.RELAY_USAGE_COUNTER,
    "global",
    bucket,
    config.globalHardDaily,
  );
  if (!globalResult.allowed) throw new RelayError("relay_temporarily_paused", 503);
  return Object.freeze({
    globalCount: globalResult.count,
    warning: globalResult.count >= config.globalWarningDaily,
  });
}

function buildCorsHeaders(origin, config) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    Pragma: "no-cache",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin && config.allowedOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  return headers;
}

function jsonResponse(body, status, origin, config, extraHeaders = {}) {
  const headers = buildCorsHeaders(origin, config);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify(body), {
    status,
    headers,
  });
}

function assertAllowedOrigin(request, config) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (!config.allowRequestsWithoutOrigin) throw new RelayError("invalid_request", 403);
    return null;
  }
  if (!config.allowedOrigins.includes(origin)) throw new RelayError("invalid_request", 403);
  return origin;
}

export async function handleRelayRequest(request, env = {}, services = {}) {
  const config = readConfig(env);
  const nowMs = typeof services.now === "function" ? services.now() : Date.now();
  const upstreamFetch = services.upstreamFetch || fetch;
  const turnstileFetch = services.turnstileFetch || fetch;
  const verifyTurnstile = services.verifyTurnstile || verifyTurnstileToken;
  const consumeGlobalLimit = services.consumeGlobalLimit || consumeGlobalRelayLimit;
  const issuePersistentSession = services.issueDeviceSession || issueDeviceSession;
  const authorizePersistentSession = services.authorizeDeviceSession || authorizeDeviceSession;
  const revokePersistentSession = services.revokeDeviceSession || revokeDeviceSession;
  const randomBytes = services.randomBytes;
  let origin = null;
  let clearDeviceCookieOnError = false;

  try {
    origin = assertAllowedOrigin(request, config);

    const url = new URL(request.url);
    if (
      url.pathname !== "/v1/entries" &&
      !DEVICE_SESSION_PATHS.has(url.pathname)
    ) {
      throw new RelayError("invalid_request", 404);
    }
    if (url.search) throw new RelayError("invalid_request");

    if (request.method === "OPTIONS") {
      const headers = buildCorsHeaders(origin, config);
      headers.set(
        "Access-Control-Allow-Methods",
        url.pathname === "/v1/device-session" ? "POST, DELETE, OPTIONS" : "POST, OPTIONS",
      );
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Max-Age", "600");
      headers.delete("Content-Type");
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/v1/device-session" && request.method === "DELETE") {
      clearDeviceCookieOnError = true;
      let token = null;
      try {
        token = readDeviceSessionCookie(request);
      } catch (error) {
        if (!(error instanceof RelayError) || error.code !== "device_session_invalid") throw error;
      }
      if (token) await revokePersistentSession({ env, token });
      return jsonResponse(
        { ok: true },
        200,
        origin,
        config,
        { "Set-Cookie": buildDeviceSessionClearCookie() },
      );
    }

    if (request.method !== "POST") throw new RelayError("invalid_request", 405);
    if (!config.enabled) throw new RelayError("relay_temporarily_paused", 503);

    const payload = await parseJsonRequest(request, config);

    if (url.pathname === "/v1/device-session") {
      if (!config.deviceSessionsEnabled) throw new RelayError("relay_temporarily_paused", 503);
      const session = validateDeviceSessionCreationPayload(payload, config);
      await verifyTurnstile(session.turnstileToken, env, config, turnstileFetch);
      assertDeviceSessionInfrastructure(env);

      let previousToken = null;
      try {
        previousToken = readDeviceSessionCookie(request);
      } catch (error) {
        if (!(error instanceof RelayError) || error.code !== "device_session_invalid") throw error;
      }

      // Prove the candidate source before replacing a working browser session.
      // A typo or provider outage therefore leaves the previous connection usable.
      await consumeGlobalLimit(env, config, nowMs);
      const verifiedEntries = await fetchGlurooEntries({
        sourceUrl: session.sourceUrl,
        credential: session.credential,
        limit: 2,
      }, config, upstreamFetch);
      if (verifiedEntries.length === 0) throw new RelayError("no_glucose_data", 422);

      let issued = null;
      try {
        issued = await issuePersistentSession({ env, config, nowMs, randomBytes });
        await authorizePersistentSession({
          env,
          token: issued.token,
          sourceUrl: session.sourceUrl,
          credential: session.credential,
          consume: true,
          config,
          nowMs,
        });
        if (previousToken) await revokePersistentSession({ env, token: previousToken });
      } catch (error) {
        if (issued?.token) {
          try {
            await revokePersistentSession({ env, token: issued.token });
          } catch {
            // The unused anonymous candidate remains bounded by its alarm.
          }
        }
        throw error;
      }
      return jsonResponse(
        { ok: true, session: { status: "active" }, entries: verifiedEntries },
        201,
        origin,
        config,
        { "Set-Cookie": buildDeviceSessionCookie(issued.token, config) },
      );
    }

    if (url.pathname === "/v1/device-session/status") {
      if (!config.deviceSessionsEnabled) throw new RelayError("relay_temporarily_paused", 503);
      validateDeviceSessionStatusPayload(payload);
      const token = readDeviceSessionCookie(request);
      if (!token) throw new RelayError("device_session_invalid", 401);
      await authorizePersistentSession({ env, token, config, nowMs, consume: false });
      return jsonResponse(
        { ok: true, session: { status: "active" } },
        200,
        origin,
        config,
        { "Set-Cookie": buildDeviceSessionCookie(token, config) },
      );
    }

    if (!config.deviceSessionsEnabled) throw new RelayError("relay_temporarily_paused", 503);
    const cookieToken = readDeviceSessionCookie(request);
    if (!cookieToken) throw new RelayError("device_session_invalid", 401);
    const validated = validateRelayPayload(payload, config);
    // The stable device counter is consumed before the Worker-wide counter.
    await authorizePersistentSession({
      env,
      token: cookieToken,
      sourceUrl: validated.sourceUrl,
      credential: validated.credential,
      consume: true,
      config,
      nowMs,
    });
    await consumeGlobalLimit(env, config, nowMs);
    const entries = await fetchGlurooEntries(validated, config, upstreamFetch);
    return jsonResponse(
      { ok: true, entries },
      200,
      origin,
      config,
      { "Set-Cookie": buildDeviceSessionCookie(cookieToken, config) },
    );
  } catch (error) {
    const relayError = error instanceof RelayError ? error : new RelayError("upstream_unavailable", 502);
    const body = { ok: false, error: relayError.code };
    if (
      relayError.code === "turnstile_failed" &&
      SAFE_TURNSTILE_DIAGNOSTIC_PATTERN.test(String(relayError.turnstileErrorCode || ""))
    ) {
      body.turnstileErrorCode = relayError.turnstileErrorCode;
    }
    const extraHeaders = {};
    if (origin && (relayError.code === "device_session_invalid" || clearDeviceCookieOnError)) {
      extraHeaders["Set-Cookie"] = buildDeviceSessionClearCookie();
    }
    return jsonResponse(body, relayError.status, origin, config, extraHeaders);
  }
}
