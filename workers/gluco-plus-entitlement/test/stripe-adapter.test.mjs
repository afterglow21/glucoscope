import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  STRIPE_API_VERSION,
} from "../src/constants.js";
import { createD1PlusEntitlementStore } from "../src/d1-store.js";
import { createPlusEntitlementService } from "../src/entitlement-core.js";
import { readCommerceReadiness } from "../src/commerce-readiness.js";
import { handleStripeHttpRequest } from "../src/stripe-http.js";
import {
  createStripeClient,
  createStripeTestClient,
  readStripeConfig,
  StripeAdapterError,
  validateRetrievedPlusCheckout,
  validateReusablePlusCheckout,
} from "../src/stripe-client.js";
import {
  parseStripeWebhookEvent,
  verifyStripeWebhookSignature,
} from "../src/stripe-webhook.js";

const NOW = Date.parse("2026-08-15T06:00:00.000Z");
const NOW_SECONDS = Math.floor(NOW / 1000);
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_TOKEN = "A".repeat(43);
const SESSION_TOKEN_HASH = "h".repeat(43);
const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const SECOND_REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const ENTITLEMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const CHECKOUT_ID = `cs_test_${"c".repeat(24)}`;
const SECOND_CHECKOUT_ID = `cs_test_${"s".repeat(24)}`;
const PAYMENT_INTENT_ID = `pi_${"i".repeat(24)}`;
const CHARGE_ID = `ch_${"g".repeat(24)}`;
const REFUND_ID = `re_${"r".repeat(24)}`;
const PRICE_ID = `price_${"p".repeat(24)}`;
const PRODUCT_ID = `prod_${"d".repeat(24)}`;
const API_KEY = ["rk", "test", "k".repeat(32)].join("_");
const LIVE_API_KEY = ["rk", "live", "l".repeat(32)].join("_");
const WEBHOOK_SECRET = ["whsec", "w".repeat(32)].join("_");
const ALLOWED_ORIGIN = "https://glucoscope.app";
const TEST_STRIPE_CONFIG = Object.freeze({
  mode: "test",
  livemode: false,
  checkoutPrefix: "cs_test_",
  priceId: PRICE_ID,
  productId: PRODUCT_ID,
});

class NodeD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new NodeD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.raw.prepare(this.sql).get(...this.bindings) || null;
  }

  async run() {
    const result = this.database.raw.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }

  executeForBatch() {
    const statement = this.database.raw.prepare(this.sql);
    const returnsRows = /^\s*(?:SELECT|WITH)\b/iu.test(this.sql)
      || /\bRETURNING\b/iu.test(this.sql);
    if (returnsRows) {
      const results = statement.all(...this.bindings);
      const changes = Number(
        this.database.raw.prepare("SELECT changes() AS count").get().count,
      );
      return { results, meta: { changes } };
    }
    const result = statement.run(...this.bindings);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
}

class NodeD1Database {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new NodeD1Statement(this, sql);
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.executeForBatch());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.raw.close();
  }
}

function createDatabase() {
  const database = new NodeD1Database();
  for (const migrationName of [
    "0001_initial_plus_entitlement_schema.sql",
    "0002_account_auth.sql",
    "0003_stripe_checkout_state.sql",
    "0004_guardian_buyer_confirmation.sql",
    "0006_plus_price_400.sql",
    "0007_share_trial_reuse_retention.sql",
    "0008_live_stripe_checkout_ids.sql",
  ]) {
    const migration = readFileSync(
      new URL(`../migrations/${migrationName}`, import.meta.url),
      "utf8",
    );
    database.raw.exec(migration);
  }
  return database;
}

async function createVerifiedAccount(store, {
  buyerRole = "self",
  buyerConfirmationVersion = "2026-08-15",
} = {}) {
  await store.createAccount({
    id: ACCOUNT_ID,
    emailLookupHmac: "m".repeat(43),
    emailCiphertext: "encrypted-email-value-xxxx",
    emailKeyVersion: 1,
    verifiedAt: NOW,
    now: NOW,
    buyerRole,
    buyerConfirmationVersion,
    adultConfirmedAt: NOW,
    guardianConfirmedAt: buyerRole === "guardian" ? NOW : null,
  });
  await store.createSession({
    id: SESSION_ID,
    accountId: ACCOUNT_ID,
    tokenHash: SESSION_TOKEN_HASH,
    createdAt: NOW,
    expiresAt: NOW + 180 * 24 * 60 * 60 * 1000,
  });
}

function stripeConfigEnv() {
  return {
    STRIPE_MODE: "test",
    STRIPE_RESTRICTED_API_KEY: API_KEY,
    STRIPE_PLUS_PRICE_ID: PRICE_ID,
    STRIPE_PLUS_PRODUCT_ID: PRODUCT_ID,
  };
}

