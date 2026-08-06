const DEFAULTS = Object.freeze({
  allowedOrigin: "https://afterglow21.github.io",
  cacheKey: "public:libre-2:v1",
  cacheTtlSeconds: 129_600,
  enabled: false,
  glurooHostSuffix: ".ns.gluroo.com",
  maxEntries: 1_000,
  maxFutureSkewMs: 300_000,
  maxUpstreamBytes: 1_048_576,
  publicCacheMaxAgeSeconds: 60,
  publicWindowHours: 24,
  staleAfterSeconds: 900,
  upstreamTimeoutMs: 15_000,
});

const HOUR_MS = 60 * 60 * 1000;
const MAX_SECRET_LENGTH = 4_096;
const MAX_SOURCE_URL_LENGTH = 2_048;
const SNAPSHOT_SCHEMA_VERSION = 1;
const SOURCE_ID = "libre-2";
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

export class DemoFeedError extends Error {
  constructor(code, status = 500) {
    super(code);
    this.name = "DemoFeedError";
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
  return Object.freeze({
    allowedOrigin: String(env.CORS_ALLOWED_ORIGIN || DEFAULTS.allowedOrigin),
    cacheKey: String(env.DEMO_FEED_CACHE_KEY || DEFAULTS.cacheKey),
    cacheTtlSeconds: parsePositiveInteger(env.CACHE_TTL_SECONDS, DEFAULTS.cacheTtlSeconds, {
      min: 60,
      max: 604_800,
    }),
    enabled: parseBoolean(env.DEMO_FEED_ENABLED, DEFAULTS.enabled),
    glurooHostSuffix: String(env.GLUROO_HOST_SUFFIX || DEFAULTS.glurooHostSuffix).toLowerCase(),
    maxEntries: parsePositiveInteger(env.MAX_ENTRIES, DEFAULTS.maxEntries, { max: 5_000 }),
    maxFutureSkewMs: parsePositiveInteger(env.MAX_FUTURE_SKEW_MS, DEFAULTS.maxFutureSkewMs, {
      max: 3_600_000,
    }),
    maxUpstreamBytes: parsePositiveInteger(env.MAX_UPSTREAM_BYTES, DEFAULTS.maxUpstreamBytes, {
      max: 6 * 1024 * 1024,
    }),
    publicCacheMaxAgeSeconds: parsePositiveInteger(
      env.PUBLIC_CACHE_MAX_AGE_SECONDS,
      DEFAULTS.publicCacheMaxAgeSeconds,
      { max: 600 },
    ),
    publicWindowHours: parsePositiveInteger(
      env.PUBLIC_WINDOW_HOURS,
      DEFAULTS.publicWindowHours,
      { max: 72 },
    ),
    staleAfterSeconds: parsePositiveInteger(env.STALE_AFTER_SECONDS, DEFAULTS.staleAfterSeconds, {
      max: 86_400,
    }),
    upstreamTimeoutMs: parsePositiveInteger(env.UPSTREAM_TIMEOUT_MS, DEFAULTS.upstreamTimeoutMs, {
      max: 60_000,
    }),
  });
}

function requireSecret(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_SECRET_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new DemoFeedError("demo_feed_not_configured", 503);
  }
  return value;
}

function requireCacheBinding(binding) {
  if (
    !binding ||
    typeof binding.get !== "function" ||
    typeof binding.put !== "function"
  ) {
    throw new DemoFeedError("demo_feed_not_configured", 503);
  }
  return binding;
}

export function validateSourceUrl(rawSourceUrl, hostSuffix = DEFAULTS.glurooHostSuffix) {
  if (
    typeof rawSourceUrl !== "string" ||
    rawSourceUrl.length < 1 ||
    rawSourceUrl.length > MAX_SOURCE_URL_LENGTH
  ) {
    throw new DemoFeedError("demo_feed_not_configured", 503);
  }

  let parsed;
  try {
    parsed = new URL(rawSourceUrl);
  } catch {
    throw new DemoFeedError("destination_not_allowed", 503);
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.hash
  ) {
    throw new DemoFeedError("destination_not_allowed", 503);
  }

  const hostname = parsed.hostname.toLowerCase();
  const normalizedSuffix = String(hostSuffix).toLowerCase();
  const suffixHost = normalizedSuffix.startsWith(".") ? normalizedSuffix.slice(1) : normalizedSuffix;
  if (!normalizedSuffix.startsWith(".") || hostname === suffixHost || !hostname.endsWith(normalizedSuffix)) {
    throw new DemoFeedError("destination_not_allowed", 503);
  }

  const instanceLabel = hostname.slice(0, -normalizedSuffix.length);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(instanceLabel)) {
    throw new DemoFeedError("destination_not_allowed", 503);
  }

  return `https://${hostname}`;
}

