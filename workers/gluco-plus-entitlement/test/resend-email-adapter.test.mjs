import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCOUNT_CODE_EMAIL_FROM,
  ACCOUNT_CODE_EMAIL_SUBJECT,
  ResendEmailAdapterError,
  createResendEmailAdapter,
} from "../src/resend-email-adapter.js";

const API_KEY = "re_local_test_key_1234567890";
const DESTINATION_EMAIL = "Family@example.com";
const CODE = "123456";
const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const MESSAGE_ID = "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794";

const ENV = Object.freeze({
  RESEND_API_KEY: API_KEY,
  RESEND_FROM_ADDRESS: ACCOUNT_CODE_EMAIL_FROM,
  RESEND_TIMEOUT_MS: "10000",
  RESEND_RESPONSE_LIMIT_BYTES: "4096",
});

const MESSAGE_INPUT = Object.freeze({
  destinationEmail: DESTINATION_EMAIL,
  code: CODE,
  expiresInMinutes: 10,
  contactRole: "self",
  purpose: "sign_in_or_recover",
  requestId: REQUEST_ID,
});

function jsonResponse(value, init = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json; charset=utf-8");
  }
  return new Response(JSON.stringify(value), { ...init, headers });
}

function assertAdapterError(expectedCode) {
  return (error) => {
    assert.ok(error instanceof ResendEmailAdapterError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, expectedCode);
    assert.doesNotMatch(String(error), new RegExp(CODE, "u"));
    assert.doesNotMatch(String(error), new RegExp(DESTINATION_EMAIL, "u"));
    assert.doesNotMatch(String(error), new RegExp(API_KEY, "u"));
    return true;
  };
}

test("Resend receives one bounded plain-text verification request", async () => {
  const requests = [];
  const adapter = createResendEmailAdapter(ENV, {
    async fetch(url, init) {
      requests.push({ url, init });
      return jsonResponse({ id: MESSAGE_ID });
    },
  });

  const result = await adapter.sendAccountCode(MESSAGE_INPUT);

  assert.deepEqual(result, {
    accepted: true,
    provider: "resend",
    messageId: MESSAGE_ID,
  });
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.method, "POST");
  assert.equal(init.redirect, "manual");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.signal.aborted, false);
  assert.equal(init.headers.get("Accept"), "application/json");
  assert.equal(init.headers.get("Authorization"), `Bearer ${API_KEY}`);
  assert.equal(init.headers.get("Content-Type"), "application/json;charset=UTF-8");
  assert.equal(
    init.headers.get("User-Agent"),
    "GlucoScope-Plus-Entitlement/0.1",
  );
  assert.equal(
    init.headers.get("Idempotency-Key"),
    `glucoscope-account-code:${REQUEST_ID}`,
  );
  assert.doesNotMatch(init.headers.get("Idempotency-Key"), /Family|123456/u);

  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["from", "subject", "text", "to"]);
  assert.deepEqual(body, {
    from: "GlucoScope <no-reply@auth.glucoscope.app>",
    to: [DESTINATION_EMAIL],
    subject: "GlucoScopeの確認コード / Verification code",
    text: body.text,
  });
  assert.equal(ACCOUNT_CODE_EMAIL_SUBJECT, body.subject);
  assert.match(body.text, /GlucoScopeの確認コード/u);
  assert.match(body.text, /GlucoScope verification code/u);
  assert.match(body.text, /確認コード: 123456/u);
  assert.match(body.text, /Verification code: 123456/u);
  assert.match(body.text, /このコードは10分で使えなくなります/u);
  assert.match(body.text, /This code expires in 10 minutes/u);
  assert.doesNotMatch(body.text, new RegExp(DESTINATION_EMAIL, "u"));
  assert.doesNotMatch(body.text, /blood|glucose|Nightscout|CGM|AIお手紙|表示名/iu);
  assert.equal("html" in body, false);
  assert.equal("tracking" in body, false);
});

