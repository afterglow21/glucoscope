const ADMIN_BRIDGE_VERSION = "v1";
const ADMIN_BRIDGE_HEADER_PREFIX = "X-Gluco-Admin-Bridge";
const ADMIN_BRIDGE_MAX_BODY_BYTES = 64_000;
const ADMIN_BRIDGE_DEFAULT_MAX_AGE_SECONDS = 90;
const ADMIN_BRIDGE_DEFAULT_DAILY_LIMIT = 5;
const ADMIN_BRIDGE_MAX_DAILY_LIMIT = 30;
const ADMIN_BRIDGE_COUNTER_NAME = "glucoscope-admin-share-studio";
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const HEX_SHA256_PATTERN = /^[0-9a-f]{64}$/iu;

export const ADMIN_SHARE_STUDIO_PAGE_MODE = "kazuma-share-studio-daily-reflection-no-realtime";
export const DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN = "https://glucoscope-share-studio.pages.dev";
export const DEFAULT_ADMIN_SHARE_STUDIO_TURNSTILE_HOSTNAME = "glucoscope-share-studio.pages.dev";
export const DEFAULT_ADMIN_SHARE_STUDIO_TURNSTILE_ACTION = "glucoscope-ai-letter";

function readBoolean(value, fallback = false) {
  if (value === true || String(value).toLowerCase() === "true") return true;
  if (value === false || String(value).toLowerCase() === "false") return false;
  return fallback;
}

function readBoundedInteger(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeExactHttpsOrigin(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return text === url.origin ? url.origin : null;
  } catch {
    return null;
  }
}

function textBytes(value) {
  return new TextEncoder().encode(String(value || ""));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value) {
  if (!HEX_SHA256_PATTERN.test(String(value || ""))) return null;
  const normalized = String(value).toLowerCase();
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }
  return bytes;
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));
  return bytesToHex(new Uint8Array(digest));
}

function buildSigningMessage({ timestamp, requestId, method, path, origin, bodySha256 }) {
  return [
    ADMIN_BRIDGE_VERSION,
    String(timestamp),
    String(requestId),
    String(method).toUpperCase(),
    String(path),
    String(origin),
    String(bodySha256).toLowerCase(),
  ].join("\n");
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    textBytes(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signHex(secret, message) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textBytes(message));
  return bytesToHex(new Uint8Array(signature));
}

async function verifyHex(secret, message, signatureHex) {
  const signature = hexToBytes(signatureHex);
  if (!signature) return false;
  const key = await importHmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signature, textBytes(message));
}

async function readTextWithLimit(request, limit = ADMIN_BRIDGE_MAX_BODY_BYTES) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    return { ok: false, error: "body_too_large" };
  }
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("body_too_large");
        return { ok: false, error: "body_too_large" };
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
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ok: false, error: "invalid_utf8" };
  }
}

export function readAdminShareStudioBridgeConfig(env = {}) {
  const origin = normalizeExactHttpsOrigin(
    env.ADMIN_SHARE_STUDIO_ORIGIN || DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN
  );
  const secret = String(env.ADMIN_SHARE_STUDIO_BRIDGE_SECRET || "");
  return Object.freeze({
    enabled: readBoolean(env.ADMIN_SHARE_STUDIO_BRIDGE_ENABLED, false),
    origin,
    secret,
    secretReady: textBytes(secret).byteLength >= 32,
    maxAgeSeconds: readBoundedInteger(
      env.ADMIN_SHARE_STUDIO_BRIDGE_MAX_AGE_SECONDS,
      ADMIN_BRIDGE_DEFAULT_MAX_AGE_SECONDS,
      30,
      300
    ),
    dailyLimit: readBoundedInteger(
      env.ADMIN_SHARE_STUDIO_DAILY_LIMIT,
      ADMIN_BRIDGE_DEFAULT_DAILY_LIMIT,
      1,
      ADMIN_BRIDGE_MAX_DAILY_LIMIT
    ),
    turnstileIdentity: Object.freeze({
      hostname: String(
        env.ADMIN_SHARE_STUDIO_TURNSTILE_HOSTNAME
        || DEFAULT_ADMIN_SHARE_STUDIO_TURNSTILE_HOSTNAME
      ).trim().toLowerCase(),
      action: String(
        env.ADMIN_SHARE_STUDIO_TURNSTILE_ACTION
        || DEFAULT_ADMIN_SHARE_STUDIO_TURNSTILE_ACTION
      ).trim(),
    }),
  });
}

function hasAdminBridgeHeaders(request) {
  return [
    `${ADMIN_BRIDGE_HEADER_PREFIX}-Version`,
    `${ADMIN_BRIDGE_HEADER_PREFIX}-Timestamp`,
    `${ADMIN_BRIDGE_HEADER_PREFIX}-Request-Id`,
    `${ADMIN_BRIDGE_HEADER_PREFIX}-Signature`,
  ].some((name) => request.headers.has(name));
}