function enabledHttpEnv() {
  return {
    ...stripeConfigEnv(),
    PLUS_ENTITLEMENT_RPC_ENABLED: "true",
    PLUS_PURCHASES_ENABLED: "true",
    PLUS_CHECKOUT_HTTP_ENABLED: "true",
    PLUS_STRIPE_WEBHOOK_ENABLED: "true",
    PLUS_ALLOWED_ORIGIN: ALLOWED_ORIGIN,
    PLUS_CHECKOUT_SUCCESS_PATH: "/?mode=user&checkout=success#settings",
    PLUS_CHECKOUT_CANCEL_PATH: "/?mode=user&checkout=cancelled#settings",
    PLUS_SALES_READINESS_CONFIRMED: "true",
    PLUS_FINAL_PRICE_DISPLAY: "total_400_confirmed",
    PLUS_TAX_TREATMENT_CONFIRMED: "true",
    PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED: "true",
    PLUS_BUYER_POLICY: "adult_self_or_confirmed_guardian",
    PLUS_COMMERCIAL_DISCLOSURE_PATH:
      "/pages/trust/commercial-transactions.html",
    PLUS_REFUND_POLICY_PATH: "/pages/trust/plus-terms.html",
    PLUS_SUPPORT_PATH: "/pages/trust/plus-support.html",
    PLUS_TERMS_VERSION: "2026-08-15",
    PLUS_BUYER_CONFIRMATION_VERSION: "2026-08-15",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
}

test("commerce readiness requires final tax, buyer, terms, and same-site public pages", () => {
  const ready = readCommerceReadiness(enabledHttpEnv(), ALLOWED_ORIGIN);
  assert.equal(ready.ready, true);
  assert.equal(
    ready.commercialDisclosureUrl,
    `${ALLOWED_ORIGIN}/pages/trust/commercial-transactions.html`,
  );

  for (const override of [
    { PLUS_SALES_READINESS_CONFIRMED: "false" },
    { PLUS_FINAL_PRICE_DISPLAY: "undecided" },
    { PLUS_TAX_TREATMENT_CONFIRMED: "false" },
    { PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED: "false" },
    { PLUS_BUYER_POLICY: "guardian_shared_email" },
    { PLUS_BUYER_CONFIRMATION_VERSION: "" },
    { PLUS_BUYER_CONFIRMATION_VERSION: "2026-02-30" },
    { PLUS_TERMS_VERSION: "" },
    { PLUS_TERMS_VERSION: "2026-02-30" },
    { PLUS_TERMS_VERSION: "2026-13-01" },
    { PLUS_COMMERCIAL_DISCLOSURE_PATH: "https://attacker.invalid/terms" },
    { PLUS_REFUND_POLICY_PATH: "/outside-project.html" },
    { PLUS_SUPPORT_PATH: "/pages/trust/" },
    { PLUS_SUPPORT_PATH: "/glucoscope/pages/trust/plus-support.html" },
  ]) {
    assert.equal(
      readCommerceReadiness({ ...enabledHttpEnv(), ...override }, ALLOWED_ORIGIN).ready,
      false,
    );
  }
});

function validRetrievedSession(overrides = {}) {
  return {
    id: CHECKOUT_ID,
    livemode: false,
    mode: "payment",
    status: "complete",
    payment_status: "paid",
    amount_total: 400,
    amount_subtotal: 400,
    currency: "jpy",
    client_reference_id: ACCOUNT_ID,
    metadata: {
      glucoscope_account_id: ACCOUNT_ID,
      glucoscope_product_code: "plus_30d",
      glucoscope_checkout_request_id: REQUEST_ID,
    },
    payment_intent: PAYMENT_INTENT_ID,
    line_items: {
      has_more: false,
      data: [{
        quantity: 1,
        amount_total: 400,
        price: {
          id: PRICE_ID,
          currency: "jpy",
          unit_amount: 400,
          recurring: null,
          product: { id: PRODUCT_ID },
        },
      }],
    },
    ...overrides,
  };
}

function validOpenSession({
  checkoutSessionId = CHECKOUT_ID,
  requestId = REQUEST_ID,
  expiresAt = NOW + 60 * 60 * 1000,
  overrides = {},
} = {}) {
  return validRetrievedSession({
    id: checkoutSessionId,
    status: "open",
    payment_status: "unpaid",
    payment_intent: null,
    expires_at: Math.floor(expiresAt / 1000),
    url: `https://checkout.stripe.com/c/pay/${checkoutSessionId}`,
    metadata: {
      glucoscope_account_id: ACCOUNT_ID,
      glucoscope_product_code: "plus_30d",
      glucoscope_checkout_request_id: requestId,
    },
    ...overrides,
  });
}

function fakeStripeClient(session = validRetrievedSession()) {
  return {
    config: TEST_STRIPE_CONFIG,
    async retrieveCheckoutSession() {
      return structuredClone(session);
    },
    async retrieveRefund() {
      return {
        id: REFUND_ID,
        livemode: false,
        status: "succeeded",
        amount: 400,
        currency: "jpy",
        charge: CHARGE_ID,
        payment_intent: PAYMENT_INTENT_ID,
      };
    },
    async retrieveCharge() {
      return {
        id: CHARGE_ID,
        livemode: false,
        amount: 400,
        amount_refunded: 400,
        currency: "jpy",
        paid: true,
        status: "succeeded",
        payment_intent: PAYMENT_INTENT_ID,
      };
    },
    async findCheckoutByPaymentIntent() {
      return structuredClone(session);
    },
  };
}

function cryptoWithUuid(uuid = ENTITLEMENT_ID) {
  return {
    subtle: crypto.subtle,
    getRandomValues(array) {
      return crypto.getRandomValues(array);
    },
    randomUUID() {
      return uuid;
    },
  };
}

function stripeEvent({ id, type, objectId, created = NOW_SECONDS }) {
  return {
    id,
    object: "event",
    api_version: STRIPE_API_VERSION,
    created,
    livemode: false,
    account: null,
    type,
    data: { object: { id: objectId } },
  };
}

async function signRawBody(rawBody, timestamp = NOW_SECONDS) {
  const prefix = new TextEncoder().encode(`${timestamp}.`);
  const payload = new Uint8Array(prefix.byteLength + rawBody.byteLength);
  payload.set(prefix);
  payload.set(rawBody, prefix.byteLength);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, payload));
  const hex = Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}

async function webhookRequest(event, { origin = null, rawBody = null } = {}) {
  const body = rawBody || new TextEncoder().encode(JSON.stringify(event));
  const headers = new Headers({
    "Content-Type": "application/json",
    "Stripe-Signature": await signRawBody(body),
  });
  if (origin) headers.set("Origin", origin);
  return new Request(`${ALLOWED_ORIGIN}/v1/stripe/webhook`, {
    method: "POST",
    headers,
    body,
  });
}

function plusCheckoutRequest(requestId = REQUEST_ID) {
  return new Request(`${ALLOWED_ORIGIN}/v1/plus/checkout`, {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${SESSION_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId }),
  });
}

