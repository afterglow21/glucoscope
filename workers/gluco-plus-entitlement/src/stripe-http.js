import {
  SESSION_TOKEN_PATTERN,
  STRIPE_CHECKOUT_BODY_LIMIT_BYTES,
  STRIPE_CHECKOUT_ROUTE,
  STRIPE_WEBHOOK_BODY_LIMIT_BYTES,
  STRIPE_WEBHOOK_ROUTE,
  UUID_PATTERN,
} from "./constants.js";
import {
  createPlusEntitlementService,
  createPublicUnavailableResponse,
  PlusEntitlementError,
  readPlusEntitlementConfig,
} from "./entitlement-core.js";
import { createD1PlusEntitlementStore } from "./d1-store.js";
import {
  createStripeTestClient,
  StripeAdapterError,
  validateReusablePlusCheckout,
} from "./stripe-client.js";
import {
  parseStripeWebhookEvent,
  processStripeWebhookEvent,
  readStripeWebhookConfig,
  verifyStripeWebhookSignature,
} from "./stripe-webhook.js";
import { readCommerceReadiness } from "./commerce-readiness.js";

class RequestBodyTooLargeError extends Error {}

const CHECKOUT_SUCCESS_RETURN_PATH =
  "/?mode=user&checkout=success#settings";
const CHECKOUT_CANCEL_RETURN_PATH =
  "/?mode=user&checkout=cancelled#settings";

function readBoolean(value, fallback = false) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return fallback;
}

function readContentLength(headers) {
  const raw = headers.get("content-length");
  if (raw === null) return null;
  if (!/^\d+$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

export async function readBoundedRequestBytes(request, maximumBytes) {
  const contentLength = readContentLength(request.headers);
  if (contentLength !== null && contentLength > maximumBytes) {
    throw new RequestBodyTooLargeError();
  }
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size failure remains authoritative even if cancellation fails.
        }
        throw new RequestBodyTooLargeError();
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

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  };
}

function checkoutCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

function jsonResponse(body, status, origin = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...noStoreHeaders(),
      ...(origin ? checkoutCorsHeaders(origin) : {}),
    },
  });
}

function emptyResponse(status, headers = {}) {
  return new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      ...headers,
    },
  });
}

function parseAllowedOrigin(value) {
  const raw = String(value ?? "").trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:"
      || url.username
      || url.password
      || url.pathname !== "/"
      || url.search
      || url.hash
      || url.origin !== raw) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function buildReturnUrl(origin, rawPath, expectedPath) {
  const path = String(rawPath ?? "").trim();
  if (path !== expectedPath || !path.startsWith("/") || path.startsWith("//")) {
    throw new StripeAdapterError("checkout_return_path_unavailable", 503);
  }
  const url = new URL(path, origin);
  if (url.origin !== origin
    || url.username
    || url.password
    || `${url.pathname}${url.search}${url.hash}` !== expectedPath) {
    throw new StripeAdapterError("checkout_return_path_unavailable", 503);
  }
  return url.href;
}

function parseBearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(
    request.headers.get("authorization") || "",
  );
  if (!match || !SESSION_TOKEN_PATTERN.test(match[1])) return null;
  return match[1];
}

function parseCheckoutBody(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)
      || Object.keys(body).length !== 1
      || !UUID_PATTERN.test(String(body.requestId ?? ""))) {
      throw new Error("invalid body");
    }
    return { requestId: String(body.requestId).toLowerCase() };
  } catch {
    throw new StripeAdapterError("invalid_checkout_request", 400);
  }
}

function isJsonContentType(request) {
  const contentType = request.headers.get("content-type") || "";
  return /^application\/json(?:\s*;|$)/iu.test(contentType);
}

function checkoutErrorResponse(error, origin) {
  if (error instanceof RequestBodyTooLargeError) {
    return jsonResponse({ ok: false, error: "request_too_large" }, 413, origin);
  }
  if (error instanceof StripeAdapterError || error instanceof PlusEntitlementError) {
    return jsonResponse({ ok: false, error: error.code }, error.status, origin);
  }
  return jsonResponse({ ok: false, error: "service_unavailable" }, 503, origin);
}

function readObservedAt(now) {
  const observedAt = now();
  if (!Number.isSafeInteger(observedAt) || observedAt < 0) {
    throw new StripeAdapterError("service_unavailable", 503);
  }
  return observedAt;
}

