const DEFAULTS = Object.freeze({
  allowedOrigins: ["https://afterglow21.github.io"],
  allowRequestsWithoutOrigin: false,
  enabled: false,
  glurooHostSuffix: ".ns.gluroo.com",
  maxEntries: 12_000,
  maxRangeDays: 31,
  maxRequestBytes: 8_192,
  maxUpstreamBytes: 6 * 1024 * 1024,
  upstreamTimeoutMs: 15_000,
  turnstileExpectedHostname: "afterglow21.github.io",
  turnstileExpectedAction: "glucoscope-data-relay",
  turnstileTimeoutMs: 5_000,
  ticketTtlSeconds: 3_600,
  sessionDailyLimit: 250,
  globalWarningDaily: 20_000,
  globalHardDaily: 50_000,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_SOURCE_URL_LENGTH = 2_048;
const MAX_TICKET_LENGTH = 2_048;
const MAX_TURNSTILE_TOKEN_LENGTH = 2_048;
const TICKET_CLOCK_SKEW_SECONDS = 30;
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const ENTRY_KEYS = new Set(["sourceUrl", "credential", "from", "to", "limit", "relayTicket"]);
const SESSION_KEYS = new Set(["turnstileToken"]);
const TICKET_KEYS = new Set(["v", "sid", "iat", "exp", "scope", "origin"]);
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
  constructor(code, status = 400) {
    super(code);
    this.name = "RelayError";
    this.code = code;
    this.status = status;
  }
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
    ticketTtlSeconds: parsePositiveInteger(
      env.RELAY_TICKET_TTL_SECONDS,
      DEFAULTS.ticketTtlSeconds,
      { min: 300, max: 7_200 },
    ),
    sessionDailyLimit: parsePositiveInteger(
      env.SESSION_DAILY_LIMIT,
      DEFAULTS.sessionDailyLimit,
      { max: 10_000 },
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

function validateTicketString(value) {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > MAX_TICKET_LENGTH ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw new RelayError("relay_ticket_invalid", 403);
  }
  return value;
}

export function validateRelayPayload(payload, config = readConfig(), { requireTicket = false } = {}) {
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

  let relayTicket;
  if (payload.relayTicket !== undefined) relayTicket = validateTicketString(payload.relayTicket);
  if (requireTicket && !relayTicket) throw new RelayError("relay_ticket_invalid", 403);

  return Object.freeze({
    sourceUrl,
    credential: payload.credential,
    limit,
    from,
    to,
    relayTicket,
  });
}

export function validateSessionPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RelayError("invalid_request");
  }
  for (const key of Object.keys(payload)) {
    if (!SESSION_KEYS.has(key)) throw new RelayError("invalid_request");
  }
  if (
    typeof payload.turnstileToken !== "string" ||
    payload.turnstileToken.length < 1 ||
    payload.turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(payload.turnstileToken)
  ) {
    throw new RelayError("turnstile_failed", 403);
  }
  return Object.freeze({ turnstileToken: payload.turnstileToken });
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

function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new RelayError("relay_ticket_invalid", 403);
  }
  const padded = value.replace(/-/gu, "+").replace(/_/gu, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new RelayError("relay_ticket_invalid", 403);
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

export async function issueRelayTicket({
  origin,
  secret,
  config = readConfig(),
  nowMs = Date.now(),
  randomUUID = () => crypto.randomUUID(),
}) {
  const signingSecret = requireSecret(secret, 32);
  if (!config.allowedOrigins.includes(origin)) throw new RelayError("invalid_request", 403);

  const issuedAt = Math.floor(nowMs / 1000);
  const payload = Object.freeze({
    v: 1,
    sid: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + config.ticketTtlSeconds,
    scope: "entries",
    origin,
  });
  const encodedPayload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await importHmacKey(signingSecret, ["sign"]);
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encodedPayload)),
  );

  return Object.freeze({
    ticket: `${encodedPayload}.${bytesToBase64Url(signature)}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    expiresInSeconds: config.ticketTtlSeconds,
  });
}

export async function verifyRelayTicket({
  ticket,
  origin,
  secret,
  config = readConfig(),
  nowMs = Date.now(),
}) {
  const signingSecret = requireSecret(secret, 32);
  validateTicketString(ticket);
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new RelayError("relay_ticket_invalid", 403);
  }

  const payloadBytes = base64UrlToBytes(parts[0]);
  const signatureBytes = base64UrlToBytes(parts[1]);
  let payload;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
  } catch {
    throw new RelayError("relay_ticket_invalid", 403);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new RelayError("relay_ticket_invalid", 403);
  }
  if (Object.keys(payload).length !== TICKET_KEYS.size) {
    throw new RelayError("relay_ticket_invalid", 403);
  }
  for (const key of Object.keys(payload)) {
    if (!TICKET_KEYS.has(key)) throw new RelayError("relay_ticket_invalid", 403);
  }

  const key = await importHmacKey(signingSecret, ["verify"]);
  const validSignature = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    new TextEncoder().encode(parts[0]),
  );
  if (!validSignature) throw new RelayError("relay_ticket_invalid", 403);

  const nowSeconds = Math.floor(nowMs / 1000);
  if (
    payload.v !== 1 ||
    payload.scope !== "entries" ||
    payload.origin !== origin ||
    !config.allowedOrigins.includes(payload.origin) ||
    typeof payload.sid !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(payload.sid) ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > nowSeconds + TICKET_CLOCK_SKEW_SECONDS ||
    payload.exp <= nowSeconds ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > config.ticketTtlSeconds
  ) {
    throw new RelayError("relay_ticket_invalid", 403);
  }

  return Object.freeze(payload);
}

export async function verifyTurnstileToken(
  turnstileToken,
  env,
  config = readConfig(env),
  fetchImpl = fetch,
) {
  const validated = validateSessionPayload({ turnstileToken });
  const secret = requireSecret(env.TURNSTILE_SECRET_KEY, 16);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.turnstileTimeoutMs);

  let response;
  try {
    response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret, response: validated.turnstileToken }),
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new RelayError("turnstile_failed", 503);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new RelayError("turnstile_failed", 503);

  let result;
  try {
    result = await response.json();
  } catch {
    throw new RelayError("turnstile_failed", 503);
  }

  if (
    result?.success !== true ||
    String(result.hostname || "").toLowerCase() !== config.turnstileExpectedHostname ||
    result.action !== config.turnstileExpectedAction
  ) {
    throw new RelayError("turnstile_failed", 403);
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

export async function consumeRelayLimits(env, claims, config = readConfig(env), nowMs = Date.now()) {
  const bucket = new Date(nowMs).toISOString().slice(0, 10);
  const globalResult = await consumeCounter(
    env.RELAY_USAGE_COUNTER,
    "global",
    bucket,
    config.globalHardDaily,
  );
  if (!globalResult.allowed) throw new RelayError("relay_temporarily_paused", 503);

  const sessionResult = await consumeCounter(
    env.RELAY_USAGE_COUNTER,
    `session:${claims.sid}`,
    bucket,
    config.sessionDailyLimit,
  );
  if (!sessionResult.allowed) throw new RelayError("rate_limited", 429);

  return Object.freeze({
    globalCount: globalResult.count,
    sessionCount: sessionResult.count,
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
  }
  return headers;
}

function jsonResponse(body, status, origin, config) {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildCorsHeaders(origin, config),
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
  const issueTicket = services.issueTicket || issueRelayTicket;
  const verifyTicket = services.verifyTicket || verifyRelayTicket;
  const consumeLimits = services.consumeLimits || consumeRelayLimits;
  const randomUUID = services.randomUUID || (() => crypto.randomUUID());
  let origin = null;

  try {
    origin = assertAllowedOrigin(request, config);

    const url = new URL(request.url);
    if (url.pathname !== "/v1/session" && url.pathname !== "/v1/entries") {
      throw new RelayError("invalid_request", 404);
    }

    if (request.method === "OPTIONS") {
      const headers = buildCorsHeaders(origin, config);
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Content-Type");
      headers.set("Access-Control-Max-Age", "600");
      headers.delete("Content-Type");
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") throw new RelayError("invalid_request", 405);
    if (!config.enabled) throw new RelayError("relay_temporarily_paused", 503);

    const payload = await parseJsonRequest(request, config);

    if (url.pathname === "/v1/session") {
      const session = validateSessionPayload(payload);
      await verifyTurnstile(session.turnstileToken, env, config, turnstileFetch);
      const issued = await issueTicket({
        origin,
        secret: env.RELAY_TICKET_SECRET,
        config,
        nowMs,
        randomUUID,
      });
      return jsonResponse(
        {
          ok: true,
          relayTicket: issued.ticket,
          expiresAt: issued.expiresAt,
          expiresInSeconds: issued.expiresInSeconds,
        },
        200,
        origin,
        config,
      );
    }

    const validated = validateRelayPayload(payload, config, { requireTicket: true });
    const claims = await verifyTicket({
      ticket: validated.relayTicket,
      origin,
      secret: env.RELAY_TICKET_SECRET,
      config,
      nowMs,
    });
    await consumeLimits(env, claims, config, nowMs);
    const entries = await fetchGlurooEntries(validated, config, upstreamFetch);
    return jsonResponse({ ok: true, entries }, 200, origin, config);
  } catch (error) {
    const relayError = error instanceof RelayError ? error : new RelayError("upstream_unavailable", 502);
    return jsonResponse({ ok: false, error: relayError.code }, relayError.status, origin, config);
  }
}