test("checked-in Stripe switches stay off with explicit production and staging modes", () => {
  const config = JSON.parse(readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  ));
  assert.equal(config.vars.PLUS_PURCHASES_ENABLED, "false");
  assert.equal(config.vars.PLUS_CHECKOUT_HTTP_ENABLED, "false");
  assert.equal(config.vars.PLUS_STRIPE_WEBHOOK_ENABLED, "false");
  assert.equal(config.vars.PLUS_SALES_READINESS_CONFIRMED, "false");
  assert.equal(config.vars.PLUS_TAX_TREATMENT_CONFIRMED, "false");
  assert.equal(config.vars.PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED, "false");
  assert.equal(
    config.vars.PLUS_COMMERCIAL_DISCLOSURE_PATH,
    "/pages/trust/commercial-transactions.html",
  );
  assert.equal(config.vars.PLUS_REFUND_POLICY_PATH, "/pages/trust/plus-terms.html");
  assert.equal(config.vars.PLUS_SUPPORT_PATH, "/pages/trust/plus-support.html");
  assert.equal(config.vars.PLUS_TERMS_VERSION, "2026-08-18");
  assert.equal(config.vars.PLUS_BUYER_CONFIRMATION_VERSION, "2026-08-18");
  assert.equal(config.vars.PLUS_FINAL_PRICE_DISPLAY, "total_400_confirmed");
  assert.equal(config.vars.PLUS_BUYER_POLICY, "adult_self_or_confirmed_guardian");
  assert.equal(config.vars.PLUS_TAX_TREATMENT_CONFIRMED, "false");
  assert.equal(config.vars.PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED, "false");
  assert.equal(config.vars.PLUS_SALES_READINESS_CONFIRMED, "false");
  assert.equal(config.vars.PLUS_ALLOWED_ORIGIN, "https://glucoscope.app");
  assert.equal(config.vars.STRIPE_MODE, "live");
  assert.equal(config.vars.STRIPE_PLUS_PRODUCT_ID, "prod_V6ASxKCkGvR0Cs");
  assert.equal(config.vars.STRIPE_PLUS_PRICE_ID, "price_1U5y7tQk6xCYKhx8v3S5tn8j");
  assert.equal(
    config.vars.PLUS_CHECKOUT_SUCCESS_PATH,
    "/?mode=user&checkout=success#settings",
  );
  assert.equal(
    config.vars.PLUS_CHECKOUT_CANCEL_PATH,
    "/?mode=user&checkout=cancelled#settings",
  );
  assert.equal(config.env.staging.vars.PLUS_ALLOWED_ORIGIN, "https://glucoscope.app");
  assert.equal(config.env.staging.vars.STRIPE_MODE, "test");
  assert.equal(config.env.staging.vars.PLUS_CHECKOUT_SUCCESS_PATH, "/?mode=user&checkout=success#settings");
  assert.equal(config.env.staging.vars.PLUS_CHECKOUT_CANCEL_PATH, "/?mode=user&checkout=cancelled#settings");
  assert.equal(config.env.staging.vars.PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED, "false");
  assert.equal(
    config.env.staging.vars.STRIPE_PLUS_PRODUCT_ID,
    "prod_V5SDrFKGSiwaql",
  );
  assert.equal(
    config.env.staging.vars.STRIPE_PLUS_PRICE_ID,
    "price_1U5HIhQk6xCYKhx8oHxg44Ep",
  );
  for (const forbidden of [
    "STRIPE_RESTRICTED_API_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) assert.equal(forbidden in config.vars, false);
});

test("Stripe-hosted Checkout is a test-mode one-time payment with dynamic methods", async () => {
  const capturedCalls = [];
  const client = createStripeTestClient(stripeConfigEnv(), {
    fetch: async (url, init) => {
      capturedCalls.push({ url, init, form: new URLSearchParams(init.body) });
      return Response.json({
        id: CHECKOUT_ID,
        livemode: false,
        mode: "payment",
        status: "open",
        payment_status: "unpaid",
        expires_at: NOW_SECONDS + 60 * 60,
        url: `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`,
      });
    },
    crypto: cryptoWithUuid(),
    now: () => NOW,
  });
  const result = await client.createPlusCheckout({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    successUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=success#settings`,
    cancelUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=cancelled#settings`,
  });
  await client.createPlusCheckout({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    successUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=success#settings`,
    cancelUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=cancelled#settings`,
  });

  assert.deepEqual(result, {
    checkoutUrl: `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
  });
  const captured = capturedCalls[0];
  assert.equal(capturedCalls.length, 2);
  assert.equal(capturedCalls[1].init.body, captured.init.body);
  assert.equal(
    capturedCalls[1].init.headers.get("idempotency-key"),
    captured.init.headers.get("idempotency-key"),
  );
  assert.equal(captured.url.href, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.redirect, "manual");
  assert.equal(captured.init.headers.get("authorization"), `Bearer ${API_KEY}`);
  assert.equal(captured.init.headers.get("stripe-version"), STRIPE_API_VERSION);
  assert.equal(captured.form.get("mode"), "payment");
  assert.equal(captured.form.get("locale"), "ja");
  assert.equal(captured.form.get("line_items[0][price]"), PRICE_ID);
  assert.equal(captured.form.get("line_items[0][quantity]"), "1");
  assert.equal(
    captured.form.get("payment_intent_data[description]"),
    "GlucoScope Plus 30日パス（30日間・1回払い・自動更新なし）",
  );
  assert.equal(captured.form.get("metadata[glucoscope_account_id]"), ACCOUNT_ID);
  assert.equal(captured.form.get("metadata[glucoscope_product_code]"), "plus_30d");
  assert.match(captured.form.get("integration_identifier"), /^glucoscope_plus_[a-z]{8}$/u);
  assert.equal(captured.form.has("payment_method_types"), false);
  assert.equal(captured.form.has("automatic_tax"), false);
  assert.equal(captured.form.has("subscription_data"), false);
  assert.equal(captured.form.has("invoice_creation[enabled]"), false);
  assert.equal(captured.form.has("payment_intent_data[receipt_email]"), false);
  assert.equal(captured.form.has("customer_email"), false);
  assert.equal(
    captured.init.headers.get("idempotency-key"),
    `glucoscope-plus:${ACCOUNT_ID}:${REQUEST_ID}`,
  );
});

test("Stripe redirects are rejected without following or retrying", async () => {
  for (const status of [302, 307]) {
    const calls = [];
    const client = createStripeTestClient(stripeConfigEnv(), {
      fetch: async (url, init) => {
        calls.push({ url, init });
        return new Response("provider redirect body must stay private", {
          status,
          headers: { Location: "https://redirect.invalid/collect" },
        });
      },
      now: () => NOW,
    });

    await assert.rejects(
      client.createPlusCheckout({
        accountId: ACCOUNT_ID,
        requestId: REQUEST_ID,
        successUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=success#settings`,
        cancelUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=cancelled#settings`,
      }),
      (error) => error instanceof StripeAdapterError
        && error.code === "stripe_api_rejected"
        && error.status === 502,
    );
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.href, "https://api.stripe.com/v1/checkout/sessions");
    assert.equal(calls[0].init.redirect, "manual");
    assert.equal(
      calls[0].init.headers.get("authorization"),
      `Bearer ${API_KEY}`,
    );
  }
});

test("Checkout client rejects non-restricted or mode-mismatched keys before network access", async () => {
  let calls = 0;
  const invalidKeys = [
    ["sk", "test", "x".repeat(32)].join("_"),
    ["rk", "live", "x".repeat(32)].join("_"),
  ];
  for (const key of invalidKeys) {
    assert.throws(() => createStripeTestClient({
      ...stripeConfigEnv(),
      STRIPE_RESTRICTED_API_KEY: key,
    }, {
      fetch: async () => { calls += 1; },
    }), StripeAdapterError);
  }
  assert.equal(calls, 0);
});

test("live Checkout requires an explicit live mode and accepts only live Stripe facts", async () => {
  const liveSessionId = `cs_live_${"l".repeat(24)}`;
  const liveEnv = {
    STRIPE_MODE: "live",
    STRIPE_RESTRICTED_API_KEY: LIVE_API_KEY,
    STRIPE_PLUS_PRICE_ID: PRICE_ID,
    STRIPE_PLUS_PRODUCT_ID: PRODUCT_ID,
  };
  assert.equal(readStripeConfig(liveEnv).livemode, true);
  const client = createStripeClient(liveEnv, {
    fetch: async () => Response.json({
      id: liveSessionId,
      livemode: true,
      mode: "payment",
      status: "open",
      payment_status: "unpaid",
      expires_at: NOW_SECONDS + 60 * 60,
      url: `https://checkout.stripe.com/c/pay/${liveSessionId}`,
    }),
    now: () => NOW,
  });
  const result = await client.createPlusCheckout({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    successUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=success#settings`,
    cancelUrl: `${ALLOWED_ORIGIN}/?mode=user&checkout=cancelled#settings`,
  });
  assert.equal(result.checkoutSessionId, liveSessionId);
  assert.throws(() => readStripeConfig({
    ...liveEnv,
    STRIPE_MODE: "test",
  }), (error) => error instanceof StripeAdapterError
    && error.code === "stripe_mode_mismatch");
});

