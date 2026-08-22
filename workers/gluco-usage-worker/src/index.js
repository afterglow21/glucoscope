import { WorkerEntrypoint } from "cloudflare:workers";

import {
  completeAiGeneration,
  getAggregateAiUsage,
  releaseAiGeneration,
  reserveAiGeneration,
  runAiQuotaCleanup,
} from "./ai-quota-core.js";
import { createD1AiQuotaStore } from "./ai-quota-store.js";
import { createProfileCredentials, hashBearerToken } from "./credentials.js";
import { createD1UsageStore } from "./d1-store.js";
import { readPublicUsageAggregate } from "./public-aggregate.js";
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

async function resolveAccountEntitlement(env, { token, shareTrialRequestId = "" }) {
  const service = env.PLUS_ENTITLEMENT;
  if (!service || typeof service.resolveAiSubject !== "function") {
    return { status: "unavailable" };
  }

  try {
    return await service.resolveAiSubject(token, shareTrialRequestId);
  } catch {
    return { status: "unavailable" };
  }
}

function createAiQuotaServices(env) {
  return Object.freeze({
    store: createD1AiQuotaStore(env.USAGE_DB),
    hashBearerToken,
    createReservationId: () => crypto.randomUUID(),
    resolveAccountEntitlement: (input) => resolveAccountEntitlement(env, input),
  });
}

async function internalRpc(operation) {
  try {
    return await operation();
  } catch {
    return {
      ok: false,
      status: "error",
      error: "service_unavailable",
      retryable: true,
    };
  }
}

export class AiQuotaService extends WorkerEntrypoint {
  async reserveAiGeneration(input) {
    return internalRpc(() => reserveAiGeneration(input, this.env, createAiQuotaServices(this.env)));
  }

  async completeAiGeneration(input) {
    return internalRpc(() => completeAiGeneration(input, this.env, createAiQuotaServices(this.env)));
  }

  async releaseAiGeneration(input) {
    return internalRpc(() => releaseAiGeneration(input, this.env, createAiQuotaServices(this.env)));
  }

  async getAggregateAiUsage() {
    return internalRpc(() => getAggregateAiUsage(this.env, createAiQuotaServices(this.env)));
  }
}

export class PublicUsageAggregateEntrypoint extends WorkerEntrypoint {
  async getPublicUsageAggregate() {
    return readPublicUsageAggregate(this.env.USAGE_DB);
  }
}

export default {
  async fetch(request, env) {
    return handleUsageRequest(request, env, createServices(env));
  },

  async scheduled(_controller, env) {
    await Promise.all([
      runUsageCleanup(createD1UsageStore(env.USAGE_DB), env),
      runAiQuotaCleanup(createD1AiQuotaStore(env.USAGE_DB), env),
    ]);
  },
};
