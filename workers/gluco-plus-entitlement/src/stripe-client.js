import {
  CHECKOUT_SESSION_ID_PATTERN,
  PLUS_PRICE_JPY,
  PLUS_PRODUCT_CODE,
  STRIPE_API_VERSION,
  UUID_PATTERN,
} from "./constants.js";

const STRIPE_API_ORIGIN = "https://api.stripe.com";
const STRIPE_CHECKOUT_ORIGIN = "https://checkout.stripe.com";
const STRIPE_RESPONSE_LIMIT_BYTES = 256 * 1024;
const TEST_RESTRICTED_KEY_PATTERN = /^rk_test_[A-Za-z0-9]{16,}$/u;
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]{8,247}$/u;
const PRODUCT_ID_PATTERN = /^prod_[A-Za-z0-9]{8,247}$/u;
const PAYMENT_INTENT_ID_PATTERN = /^pi_[A-Za-z0-9]{8,247}$/u;
const CHARGE_ID_PATTERN = /^ch_[A-Za-z0-9]{8,247}$/u;
const REFUND_ID_PATTERN = /^re_[A-Za-z0-9]{8,247}$/u;

export class StripeAdapterError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = "StripeAdapterError";
    this.code = code;
    this.status = status;
  }
}

function requirePattern(value, pattern, code) {
  const normalized = String(value ?? "").trim();
  if (!pattern.test(normalized)) {
    throw new StripeAdapterError(code, 503);
  }
  return normalized;
}