test("re-fetched Checkout facts reject a mode mismatch, wrong price, product, or account mapping", () => {
  const config = TEST_STRIPE_CONFIG;
  assert.equal(validateRetrievedPlusCheckout(validRetrievedSession(), config).status, "paid");
  const invalidSessions = [
    validRetrievedSession({ livemode: true }),
    validRetrievedSession({ payment_status: "no_payment_required" }),
    validRetrievedSession({
      line_items: {
        has_more: false,
        data: [{
          quantity: 1,
          amount_total: 400,
          price: {
            id: `price_${"z".repeat(24)}`,
            currency: "jpy",
            unit_amount: 400,
            recurring: null,
            product: { id: PRODUCT_ID },
          },
        }],
      },
    }),
    validRetrievedSession({
      line_items: {
        has_more: false,
        data: [{
          quantity: 1,
          amount_total: 400,
          price: {
            id: PRICE_ID,
            currency: "jpy",
            unit_amount: 400,
            recurring: null,
            product: { id: `prod_${"z".repeat(24)}` },
          },
        }],
      },
    }),
    validRetrievedSession({
      metadata: {
        glucoscope_account_id: "22222222-2222-4222-8222-222222222222",
        glucoscope_product_code: "plus_30d",
        glucoscope_checkout_request_id: REQUEST_ID,
      },
    }),
  ];
  for (const session of invalidSessions) {
    assert.throws(
      () => validateRetrievedPlusCheckout(session, config),
      StripeAdapterError,
    );
  }
});

test("raw webhook verification rejects changed bytes and stale timestamps", async () => {
  const raw = new TextEncoder().encode('{"safe":true}');
  const signatureHeader = await signRawBody(raw);
  assert.equal(await verifyStripeWebhookSignature({
    rawBody: raw,
    signatureHeader,
    secret: WEBHOOK_SECRET,
    now: NOW,
  }), true);
  assert.equal(await verifyStripeWebhookSignature({
    rawBody: new TextEncoder().encode('{ "safe":true}'),
    signatureHeader,
    secret: WEBHOOK_SECRET,
    now: NOW,
  }), false);
  assert.equal(await verifyStripeWebhookSignature({
    rawBody: raw,
    signatureHeader,
    secret: WEBHOOK_SECRET,
    now: NOW + 6 * 60 * 1000,
  }), false);
});

test("webhook event parsing requires the configured live or test mode", () => {
  const testEvent = stripeEvent({
    id: "evt_testmode123456",
    type: "checkout.session.completed",
    objectId: CHECKOUT_ID,
  });
  const liveEvent = { ...testEvent, id: "evt_livemode12345", livemode: true };
  const bytes = (event) => new TextEncoder().encode(JSON.stringify(event));
  assert.equal(parseStripeWebhookEvent(bytes(testEvent), false).livemode, false);
  assert.equal(parseStripeWebhookEvent(bytes(liveEvent), true).livemode, true);
  assert.throws(
    () => parseStripeWebhookEvent(bytes(liveEvent), false),
    (error) => error instanceof StripeAdapterError
      && error.code === "invalid_webhook_event",
  );
  assert.throws(
    () => parseStripeWebhookEvent(bytes(testEvent), true),
    (error) => error instanceof StripeAdapterError
      && error.code === "invalid_webhook_event",
  );
});

test("disabled routes fail before authentication, body parsing, Stripe, or D1", async () => {
  let touches = 0;
  const dependencies = {
    entitlementService: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
    stripeClient: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
    store: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
  };
  for (const path of ["/v1/plus/checkout", "/v1/stripe/webhook"] ) {
    const response = await handleStripeHttpRequest(new Request(`${ALLOWED_ORIGIN}${path}`, {
      method: "POST",
      body: "not-json",
    }), {}, dependencies);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  assert.equal(touches, 0);
});

test("Checkout stays fail-closed when sale notices are not confirmed", async () => {
  let touches = 0;
  const dependencies = {
    entitlementService: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
    stripeClient: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
    store: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
  };
  const env = {
    ...enabledHttpEnv(),
    PLUS_SALES_READINESS_CONFIRMED: "false",
  };
  const response = await handleStripeHttpRequest(
    plusCheckoutRequest(),
    env,
    dependencies,
  );
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "sales_not_ready" });
  assert.equal(touches, 0);
});

test("Checkout refuses an account without the current adult or guardian confirmation", async () => {
  let downstreamTouches = 0;
  const response = await handleStripeHttpRequest(
    plusCheckoutRequest(),
    enabledHttpEnv(),
    {
      entitlementService: {
        async resolveCheckoutBuyer(token, version) {
          assert.equal(token, SESSION_TOKEN);
          assert.equal(version, "2026-08-15");
          return { status: "buyer_confirmation_required" };
        },
      },
      stripeClient: new Proxy({}, {
        get() { downstreamTouches += 1; throw new Error("must not touch Stripe"); },
      }),
      store: new Proxy({}, {
        get() { downstreamTouches += 1; throw new Error("must not reserve Checkout"); },
      }),
    },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "buyer_confirmation_required",
  });
  assert.equal(downstreamTouches, 0);
});