test("missing or malformed Resend configuration fails closed before fetch", async () => {
  let fetches = 0;
  const fetchImpl = async () => {
    fetches += 1;
    return jsonResponse({ id: MESSAGE_ID });
  };
  const invalidEnvironments = [
    {},
    { ...ENV, RESEND_API_KEY: undefined },
    { ...ENV, RESEND_API_KEY: "plain-text-key" },
    { ...ENV, RESEND_API_KEY: ` ${API_KEY}` },
    { ...ENV, RESEND_FROM_ADDRESS: undefined },
    { ...ENV, RESEND_FROM_ADDRESS: "no-reply@auth.glucoscope.app" },
    { ...ENV, RESEND_TIMEOUT_MS: "99" },
    { ...ENV, RESEND_TIMEOUT_MS: "30001" },
    { ...ENV, RESEND_RESPONSE_LIMIT_BYTES: "127" },
    { ...ENV, RESEND_RESPONSE_LIMIT_BYTES: "16385" },
  ];
  for (const env of invalidEnvironments) {
    await assert.rejects(
      createResendEmailAdapter(env, { fetch: fetchImpl })
        .sendAccountCode(MESSAGE_INPUT),
      assertAdapterError("email_configuration_unavailable"),
    );
  }
  assert.equal(fetches, 0);
});

test("malformed message input fails closed before fetch", async () => {
  let fetches = 0;
  const adapter = createResendEmailAdapter(ENV, {
    async fetch() {
      fetches += 1;
      return jsonResponse({ id: MESSAGE_ID });
    },
  });
  const invalidInputs = [
    [{ ...MESSAGE_INPUT, destinationEmail: ` ${DESTINATION_EMAIL}` }, "email_destination_invalid"],
    [{ ...MESSAGE_INPUT, destinationEmail: "Family@EXAMPLE.com" }, "email_destination_invalid"],
    [{ ...MESSAGE_INPUT, code: "12345" }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, code: 123456 }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, expiresInMinutes: "10" }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, expiresInMinutes: 0 }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, expiresInMinutes: 61 }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, contactRole: "child" }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, purpose: "password_reset" }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, requestId: undefined }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, requestId: REQUEST_ID.toUpperCase() }, "email_message_invalid"],
    [{ ...MESSAGE_INPUT, requestId: "not-a-challenge-id" }, "email_message_invalid"],
  ];
  for (const [input, errorCode] of invalidInputs) {
    await assert.rejects(
      adapter.sendAccountCode(input),
      assertAdapterError(errorCode),
    );
  }
  assert.equal(fetches, 0);
});

test("provider rejection, redirect, and timeout remain generic", async () => {
  for (const status of [302, 307, 400, 401]) {
    let fetches = 0;
    const adapter = createResendEmailAdapter(ENV, {
      async fetch() {
        fetches += 1;
        return new Response(`${DESTINATION_EMAIL}:${CODE}:${API_KEY}`, { status });
      },
    });
    await assert.rejects(
      adapter.sendAccountCode(MESSAGE_INPUT),
      assertAdapterError("email_delivery_unavailable"),
    );
    assert.equal(fetches, 1);
  }

  let timeoutFetches = 0;
  const timeoutAdapter = createResendEmailAdapter({
    ...ENV,
    RESEND_TIMEOUT_MS: "100",
  }, {
    async fetch(url, init) {
      timeoutFetches += 1;
      assert.equal(url, "https://api.resend.com/emails");
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(init.signal.reason), {
          once: true,
        });
      });
    },
  });
  await assert.rejects(
    timeoutAdapter.sendAccountCode(MESSAGE_INPUT),
    assertAdapterError("email_delivery_unavailable"),
  );
  assert.equal(timeoutFetches, 2);
});

