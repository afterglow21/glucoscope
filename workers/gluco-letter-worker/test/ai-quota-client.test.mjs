import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildAuthoritativeQuotaPayload,
  getQuotaReleaseReason,
  readAiQuotaCorsConfig,
  readAiQuotaClientConfig,
  readAiQuotaRequest,
  runAiQuotaGeneration,
} from "../src/ai-quota-client.js";

const TOKEN = "A".repeat(43);
const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174111";
const RESERVATION_ID = "123e4567-e89b-42d3-a456-426614174222";
const QUOTA = Object.freeze({
  tier: "free",
  dailyLimit: 1,
  successful: 1,
  remaining: 0,
  resetsAt: "2026-08-15T15:00:00.000Z",
});

const workerSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const wranglerSource = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

function request(authorization = `Bearer ${TOKEN}`) {
  return new Request("https://worker.example/api/gluco-letter", {
    method: "POST",
    headers: { Authorization: authorization },
  });
}

function reserveInput() {
  return {
    credential: { kind: "device_profile", token: TOKEN },
    requestId: REQUEST_ID,
    analysisMode: "letter",
  };
}

test("quota enforcement defaults off and accepts only a strict device credential request", () => {
  assert.equal(readAiQuotaClientConfig({}).enabled, false);
  assert.equal(readAiQuotaClientConfig({ AI_PER_USER_QUOTA_ENABLED: "true" }).enabled, true);

  assert.deepEqual(readAiQuotaRequest(request(), { requestId: REQUEST_ID }, "letter"), {
    ok: true,
    reserveInput: {
      credential: { kind: "device_profile", token: TOKEN },
      requestId: REQUEST_ID,
      analysisMode: "letter",
    },
  });
  assert.equal(readAiQuotaRequest(request("Basic abc"), { requestId: REQUEST_ID }, "letter").error, "authentication_required");
  assert.equal(readAiQuotaRequest(request(), { requestId: "not-a-uuid" }, "letter").error, "invalid_quota_request");
  assert.equal(readAiQuotaRequest(request(), { requestId: REQUEST_ID }, "debug").error, "invalid_quota_request");
  assert.equal(readAiQuotaRequest(request(), {
    requestId: REQUEST_ID,
    quotaCredentialKind: "plus",
  }, "letter").error, "invalid_quota_request");
  assert.deepEqual(readAiQuotaRequest(request(), {
    requestId: REQUEST_ID,
    quotaCredentialKind: "account",
    tier: "plus",
    dailyLimit: 99,
  }, "deep").reserveInput, {
    credential: { kind: "account", token: TOKEN },
    requestId: REQUEST_ID,
    analysisMode: "deep",
  });
});

test("Authorization is added to CORS only when quota enforcement is enabled", () => {
  assert.deepEqual(readAiQuotaCorsConfig({}), {
    allowedRequestHeaders: ["content-type"],
    allowedRequestHeadersDisplay: "Content-Type",
  });
  assert.deepEqual(readAiQuotaCorsConfig({ AI_PER_USER_QUOTA_ENABLED: "true" }), {
    allowedRequestHeaders: ["authorization", "content-type"],
    allowedRequestHeadersDisplay: "Authorization, Content-Type",
  });
});