test("real Checkout rejects a stale confirmation version before Stripe", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store, {
    buyerConfirmationVersion: "2026-08-14",
  });
  let stripeTouches = 0;
  const response = await handleStripeHttpRequest(
    plusCheckoutRequest(),
    enabledHttpEnv(),
    {
      store,
      now: () => NOW + 1000,
      entitlementService: createPlusEntitlementService(enabledHttpEnv(), {
        store,
        now: () => NOW + 1000,
        hashSessionToken: async (token) => token === SESSION_TOKEN
          ? SESSION_TOKEN_HASH
          : "x".repeat(43),
      }),
      stripeClient: new Proxy({}, {
        get() {
          stripeTouches += 1;
          throw new Error("must not touch Stripe");
        },
      }),
    },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "buyer_confirmation_required",
  });
  assert.equal(stripeTouches, 0);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM checkout_attempts
  `).get().count), 0);
});

test("real guardian confirmation can open one Checkout", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store, { buyerRole: "guardian" });
  const checkoutUrl = `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`;
  let createCalls = 0;
  const response = await handleStripeHttpRequest(
    plusCheckoutRequest(),
    enabledHttpEnv(),
    {
      store,
      now: () => NOW + 1000,
      entitlementService: createPlusEntitlementService(enabledHttpEnv(), {
        store,
        now: () => NOW + 1000,
        hashSessionToken: async (token) => token === SESSION_TOKEN
          ? SESSION_TOKEN_HASH
          : "x".repeat(43),
      }),
      stripeClient: {
        config: TEST_STRIPE_CONFIG,
        async createPlusCheckout(input) {
          createCalls += 1;
          assert.equal(input.accountId, ACCOUNT_ID);
          return {
            checkoutUrl,
            checkoutSessionId: CHECKOUT_ID,
            expiresAt: NOW + 60 * 60 * 1000,
          };
        },
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checkoutUrl });
  assert.equal(createCalls, 1);
});

test("Checkout route enforces exact Origin, bounded JSON, authentication, and no-store CORS", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  let checkoutCalls = 0;
  const dependencies = {
    store,
    now: () => NOW + 1000,
    entitlementService: createPlusEntitlementService(enabledHttpEnv(), {
      store,
      now: () => NOW + 1000,
      hashSessionToken: async (token) => token === SESSION_TOKEN
        ? SESSION_TOKEN_HASH
        : "x".repeat(43),
    }),
    stripeClient: {
      async createPlusCheckout(input) {
        checkoutCalls += 1;
        assert.equal(input.accountId, ACCOUNT_ID);
        assert.equal(input.requestId, REQUEST_ID);
        assert.equal(
          input.successUrl,
          `${ALLOWED_ORIGIN}/?mode=user&checkout=success#settings`,
        );
        assert.equal(
          input.cancelUrl,
          `${ALLOWED_ORIGIN}/?mode=user&checkout=cancelled#settings`,
        );
        return {
          checkoutUrl: `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`,
          checkoutSessionId: CHECKOUT_ID,
          expiresAt: NOW + 60 * 60 * 1000,
        };
      },
    },
  };
  const env = enabledHttpEnv();
  const validRequest = () => new Request(`${ALLOWED_ORIGIN}/v1/plus/checkout`, {
    method: "POST",
    headers: {
      Origin: ALLOWED_ORIGIN,
      Authorization: `Bearer ${SESSION_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ requestId: REQUEST_ID }),
  });
  const response = await handleStripeHttpRequest(validRequest(), env, dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED_ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    ok: true,
    checkoutUrl: `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`,
  });
  assert.equal(checkoutCalls, 1);

  const disallowed = await handleStripeHttpRequest(new Request(
    `${ALLOWED_ORIGIN}/v1/plus/checkout`,
    {
      method: "POST",
      headers: {
        Origin: "https://attacker.invalid",
        Authorization: `Bearer ${SESSION_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId: REQUEST_ID }),
    },
  ), env, dependencies);
  assert.equal(disallowed.status, 403);
  assert.equal(disallowed.headers.get("access-control-allow-origin"), null);

  const oversized = await handleStripeHttpRequest(new Request(
    `${ALLOWED_ORIGIN}/v1/plus/checkout`,
    {
      method: "POST",
      headers: {
        Origin: ALLOWED_ORIGIN,
        Authorization: `Bearer ${SESSION_TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": "2048",
      },
      body: JSON.stringify({ requestId: REQUEST_ID }),
    },
  ), env, dependencies);
  assert.equal(oversized.status, 413);
  assert.equal(checkoutCalls, 1);

  const badReturnPath = await handleStripeHttpRequest(
    validRequest(),
    { ...env, PLUS_CHECKOUT_SUCCESS_PATH: "/" },
    dependencies,
  );
  assert.equal(badReturnPath.status, 503);
  assert.equal(checkoutCalls, 1);
});

test("D1 serializes per-account Checkout reservations and replaces only Stripe-confirmed expiry", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);

  const [first, second] = await Promise.all([
    store.reserveCheckoutAttempt({
      accountId: ACCOUNT_ID,
      requestId: REQUEST_ID,
      reservedAt: NOW,
      reservationExpiresAt: NOW + 10 * 60 * 1000,
    }),
    store.reserveCheckoutAttempt({
      accountId: ACCOUNT_ID,
      requestId: SECOND_REQUEST_ID,
      reservedAt: NOW,
      reservationExpiresAt: NOW + 10 * 60 * 1000,
    }),
  ]);
  assert.deepEqual(
    [first.status, second.status].sort(),
    ["checkout_in_progress", "reserved"],
  );
  const winningRequestId = first.status === "reserved"
    ? REQUEST_ID
    : SECOND_REQUEST_ID;
  const laterRequestId = winningRequestId === REQUEST_ID
    ? SECOND_REQUEST_ID
    : REQUEST_ID;

  assert.equal((await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: winningRequestId,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  })).status, "open");
  const reused = await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: laterRequestId,
    reservedAt: NOW + 2,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  assert.deepEqual(reused, {
    status: "existing",
    checkoutSessionId: CHECKOUT_ID,
    requestId: winningRequestId,
    expiresAt: NOW + 60 * 60 * 1000,
  });

  const locallyElapsed = await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: laterRequestId,
    reservedAt: NOW + 60 * 60 * 1000,
    reservationExpiresAt: NOW + 70 * 60 * 1000,
  });
  assert.equal(locallyElapsed.status, "existing");
  assert.equal(locallyElapsed.checkoutSessionId, CHECKOUT_ID);
  assert.equal((await store.expireCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: winningRequestId,
    checkoutSessionId: CHECKOUT_ID,
    now: NOW + 60 * 60 * 1000,
  })).expired, true);
  const replacement = await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: laterRequestId,
    reservedAt: NOW + 60 * 60 * 1000,
    reservationExpiresAt: NOW + 70 * 60 * 1000,
  });
  assert.equal(replacement.status, "reserved");
  assert.equal(replacement.requestId, laterRequestId);
});

test("parallel Checkout clicks create at most one Session and later reuse its URL", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  let createCalls = 0;
  let releaseCreate;
  let signalStarted;
  const started = new Promise((resolve) => { signalStarted = resolve; });
  const pendingCreate = new Promise((resolve) => { releaseCreate = resolve; });
  const checkoutUrl = `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`;
  const stripeClient = {
    config: TEST_STRIPE_CONFIG,
    async createPlusCheckout() {
      createCalls += 1;
      signalStarted();
      await pendingCreate;
      return {
        checkoutUrl,
        checkoutSessionId: CHECKOUT_ID,
        expiresAt: NOW + 60 * 60 * 1000,
      };
    },
    async retrieveCheckoutSession() {
      return validOpenSession();
    },
  };
  const dependencies = {
    store,
    stripeClient,
    now: () => NOW + 1000,
    entitlementService: {
      async resolveCheckoutBuyer() {
        return { status: "ok", subjectId: ACCOUNT_ID, plusActive: false };
      },
    },
  };

  const firstResponsePromise = handleStripeHttpRequest(
    plusCheckoutRequest(REQUEST_ID),
    enabledHttpEnv(),
    dependencies,
  );
  await started;
  const competingResponse = await handleStripeHttpRequest(
    plusCheckoutRequest(SECOND_REQUEST_ID),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(competingResponse.status, 409);
  assert.deepEqual(await competingResponse.json(), {
    ok: false,
    error: "checkout_creation_in_progress",
  });
  releaseCreate();
  const firstResponse = await firstResponsePromise;
  assert.equal(firstResponse.status, 200);
  assert.deepEqual(await firstResponse.json(), { ok: true, checkoutUrl });

  const reusedResponse = await handleStripeHttpRequest(
    plusCheckoutRequest(SECOND_REQUEST_ID),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(reusedResponse.status, 200);
  assert.deepEqual(await reusedResponse.json(), { ok: true, checkoutUrl });
  assert.equal(createCalls, 1);
});

test("a Stripe-confirmed expired Checkout is replaced once with the new request", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });

  let createCalls = 0;
  let retrieveCalls = 0;
  const checkoutUrl = `https://checkout.stripe.com/c/pay/${SECOND_CHECKOUT_ID}`;
  const dependencies = {
    store,
    now: () => NOW + 1000,
    entitlementService: {
      async resolveCheckoutBuyer() {
        return { status: "ok", subjectId: ACCOUNT_ID, plusActive: false };
      },
    },
    stripeClient: {
      config: TEST_STRIPE_CONFIG,
      async retrieveCheckoutSession() {
        retrieveCalls += 1;
        return validOpenSession({ overrides: { status: "expired" } });
      },
      async createPlusCheckout(input) {
        createCalls += 1;
        assert.equal(input.requestId, SECOND_REQUEST_ID);
        return {
          checkoutUrl,
          checkoutSessionId: SECOND_CHECKOUT_ID,
          expiresAt: NOW + 2 * 60 * 60 * 1000,
        };
      },
    },
  };
  const response = await handleStripeHttpRequest(
    plusCheckoutRequest(SECOND_REQUEST_ID),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checkoutUrl });
  assert.equal(retrieveCalls, 1);
  assert.equal(createCalls, 1);
  assert.deepEqual({ ...database.raw.prepare(`
    SELECT request_id, state, checkout_session_id FROM checkout_attempts
  `).get() }, {
    request_id: SECOND_REQUEST_ID,
    state: "open",
    checkout_session_id: SECOND_CHECKOUT_ID,
  });
});

test("a completed Checkout stays blocked while payment confirmation is pending", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });
  let createCalls = 0;
  const pendingSession = validRetrievedSession({
    expires_at: NOW_SECONDS + 60 * 60,
    url: `https://checkout.stripe.com/c/pay/${CHECKOUT_ID}`,
  });
  assert.equal(validateReusablePlusCheckout(
    pendingSession,
    TEST_STRIPE_CONFIG,
    { accountId: ACCOUNT_ID, requestId: REQUEST_ID, now: NOW + 2 * 60 * 60 * 1000 },
  ).status, "confirmation_pending");
  assert.equal(validateReusablePlusCheckout(
    validOpenSession({ expiresAt: NOW + 60 * 60 * 1000 }),
    TEST_STRIPE_CONFIG,
    { accountId: ACCOUNT_ID, requestId: REQUEST_ID, now: NOW + 2 * 60 * 60 * 1000 },
  ).status, "confirmation_pending");
  const response = await handleStripeHttpRequest(
    plusCheckoutRequest(SECOND_REQUEST_ID),
    enabledHttpEnv(),
    {
      store,
      now: () => NOW + 2 * 60 * 60 * 1000,
      entitlementService: {
        async resolveCheckoutBuyer() {
          return { status: "ok", subjectId: ACCOUNT_ID, plusActive: false };
        },
      },
      stripeClient: {
        config: TEST_STRIPE_CONFIG,
        async retrieveCheckoutSession() { return pendingSession; },
        async createPlusCheckout() { createCalls += 1; },
      },
    },
  );
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "checkout_confirmation_pending",
  });
  assert.equal(createCalls, 0);
});

