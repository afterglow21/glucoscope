import {
  CHECKOUT_SESSION_ID_PATTERN,
  DEFAULT_CHECKOUT_RESERVATION_TTL_MS,
  DEFAULT_SHARE_TRIAL_RESERVATION_TTL_MS,
  FREE_AI_DAILY_SUCCESS_LIMIT,
  PLUS_AI_DAILY_SUCCESS_LIMIT,
  PLUS_DURATION_MS,
  PLUS_PRICE_JPY,
  SESSION_TOKEN_PATTERN,
  UUID_PATTERN,
  VERIFIED_PAYMENT_EVENT_TYPES,
} from "./constants.js";
import { hashSessionToken } from "./credentials.js";
import { createD1PlusEntitlementStore } from "./d1-store.js";

const MAX_PROVIDER_EVENT_ID_LENGTH = 255;

export class PlusEntitlementError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "PlusEntitlementError";
    this.code = code;
    this.status = status;
  }
}

function readBoolean(value, fallback = false) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function readInteger(value, fallback, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, numeric));
}

export function readPlusEntitlementConfig(env = {}) {
  return Object.freeze({
    rpcEnabled: readBoolean(env.PLUS_ENTITLEMENT_RPC_ENABLED, false),
    purchasesEnabled: readBoolean(env.PLUS_PURCHASES_ENABLED, false),
    checkoutReservationTtlMs: readInteger(
      env.PLUS_CHECKOUT_RESERVATION_TTL_SECONDS,
      DEFAULT_CHECKOUT_RESERVATION_TTL_MS / 1000,
      60,
      30 * 60,
    ) * 1000,
    shareTrialReservationTtlMs: readInteger(
      env.SHARE_TRIAL_RESERVATION_TTL_SECONDS,
      DEFAULT_SHARE_TRIAL_RESERVATION_TTL_MS / 1000,
      60,
      30 * 60,
    ) * 1000,
  });
}

function requireRpcEnabled(config) {
  if (!config.rpcEnabled) {
    throw new PlusEntitlementError("plus_entitlement_paused", 503);
  }
}

function validateSessionToken(value) {
  const token = String(value ?? "");
  return SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

function validateRequestId(value) {
  const requestId = String(value ?? "").toLowerCase();
  if (!UUID_PATTERN.test(requestId)) {
    throw new PlusEntitlementError("invalid_request", 400);
  }
  return requestId;
}

function requireSafeEpoch(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new PlusEntitlementError(`invalid_${fieldName}`, 400);
  }
  return value;
}

function normalizeProviderEventId(value) {
  const eventId = String(value ?? "").trim();
  if (!eventId || eventId.length > MAX_PROVIDER_EVENT_ID_LENGTH) {
    throw new PlusEntitlementError("invalid_provider_event", 400);
  }
  return eventId;
}

function normalizeCheckoutSessionId(value) {
  const checkoutSessionId = String(value ?? "").trim();
  if (!CHECKOUT_SESSION_ID_PATTERN.test(checkoutSessionId)) {
    throw new PlusEntitlementError("invalid_checkout_session", 400);
  }
  return checkoutSessionId;
}

function publicPlusSummary(snapshot) {
  const active = Boolean(snapshot?.activeEntitlement);
  return Object.freeze({
    status: "ok",
    active,
    startsAt: active ? snapshot.activeEntitlement.startsAt : null,
    endsAt: active ? snapshot.activeEntitlement.endsAt : null,
    features: Object.freeze({
      customRange: active,
      shareStudio: active,
      aiDailySuccessLimit: active
        ? PLUS_AI_DAILY_SUCCESS_LIMIT
        : FREE_AI_DAILY_SUCCESS_LIMIT,
    }),
    shareTrial: Object.freeze({
      available: !active && !snapshot.shareTrialUsed,
      used: Boolean(snapshot.shareTrialUsed),
      reservationExpiresAt: !active
        ? snapshot.shareTrialReservationExpiresAt ?? null
        : null,
    }),
  });
}

function publicAdminAggregate(activePlusCount) {
  const count = Number(activePlusCount);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("active Plus aggregate is unavailable");
  }
  return Object.freeze({ activePlusCount: count });
}

