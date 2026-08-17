import {
  EXPIRED_CHECKOUT_EVENT_TYPES,
  FAILED_PAYMENT_EVENT_TYPES,
  PLUS_PRICE_JPY,
  STRIPE_API_VERSION,
  STRIPE_REFUND_EVENT_TYPES,
  STRIPE_RELEVANT_EVENT_TYPES,
  STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  VERIFIED_PAYMENT_EVENT_TYPES,
} from "./constants.js";
import { createD1PlusEntitlementStore } from "./d1-store.js";
import { applyVerifiedPlusPayment } from "./entitlement-core.js";
import {
  createStripeTestClient,
  StripeAdapterError,
  validateExpiredPlusCheckout,
  validateRetrievedPlusCheckout,
  validateRetrievedRefund,
  validateRetrievedRefundedCharge,
} from "./stripe-client.js";

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]{8,247}$/u;
const TEST_WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9]{16,}$/u;
const REFUND_ID_PATTERN = /^re_[A-Za-z0-9]{8,247}$/u;
const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9]{8,247}$/u;

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

export function readStripeWebhookConfig(env = {}) {
  const enabled = readBoolean(env.PLUS_STRIPE_WEBHOOK_ENABLED, false);
  const secret = String(env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  return Object.freeze({
    enabled,
    secret,
    signatureToleranceSeconds: readInteger(
      env.STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      STRIPE_WEBHOOK_TOLERANCE_SECONDS,
      60,
      15 * 60,
    ),
  });
}

function parseSignatureHeader(header) {
  const timestamps = [];
  const signatures = [];
  for (const part of String(header ?? "").split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d{1,12}$/u.test(value)) {
      const timestamp = Number(value);
      if (Number.isSafeInteger(timestamp)) timestamps.push(timestamp);
    }
    if (key === "v1" && /^[0-9a-f]{64}$/iu.test(value)) {
      signatures.push(value.toLowerCase());
    }
  }
  return { timestamps, signatures };
}

function hexToBytes(value) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function makeSignedPayload(timestamp, rawBody) {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.byteLength + rawBody.byteLength);
  payload.set(prefix, 0);
  payload.set(rawBody, prefix.byteLength);
  return payload;
}

export async function verifyStripeWebhookSignature({
  rawBody,
  signatureHeader,
  secret,
  now = Date.now(),
  toleranceSeconds = STRIPE_WEBHOOK_TOLERANCE_SECONDS,
  cryptoImpl = crypto,
}) {
  if (!(rawBody instanceof Uint8Array)
    || !TEST_WEBHOOK_SECRET_PATTERN.test(String(secret ?? ""))) {
    return false;
  }
  const { timestamps, signatures } = parseSignatureHeader(signatureHeader);
  if (timestamps.length !== 1 || signatures.length === 0) return false;
  const timestamp = timestamps[0];
  const nowSeconds = Math.floor(now / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const key = await cryptoImpl.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const payload = makeSignedPayload(timestamp, rawBody);
  for (const signature of signatures) {
    if (await cryptoImpl.subtle.verify(
      "HMAC",
      key,
      hexToBytes(signature),
      payload,
    )) return true;
  }
  return false;
}

export function parseStripeWebhookEvent(rawBody) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    const event = JSON.parse(text);
    if (!event || typeof event !== "object"
      || !EVENT_ID_PATTERN.test(String(event.id ?? ""))
      || typeof event.type !== "string"
      || !Number.isSafeInteger(event.created)
      || event.created < 0
      || event.livemode !== false
      || event.api_version !== STRIPE_API_VERSION
      || (event.account !== null && event.account !== undefined)
      || !event.data
      || typeof event.data.object !== "object") {
      throw new Error("invalid event");
    }
    return event;
  } catch {
    throw new StripeAdapterError("invalid_webhook_event", 400);
  }
}

function objectId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.id === "string") return value.id;
  return "";
}

function requireStore(store) {
  if (!store || typeof store.revokeForVerifiedRefund !== "function") {
    throw new TypeError("A Plus entitlement store with refund support is required");
  }
  return store;
}

function requireCheckoutFailureStore(store) {
  if (!store || typeof store.applyVerifiedCheckoutFailure !== "function") {
    throw new TypeError("A Plus entitlement store with Checkout failure support is required");
  }
  return store;
}

function requireCheckoutExpiryStore(store) {
  if (!store || typeof store.applyVerifiedCheckoutExpiry !== "function") {
    throw new TypeError("A Plus entitlement store with Checkout expiry support is required");
  }
  return store;
}

function requireSafeEventTime(event, now) {
  const eventTime = event.created * 1000;
  if (!Number.isSafeInteger(eventTime) || eventTime > now + 5 * 60 * 1000) {
    throw new StripeAdapterError("invalid_webhook_time", 400);
  }
  return eventTime;
}