test("signed async payment failure atomically releases only its exact open attempt", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });
  const unpaidSession = validRetrievedSession({ payment_status: "unpaid" });
  const dependencies = {
    store,
    stripeClient: fakeStripeClient(unpaidSession),
    now: () => NOW + 1000,
    crypto: cryptoWithUuid(),
  };
  const failedEvent = stripeEvent({
    id: "evt_asyncfail12345",
    type: "checkout.session.async_payment_failed",
    objectId: CHECKOUT_ID,
  });
  const response = await handleStripeHttpRequest(
    await webhookRequest(failedEvent),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "failed",
  );
  assert.equal(
    database.raw.prepare(`
      SELECT outcome FROM processed_checkout_failure_events
    `).get().outcome,
    "failed",
  );

  const duplicate = await handleStripeHttpRequest(
    await webhookRequest(failedEvent),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(duplicate.status, 200);
  const secondNotification = stripeEvent({
    id: "evt_asyncfail67890",
    type: "checkout.session.async_payment_failed",
    objectId: CHECKOUT_ID,
    created: NOW_SECONDS + 1,
  });
  const secondResponse = await handleStripeHttpRequest(
    await webhookRequest(secondNotification),
    enabledHttpEnv(),
    { ...dependencies, now: () => NOW + 2000 },
  );
  assert.equal(secondResponse.status, 200);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM processed_checkout_failure_events
  `).get().count), 1);

  const retry = await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: SECOND_REQUEST_ID,
    reservedAt: NOW + 3000,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  assert.equal(retry.status, "reserved");
  assert.equal(retry.requestId, SECOND_REQUEST_ID);
});

test("async failure with mismatched Checkout metadata stays pending and never releases the attempt", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });
  const mismatchedSession = validRetrievedSession({
    payment_status: "unpaid",
    metadata: {
      glucoscope_account_id: ACCOUNT_ID,
      glucoscope_product_code: "plus_30d",
      glucoscope_checkout_request_id: SECOND_REQUEST_ID,
    },
  });
  const failedEvent = stripeEvent({
    id: "evt_mismatchfail12",
    type: "checkout.session.async_payment_failed",
    objectId: CHECKOUT_ID,
  });
  const response = await handleStripeHttpRequest(
    await webhookRequest(failedEvent),
    enabledHttpEnv(),
    {
      store,
      stripeClient: fakeStripeClient(mismatchedSession),
      now: () => NOW + 1000,
      crypto: cryptoWithUuid(),
    },
  );
  assert.equal(response.status, 503);
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "open",
  );
  assert.equal(
    database.raw.prepare(`
      SELECT outcome FROM processed_checkout_failure_events
    `).get().outcome,
    "not_found",
  );
});

test("signed Checkout expiry releases the exact open attempt idempotently", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });
  const expiredSession = validOpenSession({
    overrides: { status: "expired" },
  });
  const dependencies = {
    store,
    stripeClient: fakeStripeClient(expiredSession),
    now: () => NOW + 1000,
    crypto: cryptoWithUuid(),
  };
  const expiredEvent = stripeEvent({
    id: "evt_expired123456",
    type: "checkout.session.expired",
    objectId: CHECKOUT_ID,
  });
  const response = await handleStripeHttpRequest(
    await webhookRequest(expiredEvent),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(response.status, 200);
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "expired",
  );
  assert.equal(
    database.raw.prepare(`
      SELECT outcome FROM processed_checkout_expiry_events
    `).get().outcome,
    "expired",
  );
  const duplicate = await handleStripeHttpRequest(
    await webhookRequest(expiredEvent),
    enabledHttpEnv(),
    dependencies,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM processed_checkout_expiry_events
  `).get().count), 1);

  const retry = await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: SECOND_REQUEST_ID,
    reservedAt: NOW + 2000,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  assert.equal(retry.status, "reserved");
  assert.equal(retry.requestId, SECOND_REQUEST_ID);
});

