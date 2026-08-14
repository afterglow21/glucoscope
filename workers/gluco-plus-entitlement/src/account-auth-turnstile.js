import { AccountAuthError } from "./account-auth-core.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function readTimeout(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1000) return 10_000;
  return Math.min(parsed, 30_000);
}

export async function verifyAccountTurnstile({
  token,
  expectedAction,
  expectedHostname,
  remoteIp,
  env = {},
}, fetchImpl = fetch) {
  const secret = String(env.TURNSTILE_SECRET_KEY || "");
  const responseToken = String(token || "");
  if (
    secret.length < 16
    || !expectedAction
    || !expectedHostname
  ) {
    throw new AccountAuthError("service_unavailable", 503);
  }
  if (!responseToken || responseToken.length > 4096) {
    throw new AccountAuthError("turnstile_failed", 403);
  }
  const body = new URLSearchParams({ secret, response: responseToken });
  if (remoteIp) body.set("remoteip", String(remoteIp));

  let response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(readTimeout(env.TURNSTILE_TIMEOUT_MS)),
    });
  } catch {
    throw new AccountAuthError("turnstile_unavailable", 503);
  }
  if (!response.ok) {
    throw new AccountAuthError("turnstile_unavailable", 503);
  }
  const result = await response.json().catch(() => null);
  if (
    result?.success !== true
    || String(result.hostname || "").toLowerCase() !== expectedHostname
    || String(result.action || "") !== expectedAction
  ) {
    throw new AccountAuthError("turnstile_failed", 403);
  }
  return Object.freeze({ verified: true });
}