export async function processStripeWebhookEvent(event, env = {}, dependencies = {}) {
  const webhookConfig = readStripeWebhookConfig(env);
  if (!webhookConfig.enabled) {
    throw new StripeAdapterError("stripe_webhook_paused", 503);
  }
  if (!STRIPE_RELEVANT_EVENT_TYPES.has(event.type)) {
    return Object.freeze({ status: "ignored" });
  }

  const now = dependencies.now || Date.now;
  const observedAt = now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new StripeAdapterError("invalid_webhook_time", 400);
  }
  const eventTime = requireSafeEventTime(event, observedAt);
  const stripe = dependencies.stripeClient
    || createStripeTestClient(env, dependencies.stripeDependencies);
  const store = dependencies.store
    || createD1PlusEntitlementStore(env.PLUS_DB);

  if (VERIFIED_PAYMENT_EVENT_TYPES.has(event.type)) {
    const checkoutSessionId = objectId(event.data.object);
    const retrieved = await stripe.retrieveCheckoutSession(checkoutSessionId);
    if (retrieved?.id !== checkoutSessionId) {
      throw new StripeAdapterError("checkout_session_mismatch", 400);
    }
    const validated = validateRetrievedPlusCheckout(retrieved, stripe.config);
    if (validated.status === "not_paid") {
      if (event.type === "checkout.session.async_payment_succeeded") {
        throw new StripeAdapterError("checkout_payment_not_visible", 503);
      }
      return Object.freeze({ status: "payment_pending" });
    }
    return applyVerifiedPlusPayment({
      eventId: event.id,
      checkoutSessionId: validated.checkoutSessionId,
      eventType: event.type,
      accountId: validated.accountId,
      amountJpy: PLUS_PRICE_JPY,
      currency: "jpy",
      paidAt: eventTime,
    }, store, {
      env,
      now: () => observedAt,
      crypto: dependencies.crypto || crypto,
    });
  }

  if (FAILED_PAYMENT_EVENT_TYPES.has(event.type)) {
    const checkoutSessionId = objectId(event.data.object);
    const retrieved = await stripe.retrieveCheckoutSession(checkoutSessionId);
    if (retrieved?.id !== checkoutSessionId) {
      throw new StripeAdapterError("checkout_session_mismatch", 400);
    }
    const validated = validateRetrievedPlusCheckout(retrieved, stripe.config);
    if (validated.status === "paid") {
      return Object.freeze({ status: "paid_state_preserved" });
    }
    const result = await requireCheckoutFailureStore(store)
      .applyVerifiedCheckoutFailure({
        eventId: event.id,
        checkoutSessionId: validated.checkoutSessionId,
        eventType: event.type,
        accountId: validated.accountId,
        requestId: validated.requestId,
        failedAt: eventTime,
        processedAt: observedAt,
      });
    if (result.status === "event_conflict"
      || result.status === "checkout_session_conflict") {
      throw new StripeAdapterError("checkout_failure_conflict", 400);
    }
    if (result.status === "not_found"
      || (result.status === "duplicate" && result.outcome === "not_found")) {
      throw new StripeAdapterError("checkout_failure_not_applied", 503);
    }
    return result;
  }

  if (EXPIRED_CHECKOUT_EVENT_TYPES.has(event.type)) {
    const checkoutSessionId = objectId(event.data.object);
    const retrieved = await stripe.retrieveCheckoutSession(checkoutSessionId);
    if (retrieved?.id !== checkoutSessionId) {
      throw new StripeAdapterError("checkout_session_mismatch", 400);
    }
    const validated = validateExpiredPlusCheckout(retrieved, stripe.config);
    const result = await requireCheckoutExpiryStore(store)
      .applyVerifiedCheckoutExpiry({
        eventId: event.id,
        checkoutSessionId: validated.checkoutSessionId,
        eventType: event.type,
        accountId: validated.accountId,
        requestId: validated.requestId,
        expiredAt: eventTime,
        processedAt: observedAt,
      });
    if (result.status === "event_conflict"
      || result.status === "checkout_session_conflict") {
      throw new StripeAdapterError("checkout_expiry_conflict", 400);
    }
    if (result.status === "not_found"
      || (result.status === "duplicate" && result.outcome === "not_found")) {
      throw new StripeAdapterError("checkout_expiry_not_applied", 503);
    }
    return result;
  }

  if (!STRIPE_REFUND_EVENT_TYPES.has(event.type)) {
    return Object.freeze({ status: "ignored" });
  }

  let refundId = null;
  let chargeId;
  let retrievedRefund = null;
  if (event.type === "charge.refunded") {
    chargeId = objectId(event.data.object);
    if (!CHARGE_ID_PATTERN.test(chargeId)) {
      throw new StripeAdapterError("invalid_refunded_charge", 400);
    }
  } else {
    refundId = objectId(event.data.object);
    if (!REFUND_ID_PATTERN.test(refundId)) {
      throw new StripeAdapterError("invalid_refund", 400);
    }
    retrievedRefund = await stripe.retrieveRefund(refundId);
    if (retrievedRefund?.id !== refundId) {
      throw new StripeAdapterError("refund_mismatch", 400);
    }
    const refund = validateRetrievedRefund(retrievedRefund);
    if (refund.status === "not_succeeded") {
      return Object.freeze({ status: "refund_pending" });
    }
    chargeId = refund.chargeId;
  }

  const retrievedCharge = await stripe.retrieveCharge(chargeId);
  if (retrievedCharge?.id !== chargeId) {
    throw new StripeAdapterError("charge_mismatch", 400);
  }
  const charge = validateRetrievedRefundedCharge(retrievedCharge);
  const refundPaymentIntentId = objectId(retrievedRefund?.payment_intent);
  if (refundPaymentIntentId && refundPaymentIntentId !== charge.paymentIntentId) {
    throw new StripeAdapterError("refund_payment_mismatch", 400);
  }

  const retrievedSession = await stripe.findCheckoutByPaymentIntent(
    charge.paymentIntentId,
  );
  const validatedSession = validateRetrievedPlusCheckout(
    retrievedSession,
    stripe.config,
  );
  if (validatedSession.status !== "paid"
    || validatedSession.paymentIntentId !== charge.paymentIntentId) {
    throw new StripeAdapterError("refund_checkout_mismatch", 400);
  }

  return requireStore(store).revokeForVerifiedRefund({
    eventId: event.id,
    eventType: event.type,
    checkoutSessionId: validatedSession.checkoutSessionId,
    refundId,
    chargeId: charge.chargeId,
    refundedAt: eventTime,
    processedAt: observedAt,
  });
}
