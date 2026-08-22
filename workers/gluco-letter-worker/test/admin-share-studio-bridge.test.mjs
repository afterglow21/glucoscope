import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_SHARE_STUDIO_PAGE_MODE,
  DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN,
  adminShareStudioBridgeTesting,
  buildAdminShareStudioCounterConfig,
  isAdminShareStudioTurnstileReady,
  readAdminShareStudioBridgeConfig,
  verifyAdminShareStudioBridgeRequest,
} from "../src/admin-share-studio-bridge.js";
import { invokeAtomicUsageCounter } from "../src/usage-counter-client.js";

const SECRET = "admin-bridge-test-secret-with-at-least-32-bytes";
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";
const NOW_SECONDS = 1_787_336_400;

function payload(overrides = {}) {
  return {
    summary: {
      version: "gluco-ai-letter-summary-v0.1",
      pageMode: ADMIN_SHARE_STUDIO_PAGE_MODE,
      metrics: { tir: 90 },
      ...overrides.summary,
    },
    analysisMode: "letter",
    turnstileToken: "turnstile-test-token",
    requestId: REQUEST_ID,
    client: { app: "GlucoScope", mode: "share-studio-admin-v2.2" },
    ...overrides,
  };
}

async function signedRequest({ body = payload(), origin = DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN, timestamp = NOW_SECONDS } = {}) {
  const text = JSON.stringify(body);
  const bodySha256 = await adminShareStudioBridgeTesting.sha256Hex(text);
  const message = adminShareStudioBridgeTesting.buildSigningMessage({
    timestamp,
    requestId: REQUEST_ID,
    method: "POST",
    path: "/api/gluco-letter",
    origin,
    bodySha256,
  });
  const signature = await adminShareStudioBridgeTesting.signHex(SECRET, message);
  return new Request("https://gluco-letter-worker.example/api/gluco-letter", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Origin": origin,
      "X-Gluco-Admin-Bridge-Version": "v1",
      "X-Gluco-Admin-Bridge-Timestamp": String(timestamp),
      "X-Gluco-Admin-Bridge-Request-Id": REQUEST_ID,
      "X-Gluco-Admin-Bridge-Signature": signature,
    },
    body: text,
  });
}

function enabledEnv() {
  return {
    ADMIN_SHARE_STUDIO_BRIDGE_ENABLED: "true",
    ADMIN_SHARE_STUDIO_BRIDGE_SECRET: SECRET,
  };
}

test("admin bridge is checked in disabled and requires a 32-byte secret", async () => {
  const defaults = readAdminShareStudioBridgeConfig({});
  assert.equal(defaults.enabled, false);
  assert.equal(defaults.secretReady, false);
  assert.equal(defaults.origin, DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN);
  assert.equal(defaults.dailyLimit, 5);

  const wrangler = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(wrangler, /ADMIN_SHARE_STUDIO_BRIDGE_ENABLED = "false"/u);
  assert.match(wrangler, /ADMIN_SHARE_STUDIO_DAILY_LIMIT = "5"/u);
  assert.doesNotMatch(wrangler, /ADMIN_SHARE_STUDIO_BRIDGE_SECRET\s*=/u);

  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(packageJson.scripts.deploy, /Bare production deploy is disabled/u);
  assert.doesNotMatch(packageJson.scripts.deploy, /wrangler\s+deploy/u);
  assert.match(packageJson.scripts["deploy:live:dry"], /--config \.wrangler\/live-production\.wrangler\.toml --keep-vars/u);

  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /checked-in `wrangler\.toml` is a fail-safe development baseline/u);
  assert.match(readme, /Never run bare[\s\S]*`npm run deploy`/u);
});