test("checked-in integration is off, internal-only, and ignores debug controls when authoritative", () => {
  assert.match(wranglerSource, /AI_PER_USER_QUOTA_ENABLED = "false"/u);
  assert.match(wranglerSource, /TURNSTILE_EXPECTED_HOSTNAME = "glucoscope\.app"/u);
  assert.match(wranglerSource, /CORS_ALLOWED_ORIGINS = "https:\/\/glucoscope\.app"/u);
  assert.match(wranglerSource, /binding = "AI_QUOTA"[\s\S]*entrypoint = "AiQuotaService"/u);
  assert.match(workerSource, /handleCorsPreflight\(request, corsDecision, env\)/u);
  assert.match(workerSource, /runWithGenerationDeadline\(\{[\s\S]*signal:\s*request\.signal/u);
  assert.match(workerSource, /\.\.\.\(signal \? \{ signal \} : \{\}\)/u);
  assert.match(workerSource, /quotaConfig\.enabled \? "success" : getPrototypeStatus\(payload\)/u);
  assert.match(workerSource, /quotaConfig\.enabled[\s\S]*usageState[\s\S]*applyDebugUsageOverrides\(usageState, payload\)/u);

  const handler = workerSource.slice(
    workerSource.indexOf("async function handleApiRequest"),
    workerSource.indexOf("export default", workerSource.indexOf("async function handleApiRequest")),
  );
  assert.ok(handler.indexOf("cacheRead.status === \"fresh\"") < handler.indexOf("runAiQuotaGeneration({"));
  assert.ok(handler.indexOf("const guardBlock = getGuardBlock") < handler.indexOf("runAiQuotaGeneration({"));
  assert.ok(handler.indexOf("runAiQuotaGeneration({") < handler.indexOf("writeSharedCache({"));
});

test("disabled mode preserves the legacy generation path and never touches the service", async () => {
  let generated = 0;
  const service = new Proxy({}, { get() { throw new Error("service must not be read"); } });
  const result = await runAiQuotaGeneration({
    enabled: false,
    service,
    generate: async () => {
      generated += 1;
      return { text: "safe" };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.authoritative, false);
  assert.equal(result.result.text, "safe");
  assert.equal(generated, 1);
});

test("enabled mode reserves before generation and completes only after safe final text", async () => {
  const order = [];
  const result = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      async reserveAiGeneration(input) {
        order.push(["reserve", input]);
        return { ok: true, status: "reserved", reservationId: RESERVATION_ID, quota: QUOTA };
      },
      async completeAiGeneration(input) {
        order.push(["complete", input]);
        return { ok: true, status: "completed", quota: QUOTA };
      },
      async releaseAiGeneration() {
        order.push(["release"]);
        return { ok: true };
      },
    },
    generate: async () => {
      order.push(["generate"]);
      return { text: "final safe letter" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.text, "final safe letter");
  assert.deepEqual(order.map(([name]) => name), ["reserve", "generate", "complete"]);
  assert.deepEqual(order[0][1], reserveInput());
  assert.deepEqual(order[2][1], { reservationId: RESERVATION_ID });
  assert.deepEqual(buildAuthoritativeQuotaPayload(result.quota, { consumed: true }), {
    authoritative: true,
    consumed: true,
    ...QUOTA,
  });
});

for (const [code, expectedReason] of [
  ["openai_output_quality_failed", "quality_failed"],
  ["openai_incomplete_output", "generation_incomplete"],
  ["openai_api_error", "provider_error"],
  ["openai_transport_error", "provider_error"],
]) {
  test(`${code} releases without completing or consuming`, async () => {
    const calls = [];
    const error = Object.assign(new Error(code), { code });
    const result = await runAiQuotaGeneration({
      enabled: true,
      reserveInput: reserveInput(),
      service: {
        async reserveAiGeneration() {
          calls.push("reserve");
          return { ok: true, status: "reserved", reservationId: RESERVATION_ID, quota: QUOTA };
        },
        async completeAiGeneration() {
          calls.push("complete");
          return { ok: true, quota: QUOTA };
        },
        async releaseAiGeneration(input) {
          calls.push(["release", input]);
          return { ok: true, status: "released", quota: { ...QUOTA, successful: 0, remaining: 1 } };
        },
      },
      generate: async () => { throw error; },
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "generation");
    assert.equal(result.error, expectedReason);
    assert.deepEqual(calls, [
      "reserve",
      ["release", { reservationId: RESERVATION_ID, reasonCode: expectedReason }],
    ]);
    assert.equal("result" in result, false);
  });
}

test("an abort after reservation releases as request_aborted", async () => {
  const controller = new AbortController();
  let releasedReason = "";
  const abort = new Error("aborted");
  abort.name = "AbortError";
  const result = await runAiQuotaGeneration({
    enabled: true,
    signal: controller.signal,
    reserveInput: reserveInput(),
    service: {
      async reserveAiGeneration() {
        return { ok: true, status: "reserved", reservationId: RESERVATION_ID };
      },
      async completeAiGeneration() { throw new Error("must not complete"); },
      async releaseAiGeneration({ reasonCode }) {
        releasedReason = reasonCode;
        return { ok: true, status: "released", quota: QUOTA };
      },
    },
    generate: async () => {
      controller.abort();
      throw abort;
    },
  });
  assert.equal(result.stage, "generation");
  assert.equal(releasedReason, "request_aborted");
  assert.equal(getQuotaReleaseReason(abort, controller.signal), "request_aborted");
});

test("reserve rejection never calls the provider", async () => {
  let generated = false;
  const result = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      async reserveAiGeneration() {
        return { ok: false, status: "limit_reached", error: "daily_limit_reached", quota: QUOTA };
      },
      async completeAiGeneration() { throw new Error("must not complete"); },
      async releaseAiGeneration() { throw new Error("must not release"); },
    },
    generate: async () => { generated = true; },
  });
  assert.equal(result.stage, "reserve");
  assert.equal(result.error, "daily_limit_reached");
  assert.equal(generated, false);
});

test("release and completion failures fail closed without returning generated text", async () => {
  const baseService = {
    async reserveAiGeneration() {
      return { ok: true, status: "reserved", reservationId: RESERVATION_ID };
    },
  };
  const releaseFailure = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      ...baseService,
      async completeAiGeneration() { throw new Error("must not complete"); },
      async releaseAiGeneration() { return { ok: false, error: "quota_release_failed" }; },
    },
    generate: async () => { throw Object.assign(new Error("bad"), {
      code: "openai_api_error",
      usage: { totalTokens: 123, estimatedCostJpy: 0.12 }
    }); },
  });
  assert.equal(releaseFailure.stage, "release");
  assert.equal("result" in releaseFailure, false);
  assert.deepEqual(releaseFailure.generationError.usage, { totalTokens: 123, estimatedCostJpy: 0.12 });

  const completionFailure = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      ...baseService,
      async completeAiGeneration() { return { ok: false, error: "quota_finalize_failed" }; },
      async releaseAiGeneration() { throw new Error("must not release after uncertain completion"); },
    },
    generate: async () => ({ text: "must not escape", usage: { totalTokens: 321, estimatedCostJpy: 0.25 } }),
  });
  assert.equal(completionFailure.stage, "complete");
  assert.equal("result" in completionFailure, false);
  assert.deepEqual(completionFailure.knownUsage, { totalTokens: 321, estimatedCostJpy: 0.25 });

  const malformedCompletion = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      ...baseService,
      async completeAiGeneration() { return { ok: true, quota: QUOTA }; },
      async releaseAiGeneration() { throw new Error("must not release after uncertain completion"); },
    },
    generate: async () => ({ text: "must not escape", usage: { totalTokens: 322, estimatedCostJpy: 0.26 } }),
  });
  assert.equal(malformedCompletion.stage, "complete");
  assert.equal("result" in malformedCompletion, false);
  assert.deepEqual(malformedCompletion.knownUsage, { totalTokens: 322, estimatedCostJpy: 0.26 });

  const malformedCompletionQuota = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      ...baseService,
      async completeAiGeneration() { return { ok: true, status: "completed", quota: null }; },
      async releaseAiGeneration() { throw new Error("must not release after uncertain completion"); },
    },
    generate: async () => ({ text: "must not escape", usage: { totalTokens: 323, estimatedCostJpy: 0.27 } }),
  });
  assert.equal(malformedCompletionQuota.stage, "complete");
  assert.equal("result" in malformedCompletionQuota, false);
  assert.deepEqual(malformedCompletionQuota.knownUsage, { totalTokens: 323, estimatedCostJpy: 0.27 });

  const malformedReleaseQuota = await runAiQuotaGeneration({
    enabled: true,
    reserveInput: reserveInput(),
    service: {
      ...baseService,
      async completeAiGeneration() { throw new Error("must not complete"); },
      async releaseAiGeneration() { return { ok: true, status: "released", quota: null }; },
    },
    generate: async () => { throw Object.assign(new Error("bad"), { code: "openai_api_error" }); },
  });
  assert.equal(malformedReleaseQuota.stage, "release");
  assert.equal("result" in malformedReleaseQuota, false);

  assert.match(workerSource, /if \(!outcome\.ok && outcome\.generationError\)/u);
  assert.match(workerSource, /actualUsage: quotaOutcome\.knownUsage \|\| emptyRequestUsage\(\)/u);
});