export function createPublicUnavailableResponse() {
  return new Response(JSON.stringify({ ok: false, error: "service_unavailable" }), {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function createPlusEntitlementService(env = {}, dependencies = {}) {
  const config = readPlusEntitlementConfig(env);
  const now = dependencies.now || Date.now;
  const hashToken = dependencies.hashSessionToken || hashSessionToken;

  function getStore() {
    return dependencies.store || createD1PlusEntitlementStore(env.PLUS_DB);
  }

  async function resolveSnapshot(sessionToken) {
    requireRpcEnabled(config);
    const token = validateSessionToken(sessionToken);
    if (!token) return null;
    const tokenHash = await hashToken(token);
    const snapshot = await getStore().getSessionSnapshot({
      tokenHash,
      now: requireSafeEpoch(now(), "time"),
    });
    return snapshot || null;
  }

  return Object.freeze({
    async getAdminActivePlusSummary() {
      requireRpcEnabled(config);
      const activePlusCount = await getStore().getActivePlusCount({
        now: requireSafeEpoch(now(), "time"),
      });
      return publicAdminAggregate(activePlusCount);
    },

    async resolveAiSubject(sessionToken) {
      const snapshot = await resolveSnapshot(sessionToken);
      if (!snapshot) return Object.freeze({ status: "invalid_session" });
      const plusActive = Boolean(snapshot.activeEntitlement);
      return Object.freeze({
        status: "ok",
        subjectId: snapshot.accountId,
        plusActive,
      });
    },

    async getActivePlusSummary(sessionToken) {
      const snapshot = await resolveSnapshot(sessionToken);
      if (!snapshot) return Object.freeze({ status: "invalid_session" });
      return publicPlusSummary(snapshot);
    },

    async reserveShareTrial(sessionToken, requestIdValue) {
      const snapshot = await resolveSnapshot(sessionToken);
      if (!snapshot) return Object.freeze({ status: "invalid_session" });
      if (snapshot.activeEntitlement) {
        return Object.freeze({ status: "plus_active", grant: "plus" });
      }

      const requestId = validateRequestId(requestIdValue);
      const reservedAt = requireSafeEpoch(now(), "time");
      return getStore().reserveShareTrial({
        accountId: snapshot.accountId,
        requestId,
        reservedAt,
        expiresAt: reservedAt + config.shareTrialReservationTtlMs,
      });
    },

    async completeShareTrial(sessionToken, requestIdValue) {
      const snapshot = await resolveSnapshot(sessionToken);
      if (!snapshot) return Object.freeze({ status: "invalid_session" });
      const requestId = validateRequestId(requestIdValue);
      return getStore().completeShareTrial({
        accountId: snapshot.accountId,
        requestId,
        now: requireSafeEpoch(now(), "time"),
      });
    },

    async releaseShareTrial(sessionToken, requestIdValue) {
      const snapshot = await resolveSnapshot(sessionToken);
      if (!snapshot) return Object.freeze({ status: "invalid_session" });
      const requestId = validateRequestId(requestIdValue);
      return getStore().releaseShareTrial({
        accountId: snapshot.accountId,
        requestId,
        now: requireSafeEpoch(now(), "time"),
      });
    },
  });
}

export async function applyVerifiedPlusPayment(input, store, dependencies = {}) {
  const config = readPlusEntitlementConfig(dependencies.env);
  if (!config.purchasesEnabled) {
    throw new PlusEntitlementError("plus_purchases_paused", 503);
  }
  if (!store || typeof store.applyVerifiedPayment !== "function") {
    throw new TypeError("A Plus entitlement store is required");
  }

  const now = dependencies.now || Date.now;
  const cryptoImpl = dependencies.crypto || crypto;
  const eventId = normalizeProviderEventId(input?.eventId);
  const checkoutSessionId = normalizeCheckoutSessionId(input?.checkoutSessionId);
  const eventType = String(input?.eventType ?? "");
  if (!VERIFIED_PAYMENT_EVENT_TYPES.has(eventType)) {
    throw new PlusEntitlementError("invalid_provider_event", 400);
  }

  const accountId = String(input?.accountId ?? "").toLowerCase();
  if (!UUID_PATTERN.test(accountId)) {
    throw new PlusEntitlementError("invalid_account", 400);
  }
  const paidAt = requireSafeEpoch(input?.paidAt, "paid_at");
  const observedAt = requireSafeEpoch(now(), "time");
  if (paidAt > observedAt + 5 * 60 * 1000) {
    throw new PlusEntitlementError("invalid_paid_at", 400);
  }
  if (input?.amountJpy !== PLUS_PRICE_JPY || input?.currency !== "jpy") {
    throw new PlusEntitlementError("invalid_purchase", 400);
  }

  return store.applyVerifiedPayment({
    eventId,
    checkoutSessionId,
    eventType,
    accountId,
    amountJpy: PLUS_PRICE_JPY,
    currency: "jpy",
    paidAt,
    processedAt: observedAt,
    entitlementId: cryptoImpl.randomUUID(),
    startsAt: paidAt,
    endsAt: paidAt + PLUS_DURATION_MS,
  });
}
