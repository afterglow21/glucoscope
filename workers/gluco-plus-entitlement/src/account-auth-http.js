import {
  AccountAuthError,
  createAccountAuthService,
  readAccountAuthConfig,
} from "./account-auth-core.js";
import { createPublicUnavailableResponse } from "./entitlement-core.js";
import { verifyAccountTurnstile } from "./account-auth-turnstile.js";

const ROUTES = Object.freeze({
  requestCode: "/v1/auth/request-code",
  verify: "/v1/auth/verify",
  session: "/v1/session",
  logout: "/v1/auth/logout",
  deleteAccount: "/v1/account/delete",
});
const JSON_CONTENT_TYPE = /^application\/json(?:\s*;|$)/iu;
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/u;

function isExactHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.origin === value
      && parsed.pathname === "/"
      && !parsed.username
      && !parsed.password;
  } catch {
    return false;
  }
}

function baseHeaders(origin = null) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function jsonResponse(body, status, origin, extraHeaders = {}) {
  const headers = baseHeaders(origin);
  for (const [name, value] of Object.entries(extraHeaders)) {
    headers.set(name, String(value));
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(error, origin) {
  const safe = error instanceof AccountAuthError
    ? error
    : new AccountAuthError("service_unavailable", 503);
  const body = { ok: false, error: safe.code };
  const headers = safe.retryAfterSeconds
    ? { "Retry-After": safe.retryAfterSeconds }
    : {};
  return jsonResponse(body, safe.status, origin, headers);
}

async function readJsonBody(request, maximumBytes) {
  if (!JSON_CONTENT_TYPE.test(String(request.headers.get("Content-Type") || ""))) {
    throw new AccountAuthError("invalid_request", 400);
  }
  const contentLength = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    throw new AccountAuthError("request_too_large", 413);
  }
  if (!request.body) throw new AccountAuthError("invalid_request", 400);

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size failure remains authoritative if stream cancellation fails.
        }
        throw new AccountAuthError("request_too_large", 413);
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
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new AccountAuthError("invalid_request", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccountAuthError("invalid_request", 400);
  }
  return value;
}

function requireAllowedKeys(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new AccountAuthError("invalid_request", 400);
  }
  return value;
}

function readBearerToken(request) {
  const match = BEARER_PATTERN.exec(String(request.headers.get("Authorization") || ""));
  return match?.[1] || null;
}

function preflightResponse(origin) {
  const headers = baseHeaders(origin);
  headers.delete("Content-Type");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  return new Response(null, { status: 204, headers });
}

export async function handleAccountAuthRequest(request, env = {}, dependencies = {}) {
  const config = readAccountAuthConfig(env);
  if (!config.httpEnabled) return createPublicUnavailableResponse();
  if (!isExactHttpsOrigin(config.allowedOrigin)) {
    return createPublicUnavailableResponse();
  }
  const origin = String(request.headers.get("Origin") || "");
  if (origin !== config.allowedOrigin) {
    return jsonResponse({ ok: false, error: "origin_not_allowed" }, 403, null);
  }
  const url = new URL(request.url);
  if (url.search) {
    return jsonResponse({ ok: false, error: "invalid_request" }, 400, origin);
  }
  const knownPath = Object.values(ROUTES).includes(url.pathname);
  if (request.method === "OPTIONS") {
    return knownPath
      ? preflightResponse(origin)
      : jsonResponse({ ok: false, error: "not_found" }, 404, origin);
  }

  const service = dependencies.service
    || createAccountAuthService(env, dependencies.serviceDependencies);
  const turnstileVerifier = dependencies.verifyTurnstile || verifyAccountTurnstile;
  try {
    if (url.pathname === ROUTES.requestCode) {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin, {
          Allow: "POST, OPTIONS",
        });
      }
      const payload = requireAllowedKeys(
        await readJsonBody(request, config.bodyLimitBytes),
        new Set([
          "email",
          "turnstileToken",
          "contactRole",
          "adultConfirmed",
          "guardianConfirmed",
        ]),
      );
      await turnstileVerifier({
        token: payload.turnstileToken,
        expectedAction: config.requestCodeAction,
        expectedHostname: config.expectedHostname,
        remoteIp: request.headers.get("CF-Connecting-IP"),
        env,
      });
      const result = await service.requestCode(payload, { turnstileVerified: true });
      return jsonResponse(result, 200, origin);
    }

    if (url.pathname === ROUTES.verify) {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin, {
          Allow: "POST, OPTIONS",
        });
      }
      const payload = requireAllowedKeys(
        await readJsonBody(request, config.bodyLimitBytes),
        new Set(["email", "code", "verificationGrant"]),
      );
      const result = await service.verifyCode(payload);
      return jsonResponse(result, 200, origin);
    }

    if (url.pathname === ROUTES.session) {
      if (request.method !== "GET") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin, {
          Allow: "GET, OPTIONS",
        });
      }
      const status = await service.getSessionStatus(readBearerToken(request));
      if (!status) {
        return jsonResponse({ ok: false, status: "signed_out" }, 401, origin);
      }
      return jsonResponse(status, 200, origin);
    }

    if (url.pathname === ROUTES.logout) {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin, {
          Allow: "POST, OPTIONS",
        });
      }
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (contentLength > 0) {
        const payload = requireAllowedKeys(
          await readJsonBody(request, config.bodyLimitBytes),
          new Set(),
        );
        void payload;
      }
      const result = await service.logout(readBearerToken(request));
      return jsonResponse(result, 200, origin);
    }

    if (url.pathname === ROUTES.deleteAccount) {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, origin, {
          Allow: "POST, OPTIONS",
        });
      }
      const payload = requireAllowedKeys(
        await readJsonBody(request, config.bodyLimitBytes),
        new Set(["turnstileToken", "confirmDelete"]),
      );
      await turnstileVerifier({
        token: payload.turnstileToken,
        expectedAction: config.deleteAction,
        expectedHostname: config.expectedHostname,
        remoteIp: request.headers.get("CF-Connecting-IP"),
        env,
      });
      const result = await service.deleteAccount(
        readBearerToken(request),
        payload,
        { turnstileVerified: true },
      );
      return jsonResponse(result, 200, origin);
    }

    return jsonResponse({ ok: false, error: "not_found" }, 404, origin);
  } catch (error) {
    return errorResponse(error, origin);
  }
}