test("signed paid webhooks grant once; refund and charge.refunded stop the entitlement idempotently", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  const env = enabledHttpEnv();
  const dependencies = {
    store,
    stripeClient: fakeStripeClient(),
    now: () => NOW + 1000,
    crypto: cryptoWithUuid(),
  };
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });

  const paidEvent = stripeEvent({
    id: "evt_grant12345678",
    type: "checkout.session.completed",
    objectId: CHECKOUT_ID,
  });
  const paidResponse = await handleStripeHttpRequest(
    await webhookRequest(paidEvent, { origin: "https://attacker.invalid" }),
    env,
    dependencies,
  );
  assert.equal(paidResponse.status, 200);
  assert.equal(paidResponse.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await paidResponse.json(), { received: true });

  const duplicateResponse = await handleStripeHttpRequest(
    await webhookRequest(paidEvent),
    env,
    dependencies,
  );
  assert.equal(duplicateResponse.status, 200);
  const asyncSucceeded = stripeEvent({
    id: "evt_async123456789",
    type: "checkout.session.async_payment_succeeded",
    objectId: CHECKOUT_ID,
    created: NOW_SECONDS + 1,
  });
  const asyncResponse = await handleStripeHttpRequest(
    await webhookRequest(asyncSucceeded),
    env,
    { ...dependencies, now: () => NOW + 2000 },
  );
  assert.equal(asyncResponse.status, 200);
  const granted = database.raw.prepare(`
    SELECT status, starts_at, ends_at FROM entitlements
  `).get();
  assert.deepEqual({
    status: granted.status,
    duration: Number(granted.ends_at) - Number(granted.starts_at),
  }, {
    status: "granted",
    duration: 30 * 24 * 60 * 60 * 1000,
  });
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "completed",
  );
  const lateFailureEvent = stripeEvent({
    id: "evt_latefail123456",
    type: "checkout.session.async_payment_failed",
    objectId: CHECKOUT_ID,
    created: NOW_SECONDS + 2,
  });
  const lateFailureResponse = await handleStripeHttpRequest(
    await webhookRequest(lateFailureEvent),
    env,
    {
      ...dependencies,
      stripeClient: fakeStripeClient(validRetrievedSession({
        payment_status: "unpaid",
      })),
      now: () => NOW + 3000,
    },
  );
  assert.equal(lateFailureResponse.status, 200);
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "completed",
  );
  assert.equal(
    database.raw.prepare(`
      SELECT outcome FROM processed_checkout_failure_events
    `).get().outcome,
    "final_state_preserved",
  );
  assert.deepEqual(await createPlusEntitlementService({
    PLUS_ENTITLEMENT_RPC_ENABLED: "true",
  }, {
    store,
    now: () => NOW + 2000,
    hashSessionToken: async () => SESSION_TOKEN_HASH,
  }).getActivePlusSummary(SESSION_TOKEN).then((summary) => summary.active), true);

  const refundEvent = stripeEvent({
    id: "evt_refund12345678",
    type: "refund.created",
    objectId: REFUND_ID,
    created: NOW_SECONDS + 2,
  });
  const refundResponse = await handleStripeHttpRequest(
    await webhookRequest(refundEvent),
    env,
    { ...dependencies, now: () => NOW + 3000 },
  );
  assert.equal(refundResponse.status, 200);
  assert.equal(
    database.raw.prepare("SELECT status FROM entitlements").get().status,
    "refunded",
  );
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "refunded",
  );
  const failureAfterRefund = stripeEvent({
    id: "evt_refundfail1234",
    type: "checkout.session.async_payment_failed",
    objectId: CHECKOUT_ID,
    created: NOW_SECONDS + 3,
  });
  const failureAfterRefundResponse = await handleStripeHttpRequest(
    await webhookRequest(failureAfterRefund),
    env,
    {
      ...dependencies,
      stripeClient: fakeStripeClient(validRetrievedSession({
        payment_status: "unpaid",
      })),
      now: () => NOW + 4000,
    },
  );
  assert.equal(failureAfterRefundResponse.status, 200);
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "refunded",
  );
  const inactive = await createPlusEntitlementService({
    PLUS_ENTITLEMENT_RPC_ENABLED: "true",
  }, {
    store,
    now: () => NOW + 4000,
    hashSessionToken: async () => SESSION_TOKEN_HASH,
  }).getActivePlusSummary(SESSION_TOKEN);
  assert.equal(inactive.active, false);

  const duplicateRefund = await handleStripeHttpRequest(
    await webhookRequest(refundEvent),
    env,
    { ...dependencies, now: () => NOW + 5000 },
  );
  assert.equal(duplicateRefund.status, 200);

  const chargeRefundedEvent = stripeEvent({
    id: "evt_charge12345678",
    type: "charge.refunded",
    objectId: CHARGE_ID,
    created: NOW_SECONDS + 4,
  });
  const chargeRefundedResponse = await handleStripeHttpRequest(
    await webhookRequest(chargeRefundedEvent),
    env,
    { ...dependencies, now: () => NOW + 5000 },
  );
  assert.equal(chargeRefundedResponse.status, 200);
  const counts = database.raw.prepare(`
    SELECT
      (SELECT COUNT(*) FROM entitlements) AS entitlements,
      (SELECT COUNT(*) FROM processed_webhook_events) AS paid_events,
      (SELECT COUNT(*) FROM processed_refund_events) AS refund_events
  `).get();
  assert.deepEqual({
    entitlements: Number(counts.entitlements),
    paidEvents: Number(counts.paid_events),
    refundEvents: Number(counts.refund_events),
  }, { entitlements: 1, paidEvents: 1, refundEvents: 2 });
});

