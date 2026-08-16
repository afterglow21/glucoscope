import { UsageApiError } from "./usage-core.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function readPositiveInteger(value, fallback, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export async function verifyTurnstileToken({ token, env = {}, config }, fetchImpl = fetch) {
  const secret = String(env.TURNSTILE_SECRET_KEY || "");
  if (secret.length < 16) throw new UsageApiError("service_unavailable", 503);

  const siteverifyBody = new URLSearchParams({
    secret,
    response: token,
  });

  let response;
  try {
    response = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: siteverifyBody,
      signal: AbortSignal.timeout(readPositiveInteger(env.TURNSTILE_TIMEOUT_MS, 10_000, 30_000)),
    });
  } catch {
    throw new UsageApiError("turnstile_unavailable", 503);
  }

  if (!response.ok) throw new UsageApiError("turnstile_unavailable", 503);
  const result = await response.json().catch(() => null);
  if (
    !result?.success
    || String(result.hostname || "").toLowerCase()
      !== String(env.TURNSTILE_EXPECTED_HOSTNAME || "glucoscope.app").toLowerCase()
    || result.action !== String(env.TURNSTILE_EXPECTED_ACTION || "glucoscope-usage-profile")
  ) {
    throw new UsageApiError("turnstile_failed", 403);
  }

  return Object.freeze({ ok: true, config });
}
