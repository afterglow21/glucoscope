import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildApprovedPublicDemoLetter,
  classifyAiRequestAudience
} from "../src/demo-letter.js";

const workerSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const wranglerSource = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");

test("quota audience recognizes only the two reviewed page modes", () => {
  assert.equal(classifyAiRequestAudience({ pageMode: "kazuma-public-demo" }), "public_demo");
  assert.equal(classifyAiRequestAudience({ pageMode: "glucoscope-user-foundation" }), "personal_user");
  assert.equal(classifyAiRequestAudience({ pageMode: "public-demo" }), "unknown");
  assert.equal(classifyAiRequestAudience({}), "unknown");
});

test("approved demo letters never echo browser-supplied glucose summary data", () => {
  const marker = "PRIVATE-SUMMARY-MARKER-DO-NOT-ECHO";
  const result = buildApprovedPublicDemoLetter({
    pageMode: "kazuma-public-demo",
    language: "ja",
    analysisMode: "deep",
    rangeLabel: marker,
    currentGlucose: 999,
    metrics: { tir: marker }
  });

  assert.equal(result.provider, "approved-demo-sample");
  assert.equal(result.model, "human-reviewed-v1");
  assert.deepEqual(result.usage, { inputTokens: 0, outputTokens: 0, estimatedCostJpy: 0 });
  assert.doesNotMatch(result.text, new RegExp(marker, "u"));
  assert.doesNotMatch(result.text, /999/u);
  assert.match(result.text, /公開デモ専用/u);
});

test("personal and unknown modes cannot select a demo sample", () => {
  assert.equal(buildApprovedPublicDemoLetter({
    pageMode: "glucoscope-user-foundation",
    language: "ja",
    analysisMode: "letter"
  }), null);
  assert.equal(buildApprovedPublicDemoLetter({ pageMode: "unknown" }), null);
});

test("English and Japanese demo samples cover both reviewed modes", () => {
  for (const language of ["ja", "en"]) {
    for (const analysisMode of ["letter", "deep"]) {
      const result = buildApprovedPublicDemoLetter({
        pageMode: "kazuma-public-demo",
        language,
        analysisMode
      });
      assert.ok(result.text.length > 150);
      assert.equal(result.attempts, 0);
    }
  }
});

test("quota rollout stays fail-closed in checked-in config", () => {
  assert.match(wranglerSource, /AI_PER_USER_QUOTA_ENABLED = "false"/u);
  assert.match(wranglerSource, /AI_SHARED_COUNT_LIMITS_ENABLED = "true"/u);
  assert.match(wranglerSource, /AI_PUBLIC_DEMO_APPROVED_SAMPLE_ENABLED = "false"/u);
  assert.match(workerSource, /requestAudience === "public_demo"/u);
  assert.match(workerSource, /requestAudience !== "personal_user"/u);
  assert.match(workerSource, /return handleApprovedPublicDemoRequest/u);
});