async function createOrReuseCheckout({
  accountId,
  requestId,
  successUrl,
  cancelUrl,
  config,
  store,
  stripe,
  now,
}) {
  // One retry is reserved for replacing a Stripe-confirmed expired Session.
  // Ambiguous Stripe/D1 failures deliberately leave the short reservation in
  // place so a second browser tab cannot create a different payable Session.
  for (let pass = 0; pass < 2; pass += 1) {
    const observedAt = readObservedAt(now);
    const reservation = await store.reserveCheckoutAttempt({
      accountId,
      requestId,
      reservedAt: observedAt,
      reservationExpiresAt: observedAt + config.checkoutReservationTtlMs,
    });

    if (reservation.status === "plus_active") {
      throw new StripeAdapterError("plus_already_active", 409);
    }
    if (reservation.status === "purchase_completed") {
      throw new StripeAdapterError("checkout_confirmation_pending", 409);
    }
    if (reservation.status === "checkout_in_progress") {
      throw new StripeAdapterError("checkout_creation_in_progress", 409);
    }

    if (reservation.status === "reserved") {
      const checkout = await stripe.createPlusCheckout({
        accountId,
        requestId,
        successUrl,
        cancelUrl,
      });
      const completion = await store.completeCheckoutAttempt({
        accountId,
        requestId,
        checkoutSessionId: checkout.checkoutSessionId,
        expiresAt: checkout.expiresAt,
        now: readObservedAt(now),
      });
      if (completion.status !== "open") {
        throw new StripeAdapterError("checkout_state_changed", 409);
      }
      return checkout.checkoutUrl;
    }

    if (reservation.status !== "existing") {
      throw new StripeAdapterError("checkout_unavailable", 503);
    }

    const session = await stripe.retrieveCheckoutSession(
      reservation.checkoutSessionId,
    );
    const reusable = validateReusablePlusCheckout(session, stripe.config, {
      accountId,
      requestId: reservation.requestId,
      now: observedAt,
    });
    if (reusable.status === "open") return reusable.checkoutUrl;
    if (reusable.status === "confirmation_pending") {
      throw new StripeAdapterError("checkout_confirmation_pending", 409);
    }

    const expired = await store.expireCheckoutAttempt({
      accountId,
      requestId: reservation.requestId,
      checkoutSessionId: reservation.checkoutSessionId,
      now: observedAt,
    });
    if (!expired.expired || pass > 0) {
      throw new StripeAdapterError("checkout_state_changed", 409);
    }
  }
  throw new StripeAdapterError("checkout_unavailable", 503);
}

function webhookErrorResponse(error) {
  if (error instanceof RequestBodyTooLargeError) {
    return jsonResponse({ received: false, error: "request_too_large" }, 413);
  }
  if (error instanceof StripeAdapterError || error instanceof PlusEntitlementError) {
    return jsonResponse({ received: false, error: error.code }, error.status);
  }
  return jsonResponse({ received: false, error: "service_unavailable" }, 503);
}

