import { WorkerEntrypoint } from "cloudflare:workers";

import {
  createPlusEntitlementService,
} from "./entitlement-core.js";
import { handleAccountAuthRequest } from "./account-auth-http.js";
import { createCloudflareEmailAdapter } from "./cloudflare-email-adapter.js";
import { handleStripeHttpRequest } from "./stripe-http.js";

const ACCOUNT_AUTH_PATHS = new Set([
  "/v1/auth/request-code",
  "/v1/auth/verify",
  "/v1/session",
  "/v1/auth/logout",
  "/v1/account/delete",
]);

export class AdminPlusAggregateEntrypoint extends WorkerEntrypoint {
  async getActivePlusSummary() {
    return createPlusEntitlementService(this.env).getAdminActivePlusSummary();
  }
}

export class PlusEntitlementRpc extends WorkerEntrypoint {
  #service() {
    return createPlusEntitlementService(this.env);
  }

  async resolveAiSubject(sessionToken) {
    return this.#service().resolveAiSubject(sessionToken);
  }

  async resolveCheckoutBuyer(sessionToken, confirmationVersion) {
    return this.#service().resolveCheckoutBuyer(sessionToken, confirmationVersion);
  }

  async getActivePlusSummary(sessionToken) {
    return this.#service().getActivePlusSummary(sessionToken);
  }

  async reserveShareTrial(sessionToken, requestId) {
    return this.#service().reserveShareTrial(sessionToken, requestId);
  }

  async completeShareTrial(sessionToken, requestId) {
    return this.#service().completeShareTrial(sessionToken, requestId);
  }

  async releaseShareTrial(sessionToken, requestId) {
    return this.#service().releaseShareTrial(sessionToken, requestId);
  }
}

export default class extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    if (ACCOUNT_AUTH_PATHS.has(url.pathname)) {
      return handleAccountAuthRequest(request, this.env, {
        serviceDependencies: {
          emailAdapter: createCloudflareEmailAdapter({
            binding: this.env.ACCOUNT_CODE_EMAIL,
            fromAddress: this.env.ACCOUNT_EMAIL_FROM_ADDRESS,
          }),
        },
      });
    }
    return handleStripeHttpRequest(request, this.env);
  }
}
