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
});

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CREDENTIAL_LENGTH = 4_096;
const MAX_SOURCE_URL_LENGTH = 2_048;
const ALLOWED_KEYS = new Set(["sourceUrl", "credential", "from", "to", "limit"]);
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
  });
}

export function validateSourceUrl(rawSourceUrl, hostSuffix = DEFAULTS.glurooHostSuffix) {
  if (typeof rawSourceUrl !== "string" || rawSourceUrl.length < 1 || rawSourceUrl.length > MAX_SOURCE_URL_LENGTH) {
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
    if (!ALLOWED_KEYS.has(key)) throw new RelayError("invalid_request");
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

export async function handleRelayRequest(request, env = {}, fetchImpl = fetch) {
  const config = readConfig(env);
  let origin = null;

  try {
    origin = assertAllowedOrigin(request, config);

    const url = new URL(request.url);
    if (url.pathname !== "/v1/entries") throw new RelayError("invalid_request", 404);

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
    const entries = await fetchGlurooEntries(payload, config, fetchImpl);
    return jsonResponse({ ok: true, entries }, 200, origin, config);
  } catch (error) {
    const relayError = error instanceof RelayError ? error : new RelayError("upstream_unavailable", 502);
    return jsonResponse({ ok: false, error: relayError.code }, relayError.status, origin, config);
  }
}