async function handleCheckout(request, env, dependencies) {
  const checkoutEnabled = readBoolean(env.PLUS_CHECKOUT_HTTP_ENABLED, false);
  const purchasesEnabled = readBoolean(env.PLUS_PURCHASES_ENABLED, false);
  if (!checkoutEnabled || !purchasesEnabled) {
    return createPublicUnavailableResponse();
  }

  const allowedOrigin = parseAllowedOrigin(env.PLUS_ALLOWED_ORIGIN);
  const requestOrigin = request.headers.get("origin");
  if (!allowedOrigin || requestOrigin !== allowedOrigin) {
    return jsonResponse({ ok: false, error: "origin_not_allowed" }, 403);
  }
  if (request.method === "OPTIONS") {
    if (request.headers.get("access-control-request-method") !== "POST") {
      return emptyResponse(403);
    }
    return emptyResponse(204, {
      ...checkoutCorsHeaders(allowedOrigin),
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "POST",
      "Access-Control-Max-Age": "600",
    });
  }
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed" }, 405, allowedOrigin);
  }
  if (!isJsonContentType(request)) {
    return jsonResponse({ ok: false, error: "unsupported_media_type" }, 415, allowedOrigin);
  }

  const commerceReadiness = readCommerceReadiness(env, allowedOrigin);
  if (!commerceReadiness.ready) {
    return jsonResponse({ ok: false, error: "sales_not_ready" }, 503, allowedOrigin);
  }

  try {
    const token = parseBearerToken(request);
    if (!token) {
      return jsonResponse({ ok: false, error: "authentication_required" }, 401, allowedOrigin);
    }
    const body = parseCheckoutBody(await readBoundedRequestBytes(
      request,
      STRIPE_CHECKOUT_BODY_LIMIT_BYTES,
    ));
    const entitlementService = dependencies.entitlementService
      || createPlusEntitlementService(env);
    const subject = await entitlementService.resolveCheckoutBuyer(
      token,
      commerceReadiness.buyerConfirmationVersion,
    );
    if (subject?.status === "invalid_session") {
      return jsonResponse({ ok: false, error: "authentication_required" }, 401, allowedOrigin);
    }
    if (subject?.status !== "ok") {
      return jsonResponse({ ok: false, error: "buyer_confirmation_required" }, 409, allowedOrigin);
    }
    if (subject.plusActive) {
      return jsonResponse({ ok: false, error: "plus_already_active" }, 409, allowedOrigin);
    }

    const config = readPlusEntitlementConfig(env);
    const store = dependencies.store
      || createD1PlusEntitlementStore(env.PLUS_DB);
    const stripe = dependencies.stripeClient
      || createStripeTestClient(env, dependencies.stripeDependencies);
    const now = dependencies.now || Date.now;
    const checkoutUrl = await createOrReuseCheckout({
      accountId: subject.subjectId,
      requestId: body.requestId,
      successUrl: buildReturnUrl(
        allowedOrigin,
        env.PLUS_CHECKOUT_SUCCESS_PATH,
        CHECKOUT_SUCCESS_RETURN_PATH,
      ),
      cancelUrl: buildReturnUrl(
        allowedOrigin,
        env.PLUS_CHECKOUT_CANCEL_PATH,
        CHECKOUT_CANCEL_RETURN_PATH,
      ),
      config,
      store,
      stripe,
      now,
    });
    return jsonResponse({ ok: true, checkoutUrl }, 200, allowedOrigin);
  } catch (error) {
    return checkoutErrorResponse(error, allowedOrigin);
  }
}

async function handleWebhook(request, env, dependencies) {
  const webhookConfig = readStripeWebhookConfig(env);
  if (!webhookConfig.enabled) return createPublicUnavailableResponse();
  if (request.method !== "POST") {
    return jsonResponse({ received: false, error: "method_not_allowed" }, 405);
  }
  if (!isJsonContentType(request)) {
    return jsonResponse({ received: false, error: "unsupported_media_type" }, 415);
  }
  if (!/^whsec_[A-Za-z0-9]{16,}$/u.test(webhookConfig.secret)) {
    return jsonResponse({ received: false, error: "webhook_secret_unavailable" }, 503);
  }

  try {
    const rawBody = await readBoundedRequestBytes(
      request,
      STRIPE_WEBHOOK_BODY_LIMIT_BYTES,
    );
    const now = dependencies.now || Date.now;
    const verified = await verifyStripeWebhookSignature({
      rawBody,
      signatureHeader: request.headers.get("stripe-signature"),
      secret: webhookConfig.secret,
      now: now(),
      toleranceSeconds: webhookConfig.signatureToleranceSeconds,
      cryptoImpl: dependencies.crypto || crypto,
    });
    if (!verified) {
      return jsonResponse({ received: false, error: "invalid_signature" }, 400);
    }
    const event = parseStripeWebhookEvent(rawBody);
    await processStripeWebhookEvent(event, env, {
      ...dependencies,
      now,
    });
    return jsonResponse({ received: true }, 200);
  } catch (error) {
    return webhookErrorResponse(error);
  }
}

export async function handleStripeHttpRequest(request, env = {}, dependencies = {}) {
  const url = new URL(request.url);
  if (url.search) return createPublicUnavailableResponse();
  if (url.pathname === STRIPE_CHECKOUT_ROUTE) {
    return handleCheckout(request, env, dependencies);
  }
  if (url.pathname === STRIPE_WEBHOOK_ROUTE) {
    return handleWebhook(request, env, dependencies);
  }
  return createPublicUnavailableResponse();
}