test("only transient failures retry once with the identical idempotent request", async () => {
  const retryableStatuses = [408, 409, 500, 503];
  for (const status of retryableStatuses) {
    const attempts = [];
    const adapter = createResendEmailAdapter(ENV, {
      async fetch(url, init) {
        attempts.push({
          url,
          body: init.body,
          idempotencyKey: init.headers.get("Idempotency-Key"),
        });
        return attempts.length === 1
          ? new Response("temporary", { status })
          : jsonResponse({ id: MESSAGE_ID });
      },
    });
    assert.equal((await adapter.sendAccountCode(MESSAGE_INPUT)).accepted, true);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
  }

  let transportAttempts = 0;
  const transportAdapter = createResendEmailAdapter(ENV, {
    async fetch() {
      transportAttempts += 1;
      if (transportAttempts === 1) throw new Error(`${API_KEY}:${CODE}`);
      return jsonResponse({ id: MESSAGE_ID });
    },
  });
  assert.equal((await transportAdapter.sendAccountCode(MESSAGE_INPUT)).accepted, true);
  assert.equal(transportAttempts, 2);

  let perSecondAttempts = 0;
  const perSecondAdapter = createResendEmailAdapter(ENV, {
    async fetch() {
      perSecondAttempts += 1;
      return perSecondAttempts === 1
        ? jsonResponse({ name: "rate_limit_exceeded" }, { status: 429 })
        : jsonResponse({ id: MESSAGE_ID });
    },
  });
  assert.equal((await perSecondAdapter.sendAccountCode(MESSAGE_INPUT)).accepted, true);
  assert.equal(perSecondAttempts, 2);

  for (const providerError of [
    { name: "daily_quota_exceeded" },
    { name: "monthly_quota_exceeded" },
    { name: "unknown_rate_limit" },
  ]) {
    let quotaAttempts = 0;
    const quotaAdapter = createResendEmailAdapter(ENV, {
      async fetch() {
        quotaAttempts += 1;
        return jsonResponse(providerError, { status: 429 });
      },
    });
    await assert.rejects(
      quotaAdapter.sendAccountCode(MESSAGE_INPUT),
      assertAdapterError("email_delivery_unavailable"),
    );
    assert.equal(quotaAttempts, 1);
  }
});

test("malformed, oversized, or unexpected success responses fail closed", async () => {
  const malformedResponses = [
    new Response(JSON.stringify({ id: MESSAGE_ID }), { status: 200 }),
    new Response("not-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    jsonResponse({}),
    jsonResponse({ id: 123 }),
    jsonResponse({ id: "49A3999C-0CE1-4EA6-AB68-AFCD6DC2E794" }),
    jsonResponse({ id: "not-a-resend-id" }),
    new Response(JSON.stringify({ id: MESSAGE_ID }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    }),
    new Response("x".repeat(4097), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  ];
  for (const response of malformedResponses) {
    const adapter = createResendEmailAdapter(ENV, {
      async fetch() {
        return response;
      },
    });
    await assert.rejects(
      adapter.sendAccountCode(MESSAGE_INPUT),
      assertAdapterError("email_response_invalid"),
    );
  }
});

test("Resend adapter is injected but secret and all release flags remain off", () => {
  const adapterSource = readFileSync(
    new URL("../src/resend-email-adapter.js", import.meta.url),
    "utf8",
  );
  const indexSource = readFileSync(
    new URL("../src/index.js", import.meta.url),
    "utf8",
  );
  const wranglerSource = readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  );
  const wrangler = JSON.parse(wranglerSource);

  assert.doesNotMatch(adapterSource, /console\s*\.|\.prepare\s*\(|PLUS_DB/u);
  assert.doesNotMatch(adapterSource, /html\s*:/u);
  assert.match(adapterSource, /https:\/\/api\.resend\.com\/emails/u);
  assert.match(indexSource, /serviceDependencies:\s*\{/u);
  assert.match(indexSource, /emailAdapter:\s*createResendEmailAdapter\(this\.env\)/u);
  assert.doesNotMatch(indexSource, /ACCOUNT_CODE_EMAIL|createCloudflareEmailAdapter/u);
  for (const flag of [
    "PLUS_ENTITLEMENT_RPC_ENABLED",
    "PLUS_PURCHASES_ENABLED",
    "PLUS_CHECKOUT_HTTP_ENABLED",
    "PLUS_STRIPE_WEBHOOK_ENABLED",
    "PLUS_ACCOUNT_AUTH_HTTP_ENABLED",
  ]) {
    assert.equal(wrangler.vars[flag], "false");
  }
  assert.equal(wrangler.vars.RESEND_FROM_ADDRESS, ACCOUNT_CODE_EMAIL_FROM);
  assert.equal(wrangler.vars.RESEND_TIMEOUT_MS, "10000");
  assert.equal(wrangler.vars.RESEND_RESPONSE_LIMIT_BYTES, "4096");
  assert.equal(wrangler.vars.ACCOUNT_AUTH_GLOBAL_MAX_SENDS_PER_24_HOURS, "80");
  assert.equal("RESEND_API_KEY" in wrangler.vars, false);
  assert.equal("send_email" in wrangler, false);
  assert.equal("ACCOUNT_CODE_EMAIL" in wrangler.vars, false);
  assert.equal("ACCOUNT_EMAIL_FROM_ADDRESS" in wrangler.vars, false);
});