export function buildUpstreamUrl(env, config = readConfig(env), nowMs = Date.now()) {
  const sourceUrl = validateSourceUrl(
    requireSecret(env.GLUROO_DEMO_SOURCE_URL),
    config.glurooHostSuffix,
  );
  const credential = requireSecret(env.GLUROO_DEMO_API_SECRET);
  const fromMs = nowMs - config.publicWindowHours * HOUR_MS;
  const upstream = new URL("/api/v1/entries.json", `${sourceUrl}/`);
  upstream.searchParams.set("count", String(config.maxEntries));
  upstream.searchParams.set("find[dateString][$gte]", new Date(fromMs).toISOString());
  upstream.searchParams.set("find[dateString][$lte]", new Date(nowMs).toISOString());
  upstream.searchParams.set("token", credential);
  return upstream;
}

async function readLimitedStream(stream, maxBytes) {
  if (!stream) throw new DemoFeedError("upstream_invalid_response", 502);
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
        throw new DemoFeedError("upstream_response_too_large", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readResponseJson(response, maxBytes) {
  const contentLength = response.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > maxBytes) {
      throw new DemoFeedError("upstream_response_too_large", 502);
    }
  }
  const bytes = await readLimitedStream(response.body, maxBytes);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new DemoFeedError("upstream_invalid_response", 502);
  }
}

function normalizeTimestamp(entry) {
  let timestamp = Number(entry?.date ?? entry?.timestamp ?? entry?.time);
  if (Number.isFinite(timestamp) && timestamp > 0 && timestamp < 10_000_000_000) {
    timestamp *= 1000;
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    timestamp = Date.parse(entry?.dateString);
  }
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

export function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const sgv = Number(entry.sgv ?? entry.glucose ?? entry.value);
  const date = normalizeTimestamp(entry);
  if (!Number.isFinite(sgv) || sgv < 20 || sgv > 600 || !date) return null;
  const normalized = { sgv: Math.round(sgv), date: Math.round(date) };
  if (typeof entry.direction === "string" && ALLOWED_DIRECTIONS.has(entry.direction)) {
    normalized.direction = entry.direction;
  }
  return normalized;
}

export function normalizeEntries(rawEntries, config = readConfig(), nowMs = Date.now()) {
  if (!Array.isArray(rawEntries)) throw new DemoFeedError("upstream_invalid_response", 502);
  const earliestMs = nowMs - config.publicWindowHours * HOUR_MS;
  const latestMs = nowMs + config.maxFutureSkewMs;
  const unique = new Map();
  for (const rawEntry of rawEntries) {
    const entry = normalizeEntry(rawEntry);
    if (!entry || entry.date < earliestMs || entry.date > latestMs) continue;
    unique.set(entry.date, entry);
  }
  const entries = [...unique.values()]
    .sort((left, right) => left.date - right.date)
    .slice(-config.maxEntries);
  if (!entries.length) throw new DemoFeedError("upstream_no_glucose_data", 502);
  return entries;
}

export async function fetchGlurooEntries(
  env,
  config = readConfig(env),
  { nowMs = Date.now(), fetchImpl = fetch } = {},
) {
  const upstream = buildUpstreamUrl(env, config, nowMs);
  let response;
  try {
    response = await fetchImpl(upstream.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
  } catch {
    throw new DemoFeedError("upstream_unavailable", 502);
  }

  if (response.status >= 300 && response.status < 400) {
    throw new DemoFeedError("destination_not_allowed", 502);
  }
  if (response.status === 401 || response.status === 403) {
    throw new DemoFeedError("authentication_failed", 503);
  }
  if (!response.ok) throw new DemoFeedError("upstream_unavailable", 502);
  const rawEntries = await readResponseJson(response, config.maxUpstreamBytes);
  return normalizeEntries(rawEntries, config, nowMs);
}

export function validateSnapshot(snapshot, config = readConfig()) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new DemoFeedError("demo_feed_unavailable", 503);
  }
  if (
    snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION ||
    snapshot.sourceId !== SOURCE_ID ||
    !Number.isSafeInteger(snapshot.generatedAt) ||
    snapshot.generatedAt <= 0 ||
    !Array.isArray(snapshot.entries) ||
    snapshot.entries.length < 1 ||
    snapshot.entries.length > config.maxEntries
  ) {
    throw new DemoFeedError("demo_feed_unavailable", 503);
  }

  let previousDate = -Infinity;
  const entries = snapshot.entries.map((entry) => {
    const normalized = normalizeEntry(entry);
    if (!normalized || normalized.date <= previousDate) {
      throw new DemoFeedError("demo_feed_unavailable", 503);
    }
    const allowedKeys = new Set(["sgv", "date", "direction"]);
    if (Object.keys(entry).some((key) => !allowedKeys.has(key))) {
      throw new DemoFeedError("demo_feed_unavailable", 503);
    }
    previousDate = normalized.date;
    return normalized;
  });

  return Object.freeze({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sourceId: SOURCE_ID,
    generatedAt: snapshot.generatedAt,
    entries,
  });
}

