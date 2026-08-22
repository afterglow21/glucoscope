export const PUBLIC_DEMO_PAGE_MODE = "kazuma-public-demo";
export const USER_DATA_PAGE_MODE = "glucoscope-user-foundation";
export const DEFAULT_TURNSTILE_EXPECTED_HOSTNAME = "glucoscope.app";
export const DEFAULT_TURNSTILE_EXPECTED_ACTION = "glucoscope-ai-letter";
export const SHARED_AI_CACHE_ENABLED = false;

export function shouldUseSharedCacheForSummary(summary = {}) {
  // A browser-provided page mode cannot prove that a summary belongs to the
  // public demo. Keep every letter browser-local while personal-user AI is in
  // early access, so a forged page mode can never publish private data to KV.
  void summary;
  return SHARED_AI_CACHE_ENABLED;
}

export function isAiGenerationRequest(request) {
  if (request?.method !== "POST") return false;

  try {
    return new URL(request.url).pathname === "/api/gluco-letter";
  } catch (error) {
    return false;
  }
}

export function getExpectedTurnstileIdentity(env = {}) {
  return {
    hostname: String(
      env.TURNSTILE_EXPECTED_HOSTNAME || DEFAULT_TURNSTILE_EXPECTED_HOSTNAME
    ).trim().toLowerCase(),
    action: String(
      env.TURNSTILE_EXPECTED_ACTION || DEFAULT_TURNSTILE_EXPECTED_ACTION
    ).trim()
  };
}

export function isExpectedTurnstileResult(result = {}, env = {}, expectedOverride = null) {
  const expected = expectedOverride && typeof expectedOverride === "object"
    ? {
        hostname: String(expectedOverride.hostname || "").trim().toLowerCase(),
        action: String(expectedOverride.action || "").trim()
      }
    : getExpectedTurnstileIdentity(env);
  const hostname = String(result?.hostname || "").trim().toLowerCase();
  const action = String(result?.action || "").trim();

  return result?.success === true
    && Boolean(expected.hostname)
    && Boolean(expected.action)
    && hostname === expected.hostname
    && action === expected.action;
}