function readContentLength(headers) {
  const raw = headers.get("content-length");
  if (raw === null) return null;
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

async function readBoundedResponseBytes(response, maximumBytes) {
  const contentLength = readContentLength(response.headers);
  if (contentLength !== null && contentLength > maximumBytes) {
    throw new StripeAdapterError("stripe_response_too_large", 502);
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new StripeAdapterError("stripe_response_too_large", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function readStripeJson(response) {
  const bytes = await readBoundedResponseBytes(
    response,
    STRIPE_RESPONSE_LIMIT_BYTES,
  );
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    throw new StripeAdapterError(
      retryable ? "stripe_api_unavailable" : "stripe_api_rejected",
      retryable ? 503 : 502,
    );
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    throw new StripeAdapterError("invalid_stripe_response", 502);
  }
}

function requestLetterSuffix(requestId) {
  // requestId is UUIDv4 entropy generated once for the logical purchase. Reusing
  // it yields the same Stripe body and Idempotency-Key on every network retry.
  const randomHex = requestId.replaceAll("-", "").slice(-16);
  let suffix = "";
  for (let index = 0; index < randomHex.length; index += 2) {
    const value = Number.parseInt(randomHex.slice(index, index + 2), 16);
    suffix += String.fromCharCode(97 + (value % 26));
  }
  return suffix;
}

function assertUuid(value, code = "invalid_checkout_request") {
  const normalized = String(value ?? "").toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw new StripeAdapterError(code, 400);
  }
  return normalized;
}

function normalizeObjectId(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.id === "string") return value.id;
  return "";
}

export function readStripeTestConfig(env = {}) {
  return Object.freeze({
    apiKey: requirePattern(
      env.STRIPE_RESTRICTED_API_KEY,
      TEST_RESTRICTED_KEY_PATTERN,
      "stripe_test_restricted_key_unavailable",
    ),
    priceId: requirePattern(
      env.STRIPE_PLUS_PRICE_ID,
      PRICE_ID_PATTERN,
      "stripe_test_price_unavailable",
    ),
    productId: requirePattern(
      env.STRIPE_PLUS_PRODUCT_ID,
      PRODUCT_ID_PATTERN,
      "stripe_test_product_unavailable",
    ),
  });
}

function validateCommonPlusCheckout(session, config) {
  if (!session || typeof session !== "object") {
    throw new StripeAdapterError("invalid_checkout_session", 400);
  }
  if (!CHECKOUT_SESSION_ID_PATTERN.test(String(session.id ?? ""))
    || !String(session.id).startsWith("cs_test_")) {
    throw new StripeAdapterError("invalid_checkout_session", 400);
  }
  if (session.livemode !== false || session.mode !== "payment") {
    throw new StripeAdapterError("invalid_checkout_mode", 400);
  }
  if (session.amount_total !== PLUS_PRICE_JPY
    || session.amount_subtotal !== PLUS_PRICE_JPY
    || session.currency !== "jpy") {
    throw new StripeAdapterError("invalid_checkout_amount", 400);
  }

  const lines = session.line_items?.data;
  if (!Array.isArray(lines) || lines.length !== 1
    || session.line_items?.has_more === true) {
    throw new StripeAdapterError("invalid_checkout_line_items", 400);
  }
  const line = lines[0];
  const price = line?.price;
  const productId = normalizeObjectId(price?.product);
  if (line?.quantity !== 1
    || line?.amount_total !== PLUS_PRICE_JPY
    || price?.id !== config.priceId
    || price?.currency !== "jpy"
    || price?.unit_amount !== PLUS_PRICE_JPY
    || price?.recurring !== null
    || productId !== config.productId) {
    throw new StripeAdapterError("invalid_checkout_product", 400);
  }

  const metadata = session.metadata;
  const accountId = assertUuid(metadata?.glucoscope_account_id, "invalid_account_mapping");
  const requestId = assertUuid(
    metadata?.glucoscope_checkout_request_id,
    "invalid_checkout_request_mapping",
  );
  if (metadata?.glucoscope_product_code !== PLUS_PRODUCT_CODE
    || session.client_reference_id !== accountId) {
    throw new StripeAdapterError("invalid_account_mapping", 400);
  }
  return Object.freeze({
    checkoutSessionId: session.id,
    accountId,
    requestId,
  });
}

function readCheckoutUrl(value, code) {
  let checkoutUrl;
  try {
    checkoutUrl = new URL(value);
  } catch {
    throw new StripeAdapterError(code, 502);
  }
  if (checkoutUrl.origin !== STRIPE_CHECKOUT_ORIGIN) {
    throw new StripeAdapterError(code, 502);
  }
  return checkoutUrl.href;
}

export function validateRetrievedPlusCheckout(session, config) {
  const common = validateCommonPlusCheckout(session, config);
  if (session.status !== "complete") {
    throw new StripeAdapterError("checkout_not_complete", 400);
  }
  if (session.payment_status !== "paid") {
    if (session.payment_status !== "unpaid") {
      throw new StripeAdapterError("invalid_checkout_payment_status", 400);
    }
    return Object.freeze({ status: "not_paid", ...common });
  }
  const paymentIntentId = normalizeObjectId(session.payment_intent);
  if (!PAYMENT_INTENT_ID_PATTERN.test(paymentIntentId)) {
    throw new StripeAdapterError("invalid_payment_intent", 400);
  }

  return Object.freeze({
    status: "paid",
    ...common,
    paymentIntentId,
  });
}

export function validateReusablePlusCheckout(
  session,
  config,
  { accountId, requestId, now },
) {
  const common = validateCommonPlusCheckout(session, config);
  if (common.accountId !== accountId || common.requestId !== requestId) {
    throw new StripeAdapterError("checkout_attempt_mismatch", 400);
  }
  const expiresAt = Number(session.expires_at) * 1000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) {
    throw new StripeAdapterError("invalid_checkout_expiry", 400);
  }
  if (session.status === "expired") {
    return Object.freeze({ status: "expired", expiresAt });
  }
  if (session.status === "complete") {
    return Object.freeze({ status: "confirmation_pending", expiresAt });
  }
  if (session.status !== "open" || session.payment_status !== "unpaid") {
    throw new StripeAdapterError("invalid_checkout_state", 400);
  }
  if (expiresAt <= now) {
    // Stripe remains authoritative for expiry. A locally elapsed expires_at
    // must never create a second payable Session while Stripe still says open.
    return Object.freeze({ status: "confirmation_pending", expiresAt });
  }
  return Object.freeze({
    status: "open",
    checkoutUrl: readCheckoutUrl(session.url, "invalid_checkout_url"),
    expiresAt,
  });
}