function bridgeFailure(error, status = 403, attempted = true) {
  return Object.freeze({ ok: false, attempted, error, status });
}

export async function verifyAdminShareStudioBridgeRequest(request, env = {}, now = Date.now()) {
  if (!hasAdminBridgeHeaders(request)) {
    return bridgeFailure("not_attempted", 0, false);
  }

  const config = readAdminShareStudioBridgeConfig(env);
  if (!config.enabled) return bridgeFailure("bridge_disabled", 503);
  if (!config.origin || !config.secretReady) return bridgeFailure("bridge_not_configured", 503);
  if (request.method !== "POST") return bridgeFailure("invalid_method", 405);

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return bridgeFailure("invalid_url", 400);
  }
  if (url.pathname !== "/api/gluco-letter") return bridgeFailure("invalid_path", 404);

  const origin = request.headers.get("Origin");
  if (origin !== config.origin) return bridgeFailure("invalid_origin", 403);

  const version = request.headers.get(`${ADMIN_BRIDGE_HEADER_PREFIX}-Version`) || "";
  const timestampText = request.headers.get(`${ADMIN_BRIDGE_HEADER_PREFIX}-Timestamp`) || "";
  const requestId = request.headers.get(`${ADMIN_BRIDGE_HEADER_PREFIX}-Request-Id`) || "";
  const signature = request.headers.get(`${ADMIN_BRIDGE_HEADER_PREFIX}-Signature`) || "";
  if (version !== ADMIN_BRIDGE_VERSION) return bridgeFailure("invalid_version", 403);
  if (!/^\d{10}$/u.test(timestampText)) return bridgeFailure("invalid_timestamp", 403);
  if (!UUID_V4_PATTERN.test(requestId)) return bridgeFailure("invalid_request_id", 403);

  const timestampMs = Number(timestampText) * 1000;
  const ageMs = now - timestampMs;
  if (ageMs < -15_000 || ageMs > config.maxAgeSeconds * 1000) {
    return bridgeFailure("signature_expired", 403);
  }

  const bodyRead = await readTextWithLimit(request.clone());
  if (!bodyRead.ok) return bridgeFailure(bodyRead.error, 413);
  let payload;
  try {
    payload = JSON.parse(bodyRead.text);
  } catch {
    return bridgeFailure("invalid_json", 400);
  }
  if (
    payload?.requestId !== requestId
    || payload?.summary?.pageMode !== ADMIN_SHARE_STUDIO_PAGE_MODE
    || payload?.analysisMode !== "letter"
    || payload?.client?.mode !== "share-studio-admin-v2.2"
  ) {
    return bridgeFailure("invalid_payload_identity", 403);
  }

  const bodySha256 = await sha256Hex(bodyRead.text);
  const message = buildSigningMessage({
    timestamp: timestampText,
    requestId,
    method: request.method,
    path: url.pathname,
    origin,
    bodySha256,
  });
  if (!(await verifyHex(config.secret, message, signature))) {
    return bridgeFailure("invalid_signature", 403);
  }

  return Object.freeze({
    ok: true,
    attempted: true,
    verified: true,
    status: 200,
    origin,
    requestId: requestId.toLowerCase(),
    dailyLimit: config.dailyLimit,
    counterName: ADMIN_BRIDGE_COUNTER_NAME,
    turnstileIdentity: config.turnstileIdentity,
  });
}

export function buildAdminShareStudioCounterConfig(baseConfig = {}, dailyLimit = ADMIN_BRIDGE_DEFAULT_DAILY_LIMIT) {
  const limit = readBoundedInteger(dailyLimit, ADMIN_BRIDGE_DEFAULT_DAILY_LIMIT, 1, ADMIN_BRIDGE_MAX_DAILY_LIMIT);
  return Object.freeze({
    ...baseConfig,
    aiEnabled: true,
    sharedCountLimitsEnabled: true,
    dailyGenerationLimit: limit,
    slotGenerationLimit: limit,
    stopBudgetJpy: Number.MAX_SAFE_INTEGER,
  });
}

export function isAdminShareStudioTurnstileReady(env = {}, baseConfig = {}) {
  const config = readAdminShareStudioBridgeConfig(env);
  return baseConfig.turnstileRequired === true
    && Boolean(String(env.TURNSTILE_SECRET_KEY || "").trim())
    && Boolean(config.turnstileIdentity.hostname)
    && Boolean(config.turnstileIdentity.action);
}

export const adminShareStudioBridgeTesting = Object.freeze({
  ADMIN_BRIDGE_VERSION,
  ADMIN_BRIDGE_HEADER_PREFIX,
  ADMIN_BRIDGE_COUNTER_NAME,
  ADMIN_BRIDGE_MAX_BODY_BYTES,
  UUID_V4_PATTERN,
  buildSigningMessage,
  normalizeExactHttpsOrigin,
  readTextWithLimit,
  sha256Hex,
  signHex,
});
