import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCOUNT_CODE_EMAIL_SUBJECT,
  CloudflareEmailAdapterError,
  createCloudflareEmailAdapter,
} from "../src/cloudflare-email-adapter.js";

const FROM_ADDRESS = "no-reply@auth.example.com";
const DESTINATION_EMAIL = "Family@example.com";
const CODE = "123456";
const MESSAGE_ID = "email-message-123";

const MESSAGE_INPUT = Object.freeze({
  destinationEmail: DESTINATION_EMAIL,
  code: CODE,
  expiresInMinutes: 10,
  contactRole: "self",
  purpose: "sign_in_or_recover",
});

function assertAdapterError(expectedCode) {
  return (error) => {
    assert.ok(error instanceof CloudflareEmailAdapterError);
    assert.equal(error.code, expectedCode);
    assert.equal(error.message, expectedCode);
    return true;
  };
}

test("Cloudflare binding receives one fixed-subject bilingual verification email", async () => {
  const sent = [];
  const adapter = createCloudflareEmailAdapter({
    binding: {
      async send(message) {
        sent.push(message);
        return { messageId: MESSAGE_ID };
      },
    },
    fromAddress: FROM_ADDRESS,
  });

  const result = await adapter.sendAccountCode(MESSAGE_INPUT);

  assert.deepEqual(result, {
    accepted: true,
    provider: "cloudflare_email_service",
    messageId: MESSAGE_ID,
  });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, DESTINATION_EMAIL);
  assert.deepEqual(sent[0].from, {
    email: FROM_ADDRESS,
    name: "GlucoScope",
  });
  assert.equal(
    ACCOUNT_CODE_EMAIL_SUBJECT,
    "GlucoScopeの確認コード / Verification code",
  );
  assert.equal(sent[0].subject, ACCOUNT_CODE_EMAIL_SUBJECT);
  for (const body of [sent[0].text, sent[0].html]) {
    assert.match(body, /GlucoScopeの確認コード/u);
    assert.match(body, /GlucoScope verification code/u);
    assert.match(body, new RegExp(CODE, "u"));
    assert.match(body, /10/u);
    assert.match(body, /コードを送ったGlucoScopeの画面へ戻って入力/u);
    assert.match(body, /Return to the GlucoScope screen where you requested the code/u);
    assert.doesNotMatch(body, new RegExp(DESTINATION_EMAIL, "u"));
  }
});

test("missing binding or configured sender fails closed before delivery", async () => {
  await assert.rejects(
    createCloudflareEmailAdapter({ fromAddress: FROM_ADDRESS })
      .sendAccountCode(MESSAGE_INPUT),
    assertAdapterError("email_binding_unavailable"),
  );
  await assert.rejects(
    createCloudflareEmailAdapter({
      binding: { send: "not-a-function" },
      fromAddress: FROM_ADDRESS,
    }).sendAccountCode(MESSAGE_INPUT),
    assertAdapterError("email_binding_unavailable"),
  );

  let deliveries = 0;
  const binding = {
    async send() {
      deliveries += 1;
      return { messageId: MESSAGE_ID };
    },
  };
  for (const fromAddress of [
    undefined,
    "",
    ` ${FROM_ADDRESS}`,
    "no-reply@AUTH.example.com",
  ]) {
    await assert.rejects(
      createCloudflareEmailAdapter({ binding, fromAddress })
        .sendAccountCode(MESSAGE_INPUT),
      assertAdapterError("email_sender_unavailable"),
    );
  }
  assert.equal(deliveries, 0);
});

test("malformed message input fails closed before delivery", async () => {
  let deliveries = 0;
  const adapter = createCloudflareEmailAdapter({
    binding: {
      async send() {
        deliveries += 1;
        return { messageId: MESSAGE_ID };
      },
    },
    fromAddress: FROM_ADDRESS,
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
  ];
  for (const [input, errorCode] of invalidInputs) {
    await assert.rejects(
      adapter.sendAccountCode(input),
      assertAdapterError(errorCode),
    );
  }
  assert.equal(deliveries, 0);
});

test("provider failures and malformed responses stay generic and fail closed", async () => {
  const providerSecret = `${DESTINATION_EMAIL}:${CODE}`;
  const throwing = createCloudflareEmailAdapter({
    binding: {
      async send() {
        throw new Error(providerSecret);
      },
    },
    fromAddress: FROM_ADDRESS,
  });
  await assert.rejects(
    throwing.sendAccountCode(MESSAGE_INPUT),
    (error) => {
      assertAdapterError("email_delivery_unavailable")(error);
      assert.doesNotMatch(String(error), new RegExp(CODE, "u"));
      assert.doesNotMatch(String(error), new RegExp(DESTINATION_EMAIL, "u"));
      return true;
    },
  );

  for (const response of [
    undefined,
    null,
    {},
    { messageId: 123 },
    { messageId: " message-id" },
    { messageId: "message\nid" },
    { messageId: "m".repeat(513) },
  ]) {
    const adapter = createCloudflareEmailAdapter({
      binding: { async send() { return response; } },
      fromAddress: FROM_ADDRESS,
    });
    await assert.rejects(
      adapter.sendAccountCode(MESSAGE_INPUT),
      assertAdapterError("email_response_invalid"),
    );
  }
});

test("adapter is injected but remains disconnected in checked-in configuration", () => {
  const adapterSource = readFileSync(
    new URL("../src/cloudflare-email-adapter.js", import.meta.url),
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
  assert.match(indexSource, /serviceDependencies:\s*\{/u);
  assert.match(indexSource, /emailAdapter:\s*createCloudflareEmailAdapter/u);
  assert.match(indexSource, /this\.env\.ACCOUNT_CODE_EMAIL/u);
  assert.match(indexSource, /this\.env\.ACCOUNT_EMAIL_FROM_ADDRESS/u);
  for (const flag of [
    "PLUS_ENTITLEMENT_RPC_ENABLED",
    "PLUS_PURCHASES_ENABLED",
    "PLUS_CHECKOUT_HTTP_ENABLED",
    "PLUS_STRIPE_WEBHOOK_ENABLED",
    "PLUS_ACCOUNT_AUTH_HTTP_ENABLED",
  ]) {
    assert.equal(wrangler.vars[flag], "false");
  }
  assert.equal("send_email" in wrangler, false);
  assert.equal("ACCOUNT_CODE_EMAIL" in wrangler.vars, false);
  assert.equal("ACCOUNT_EMAIL_FROM_ADDRESS" in wrangler.vars, false);
});