test("a fresh exact-origin HMAC request is verified without exposing a browser CORS origin", async () => {
  const request = await signedRequest();
  const result = await verifyAdminShareStudioBridgeRequest(request, enabledEnv(), NOW_SECONDS * 1000);
  assert.equal(result.ok, true);
  assert.equal(result.origin, DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN);
  assert.equal(result.requestId, REQUEST_ID);
  assert.equal(result.turnstileIdentity.hostname, "glucoscope-share-studio.pages.dev");
  assert.equal(result.turnstileIdentity.action, "glucoscope-ai-letter");

  const indexSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(indexSource, /reason: "server_authenticated_admin_bridge"/u);
  assert.match(indexSource, /expectedIdentity: adminBridgeVerified \? adminBridge\.turnstileIdentity : null/u);
  assert.doesNotMatch(indexSource, /Access-Control-Allow-Origin[\s\S]{0,80}["']\*["']/u);
});

test("tampering, stale signatures, wrong origins, and unsigned requests fail closed", async () => {
  const unsigned = new Request("https://worker.example/api/gluco-letter", {
    method: "POST",
    headers: { Origin: DEFAULT_ADMIN_SHARE_STUDIO_ORIGIN },
    body: JSON.stringify(payload()),
  });
  assert.equal((await verifyAdminShareStudioBridgeRequest(unsigned, enabledEnv(), NOW_SECONDS * 1000)).attempted, false);

  const stale = await signedRequest({ timestamp: NOW_SECONDS - 91 });
  assert.equal((await verifyAdminShareStudioBridgeRequest(stale, enabledEnv(), NOW_SECONDS * 1000)).error, "signature_expired");

  const wrongOrigin = await signedRequest({ origin: "https://example.invalid" });
  assert.equal((await verifyAdminShareStudioBridgeRequest(wrongOrigin, enabledEnv(), NOW_SECONDS * 1000)).error, "invalid_origin");

  const original = await signedRequest();
  const tamperedPayload = payload();
  tamperedPayload.summary.metrics.tir = 1;
  const tamperedBody = JSON.stringify(tamperedPayload);
  const tampered = new Request(original.url, {
    method: "POST",
    headers: original.headers,
    body: tamperedBody,
  });
  assert.equal((await verifyAdminShareStudioBridgeRequest(tampered, enabledEnv(), NOW_SECONDS * 1000)).error, "invalid_signature");

  const disabled = await signedRequest();
  assert.equal((await verifyAdminShareStudioBridgeRequest(disabled, {}, NOW_SECONDS * 1000)).error, "bridge_disabled");
});

test("the separate admin counter clamps its cap and never changes the personal counter name", async () => {
  const config = buildAdminShareStudioCounterConfig({ aiEnabled: false, stopBudgetJpy: 0 }, 500);
  assert.equal(config.aiEnabled, true);
  assert.equal(config.sharedCountLimitsEnabled, true);
  assert.equal(config.dailyGenerationLimit, 30);
  assert.equal(config.slotGenerationLimit, 30);

  let selectedName = "";
  const namespace = {
    getByName(name) {
      selectedName = name;
      return {
        async reserveGeneration() {
          return { ok: true, status: "reserved", state: {} };
        },
      };
    },
  };
  const result = await invokeAtomicUsageCounter({
    enabled: true,
    namespace,
    name: "glucoscope-admin-share-studio",
    method: "reserveGeneration",
  });
  assert.equal(result.ok, true);
  assert.equal(selectedName, "glucoscope-admin-share-studio");
});

test("admin generation requires Turnstile plus its secret and omits the Pages Worker IP", async () => {
  const readyEnv = {
    TURNSTILE_SECRET_KEY: "turnstile-secret",
    ADMIN_SHARE_STUDIO_TURNSTILE_HOSTNAME: "glucoscope-share-studio.pages.dev",
    ADMIN_SHARE_STUDIO_TURNSTILE_ACTION: "glucoscope-ai-letter",
  };
  assert.equal(isAdminShareStudioTurnstileReady(readyEnv, { turnstileRequired: true }), true);
  assert.equal(isAdminShareStudioTurnstileReady(readyEnv, { turnstileRequired: false }), false);
  assert.equal(isAdminShareStudioTurnstileReady({ ...readyEnv, TURNSTILE_SECRET_KEY: "" }, { turnstileRequired: true }), false);

  const indexSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
  assert.match(indexSource, /!isAdminShareStudioTurnstileReady\(env, baseConfig\)/u);
  assert.match(indexSource, /const remoteIp = expectedIdentity \? "" : request\.headers\.get\("CF-Connecting-IP"\)/u);
});