export async function refreshDemoFeed(env, services = {}) {
  const config = readConfig(env);
  if (!config.enabled) return Object.freeze({ ok: false, skipped: "disabled" });
  const cache = requireCacheBinding(env.DEMO_FEED_CACHE);
  const nowMs = typeof services.now === "function" ? services.now() : Date.now();
  const entries = await fetchGlurooEntries(env, config, {
    nowMs,
    fetchImpl: services.fetchImpl || fetch,
  });
  const snapshot = validateSnapshot({
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    sourceId: SOURCE_ID,
    generatedAt: nowMs,
    entries,
  }, config);
  const serialized = JSON.stringify(snapshot);
  if (
    serialized.includes(String(env.GLUROO_DEMO_SOURCE_URL || "__missing_url__")) ||
    serialized.includes(String(env.GLUROO_DEMO_API_SECRET || "__missing_secret__"))
  ) {
    throw new DemoFeedError("demo_feed_unavailable", 503);
  }
  await cache.put(config.cacheKey, serialized, { expirationTtl: config.cacheTtlSeconds });
  return Object.freeze({ ok: true, entryCount: snapshot.entries.length, generatedAt: nowMs });
}

function buildHeaders(origin, config, { cacheable = false } = {}) {
  const headers = new Headers({
    "Cache-Control": cacheable
      ? `public, max-age=${config.publicCacheMaxAgeSeconds}`
      : "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  });
  if (origin === config.allowedOrigin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function jsonResponse(body, status, origin, config, options) {
  return new Response(JSON.stringify(body), {
    status,
    headers: buildHeaders(origin, config, options),
  });
}

function assertAllowedOrigin(request, config) {
  const origin = request.headers.get("origin");
  if (origin && origin !== config.allowedOrigin) {
    throw new DemoFeedError("request_not_allowed", 403);
  }
  return origin;
}

export async function handleDemoFeedRequest(request, env = {}, services = {}) {
  const config = readConfig(env);
  const nowMs = typeof services.now === "function" ? services.now() : Date.now();
  let origin = null;
  try {
    origin = assertAllowedOrigin(request, config);
    const url = new URL(request.url);
    if (url.pathname !== "/v1/libre") throw new DemoFeedError("not_found", 404);

    if (request.method === "OPTIONS") {
      if (!origin) throw new DemoFeedError("request_not_allowed", 403);
      const headers = buildHeaders(origin, config);
      headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
      headers.set("Access-Control-Max-Age", "600");
      headers.delete("Content-Type");
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "GET") throw new DemoFeedError("method_not_allowed", 405);
    if (!config.enabled) throw new DemoFeedError("demo_feed_paused", 503);
    const cache = requireCacheBinding(env.DEMO_FEED_CACHE);
    const stored = await cache.get(config.cacheKey, { type: "json", cacheTtl: 60 });
    const snapshot = validateSnapshot(stored, config);
    return jsonResponse({
      ok: true,
      sourceId: snapshot.sourceId,
      updatedAt: snapshot.generatedAt,
      stale: nowMs - snapshot.generatedAt > config.staleAfterSeconds * 1000,
      entries: snapshot.entries,
    }, 200, origin, config, { cacheable: true });
  } catch (error) {
    const feedError = error instanceof DemoFeedError
      ? error
      : new DemoFeedError("demo_feed_unavailable", 503);
    return jsonResponse({ ok: false, error: feedError.code }, feedError.status, origin, config);
  }
}