export function validateExpiredPlusCheckout(session, config) {
  const common = validateCommonPlusCheckout(session, config);
  const expiresAt = Number(session.expires_at) * 1000;
  if (session.status !== "expired"
    || session.payment_status !== "unpaid"
    || !Number.isSafeInteger(expiresAt)
    || expiresAt <= 0) {
    throw new StripeAdapterError("invalid_expired_checkout", 400);
  }
  return Object.freeze({ ...common, expiresAt });
}

export function validateRetrievedRefund(refund) {
  if (!refund || typeof refund !== "object"
    || !REFUND_ID_PATTERN.test(String(refund.id ?? ""))) {
    throw new StripeAdapterError("invalid_refund", 400);
  }
  if (refund.status !== "succeeded") {
    return Object.freeze({ status: "not_succeeded" });
  }
  if (refund.currency !== "jpy"
    || !Number.isSafeInteger(refund.amount)
    || refund.amount <= 0
    || refund.amount > PLUS_PRICE_JPY) {
    throw new StripeAdapterError("invalid_refund_amount", 400);
  }
  const chargeId = normalizeObjectId(refund.charge);
  if (!CHARGE_ID_PATTERN.test(chargeId)) {
    throw new StripeAdapterError("invalid_refund_charge", 400);
  }
  return Object.freeze({ status: "succeeded", refundId: refund.id, chargeId });
}

export function validateRetrievedRefundedCharge(charge) {
  if (!charge || typeof charge !== "object"
    || !CHARGE_ID_PATTERN.test(String(charge.id ?? ""))) {
    throw new StripeAdapterError("invalid_refunded_charge", 400);
  }
  const paymentIntentId = normalizeObjectId(charge.payment_intent);
  if (charge.livemode !== false
    || charge.currency !== "jpy"
    || charge.amount !== PLUS_PRICE_JPY
    || charge.paid !== true
    || charge.status !== "succeeded"
    || !Number.isSafeInteger(charge.amount_refunded)
    || charge.amount_refunded <= 0
    || charge.amount_refunded > PLUS_PRICE_JPY
    || !PAYMENT_INTENT_ID_PATTERN.test(paymentIntentId)) {
    throw new StripeAdapterError("invalid_refunded_charge", 400);
  }
  return Object.freeze({
    chargeId: charge.id,
    paymentIntentId,
    amountRefunded: charge.amount_refunded,
  });
}

