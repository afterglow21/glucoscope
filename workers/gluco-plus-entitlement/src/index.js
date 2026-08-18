import { WorkerEntrypoint } from "cloudflare:workers";

import {
  createPlusEntitlementService,
} from "./entitlement-core.js";
import { runAccountAuthCleanup } from "./account-auth-cleanup.js";
import { handleAccountAuthRequest } from "./account-auth-http.js";
import { createResendEmailAdapter } from "./resend-email-adapter.js";
import { handleStripeHttpRequest } from "./stripe-http.js";

const ACCOUNT_AUTH_PATHS = new Set([
  "/v1/auth/request-code",
  "/v1/auth/verify",
  "/v1/session",
  "/v1/auth/logout",
  "/v1/account/delete",
  "/v1/share-trial/reserve",
  "/v1/share-trial/complete",
  "/v1/share-trial/release",
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
  async scheduled(controller) {
    await runAccountAuthCleanup(this.env, controller);
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (ACCOUNT_AUTH_PATHS.has(url.pathname)) {
      return handleAccountAuthRequest(request, this.env, {
        serviceDependencies: {
          emailAdapter: createResendEmailAdapter(this.env),
        },
      });
    }
    return handleStripeHttpRequest(request, this.env);
  }
}