test("a verified refund delivered before payment success prevents a later grant", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);
  const env = enabledHttpEnv();
  const dependencies = {
    store,
    stripeClient: fakeStripeClient(),
    crypto: cryptoWithUuid(),
  };
  await store.reserveCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    reservedAt: NOW,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  await store.completeCheckoutAttempt({
    accountId: ACCOUNT_ID,
    requestId: REQUEST_ID,
    checkoutSessionId: CHECKOUT_ID,
    expiresAt: NOW + 60 * 60 * 1000,
    now: NOW + 1,
  });

  const refundEvent = stripeEvent({
    id: "evt_earlyrefund123",
    type: "refund.created",
    objectId: REFUND_ID,
    created: NOW_SECONDS + 1,
  });
  const refundResponse = await handleStripeHttpRequest(
    await webhookRequest(refundEvent),
    env,
    { ...dependencies, now: () => NOW + 2000 },
  );
  assert.equal(refundResponse.status, 200);
  assert.equal(
    database.raw.prepare("SELECT outcome FROM processed_refund_events").get().outcome,
    "not_found",
  );
  assert.equal(
    database.raw.prepare("SELECT state FROM checkout_attempts").get().state,
    "refunded",
  );

  const paidEvent = stripeEvent({
    id: "evt_lategrant12345",
    type: "checkout.session.async_payment_succeeded",
    objectId: CHECKOUT_ID,
    created: NOW_SECONDS,
  });
  const paidResponse = await handleStripeHttpRequest(
    await webhookRequest(paidEvent),
    env,
    { ...dependencies, now: () => NOW + 3000 },
  );
  assert.equal(paidResponse.status, 200);
  assert.equal(
    Number(database.raw.prepare("SELECT COUNT(*) AS count FROM entitlements").get().count),
    0,
  );
  assert.equal(
    database.raw.prepare("SELECT outcome FROM processed_webhook_events").get().outcome,
    "rejected_refunded",
  );
});

test("invalid webhook signature and oversized raw body fail before Stripe or D1", async () => {
  let touches = 0;
  const dependencies = {
    stripeClient: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
    store: new Proxy({}, { get() { touches += 1; throw new Error(); } }),
    now: () => NOW,
  };
  const event = stripeEvent({
    id: "evt_invalid1234567",
    type: "checkout.session.completed",
    objectId: CHECKOUT_ID,
  });
  const invalidSignature = await handleStripeHttpRequest(new Request(
    `${ALLOWED_ORIGIN}/v1/stripe/webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${NOW_SECONDS},v1=${"0".repeat(64)}`,
      },
      body: JSON.stringify(event),
    },
  ), enabledHttpEnv(), dependencies);
  assert.equal(invalidSignature.status, 400);

  const oversized = await handleStripeHttpRequest(new Request(
    `${ALLOWED_ORIGIN}/v1/stripe/webhook`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": `t=${NOW_SECONDS},v1=${"0".repeat(64)}`,
        "Content-Length": String(256 * 1024 + 1),
      },
      body: "{}",
    },
  ), enabledHttpEnv(), dependencies);
  assert.equal(oversized.status, 413);
  assert.equal(touches, 0);
});

test("Checkout/refund migration is narrow and contains no health, email, or card fields", () => {
  const migration = readFileSync(
    new URL("../migrations/0003_stripe_checkout_state.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE checkout_attempts/u);
  assert.match(migration, /account_id TEXT PRIMARY KEY/u);
  assert.match(migration, /CREATE TABLE processed_checkout_failure_events/u);
  assert.match(migration, /checkout\.session\.async_payment_failed/u);
  assert.match(migration, /CREATE TABLE processed_checkout_expiry_events/u);
  assert.match(migration, /checkout\.session\.expired/u);
  assert.match(migration, /CREATE TABLE processed_refund_events/u);
  assert.match(migration, /refund\.created/u);
  assert.match(migration, /charge\.refunded/u);
  assert.doesNotMatch(
    migration,
    /glucose|nightscout|gluroo|dexcom|libre|email|card_number|password|\btir\b|\bgmi\b/iu,
  );

  const liveIdMigration = readFileSync(
    new URL("../migrations/0008_live_stripe_checkout_ids.sql", import.meta.url),
    "utf8",
  );
  assert.match(liveIdMigration, /live_stripe_checkout_ids_migration_guard/u);
  assert.match(liveIdMigration, /CHECK \(row_count = 0\)/u);
  for (const table of [
    "checkout_attempts",
    "processed_checkout_failure_events",
    "processed_checkout_expiry_events",
    "processed_refund_events",
  ]) {
    assert.match(
      liveIdMigration,
      new RegExp(`COUNT\\(\\*\\) FROM ${table}`, "u"),
    );
  }
  assert.equal(
    (liveIdMigration.match(/IN \('cs_test_', 'cs_live_'\)/gu) || []).length,
    4,
  );
  assert.doesNotMatch(
    liveIdMigration,
    /glucose|nightscout|gluroo|dexcom|libre|email|card_number|password|\btir\b|\bgmi\b/iu,
  );
});

test("live Stripe Checkout IDs are accepted by every Checkout/refund state table", async () => {
  const database = createDatabase();
  const store = createD1PlusEntitlementStore(database);
  await createVerifiedAccount(store);

  const liveCheckoutIds = ["a", "b", "c", "d"].map(
    (marker) => `cs_live_${marker.repeat(24)}`,
  );
  database.raw.prepare(`
    INSERT INTO checkout_attempts (
      account_id, request_id, state, checkout_session_id,
      reserved_at, reservation_expires_at, checkout_expires_at, updated_at
    ) VALUES (?1, ?2, 'open', ?3, ?4, ?5, ?6, ?4)
  `).run(
    ACCOUNT_ID,
    REQUEST_ID,
    liveCheckoutIds[0],
    NOW,
    NOW + 60_000,
    NOW + 3_600_000,
  );
  database.raw.prepare(`
    INSERT INTO processed_checkout_failure_events (
      event_id, checkout_session_id, event_type, account_id, request_id,
      failed_at, received_at
    ) VALUES (
      'evt_livefailure0001', ?1, 'checkout.session.async_payment_failed',
      ?2, ?3, ?4, ?4
    )
  `).run(liveCheckoutIds[1], ACCOUNT_ID, SECOND_REQUEST_ID, NOW);
  database.raw.prepare(`
    INSERT INTO processed_checkout_expiry_events (
      event_id, checkout_session_id, event_type, account_id, request_id,
      expired_at, received_at
    ) VALUES (
      'evt_liveexpiry00001', ?1, 'checkout.session.expired',
      ?2, ?3, ?4, ?4
    )
  `).run(liveCheckoutIds[2], ACCOUNT_ID, SECOND_REQUEST_ID, NOW);
  database.raw.prepare(`
    INSERT INTO processed_refund_events (
      event_id, event_type, checkout_session_id, refund_id, charge_id,
      refunded_at, received_at
    ) VALUES (
      'evt_liverefunda0001', 'refund.created', ?1,
      're_liverefunda000000000000', 'ch_livechargea000000000000', ?2, ?2
    )
  `).run(liveCheckoutIds[3], NOW);

  const counts = database.raw.prepare(`
    SELECT
      (SELECT COUNT(*) FROM checkout_attempts) AS checkout_attempts,
      (SELECT COUNT(*) FROM processed_checkout_failure_events) AS failures,
      (SELECT COUNT(*) FROM processed_checkout_expiry_events) AS expiries,
      (SELECT COUNT(*) FROM processed_refund_events) AS refunds
  `).get();
  assert.deepEqual({ ...counts }, {
    checkout_attempts: 1,
    failures: 1,
    expiries: 1,
    refunds: 1,
  });
  database.close();
});