export function createStripeTestClient(env = {}, dependencies = {}) {
  const config = readStripeTestConfig(env);
  const fetchImpl = dependencies.fetch || fetch;
  const now = dependencies.now || Date.now;
  const apiOrigin = dependencies.apiOrigin || STRIPE_API_ORIGIN;

  async function request(path, {
    method = "GET",
    form = null,
    query = null,
    idempotencyKey = null,
  } = {}) {
    const url = new URL(path, apiOrigin);
    if (url.origin !== new URL(apiOrigin).origin) {
      throw new StripeAdapterError("invalid_stripe_request", 500);
    }
    if (query) {
      for (const [key, value] of query) url.searchParams.append(key, value);
    }
    const headers = new Headers({
      Authorization: `Bearer ${config.apiKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    });
    let body;
    if (form) {
      headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
      body = form.toString();
    }
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers,
        body,
        // Manual mode keeps the request single-hop; readStripeJson rejects
        // every 3xx without forwarding the Authorization header or request
        // body elsewhere. It also avoids relying on redirect:"error", which
        // proved incompatible with the accepted Workers-to-Resend path.
        redirect: "manual",
      });
    } catch {
      throw new StripeAdapterError("stripe_api_unavailable", 503);
    }
    return readStripeJson(response);
  }

  return Object.freeze({
    config,

    async createPlusCheckout({ accountId: rawAccountId, requestId: rawRequestId, successUrl, cancelUrl }) {
      const accountId = assertUuid(rawAccountId, "invalid_account_mapping");
      const requestId = assertUuid(rawRequestId);
      const integrationIdentifier = `glucoscope_plus_${requestLetterSuffix(requestId)}`;
      const form = new URLSearchParams();
      for (const [key, value] of [
        ["mode", "payment"],
        ["success_url", successUrl],
        ["cancel_url", cancelUrl],
        ["line_items[0][price]", config.priceId],
        ["line_items[0][quantity]", "1"],
        ["locale", "ja"],
        ["submit_type", "pay"],
        ["payment_intent_data[description]", "GlucoScope Plus 30日パス（30日間・1回払い・自動更新なし）"],
        ["client_reference_id", accountId],
        ["metadata[glucoscope_account_id]", accountId],
        ["metadata[glucoscope_product_code]", PLUS_PRODUCT_CODE],
        ["metadata[glucoscope_checkout_request_id]", requestId],
        ["payment_intent_data[metadata][glucoscope_account_id]", accountId],
        ["payment_intent_data[metadata][glucoscope_product_code]", PLUS_PRODUCT_CODE],
        ["payment_intent_data[metadata][glucoscope_checkout_request_id]", requestId],
        ["integration_identifier", integrationIdentifier],
      ]) form.append(key, value);

      const session = await request("/v1/checkout/sessions", {
        method: "POST",
        form,
        idempotencyKey: `glucoscope-plus:${accountId}:${requestId}`,
      });
      if (!CHECKOUT_SESSION_ID_PATTERN.test(String(session?.id ?? ""))
        || !String(session.id).startsWith("cs_test_")
        || session.livemode !== false
        || session.mode !== "payment"
        || session.status !== "open"
        || session.payment_status !== "unpaid") {
        throw new StripeAdapterError("invalid_checkout_create_response", 502);
      }
      const observedAt = now();
      const expiresAt = Number(session.expires_at) * 1000;
      if (!Number.isSafeInteger(observedAt)
        || !Number.isSafeInteger(expiresAt)
        || expiresAt <= observedAt
        || expiresAt > observedAt + 25 * 60 * 60 * 1000) {
        throw new StripeAdapterError("invalid_checkout_create_response", 502);
      }
      return Object.freeze({
        checkoutUrl: readCheckoutUrl(
          session.url,
          "invalid_checkout_create_response",
        ),
        checkoutSessionId: session.id,
        expiresAt,
      });
    },

    async retrieveCheckoutSession(checkoutSessionId) {
      if (!CHECKOUT_SESSION_ID_PATTERN.test(String(checkoutSessionId ?? ""))
        || !String(checkoutSessionId).startsWith("cs_test_")) {
        throw new StripeAdapterError("invalid_checkout_session", 400);
      }
      return request(`/v1/checkout/sessions/${encodeURIComponent(checkoutSessionId)}`, {
        query: [["expand[]", "line_items"]],
      });
    },

    async retrieveRefund(refundId) {
      if (!REFUND_ID_PATTERN.test(String(refundId ?? ""))) {
        throw new StripeAdapterError("invalid_refund", 400);
      }
      return request(`/v1/refunds/${encodeURIComponent(refundId)}`);
    },

    async retrieveCharge(chargeId) {
      if (!CHARGE_ID_PATTERN.test(String(chargeId ?? ""))) {
        throw new StripeAdapterError("invalid_refunded_charge", 400);
      }
      return request(`/v1/charges/${encodeURIComponent(chargeId)}`);
    },

    async findCheckoutByPaymentIntent(paymentIntentId) {
      if (!PAYMENT_INTENT_ID_PATTERN.test(String(paymentIntentId ?? ""))) {
        throw new StripeAdapterError("invalid_payment_intent", 400);
      }
      const list = await request("/v1/checkout/sessions", {
        query: [
          ["payment_intent", paymentIntentId],
          ["limit", "2"],
          ["expand[]", "data.line_items"],
        ],
      });
      if (!Array.isArray(list?.data) || list.data.length !== 1) {
        throw new StripeAdapterError("checkout_session_not_unique", 400);
      }
      return list.data[0];
    },
  });
}
