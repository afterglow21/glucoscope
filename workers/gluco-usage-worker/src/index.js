import { createProfileCredentials, hashBearerToken } from "./credentials.js";
import { createD1UsageStore } from "./d1-store.js";
import { handleUsageRequest, runUsageCleanup } from "./usage-core.js";
import { verifyTurnstileToken } from "./turnstile.js";

function createServices(env) {
  return Object.freeze({
    store: createD1UsageStore(env.USAGE_DB),
    verifyTurnstile: verifyTurnstileToken,
    createCredentials: createProfileCredentials,
    hashBearerToken,
  });
}

export default {
  async fetch(request, env) {
    return handleUsageRequest(request, env, createServices(env));
  },

  async scheduled(_controller, env) {
    await runUsageCleanup(createD1UsageStore(env.USAGE_DB), env);
  },
};
