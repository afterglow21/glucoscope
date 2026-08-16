import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workerSource = await readFile(new URL("../src/index.js", import.meta.url), "utf8");
const wranglerSource = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
const readmeSource = await readFile(new URL("../README.md", import.meta.url), "utf8");

test("Phase A keeps the atomic HTTP path off by default", () => {
  assert.match(wranglerSource, /AI_USAGE_ATOMIC_COUNTER_ENABLED\s*=\s*"false"/u);
  assert.match(workerSource, /atomicUsageCounterEnabled:\s*false/u);
  assert.match(workerSource, /shouldUseAtomicUsageCounter\(config, usageState\)/u);
});

test("Durable Object atomic commits mark state and legacy saves use the overwrite boundary", () => {
  const durableObjectBlock = workerSource.slice(
    workerSource.indexOf("export class GlucoUsageCounter"),
    workerSource.indexOf("function buildAiQuotaErrorResponse")
  );
  assert.match(durableObjectBlock, /applyLegacyUsageStateSaveBoundary\(currentState, nextState\)/u);
  assert.match(durableObjectBlock, /markAtomicUsageState\(normalizeUsageState\(state, config, now\), now\)/u);
  assert.match(durableObjectBlock, /async reserveGeneration/u);
  assert.match(durableObjectBlock, /async completeGeneration/u);
  assert.match(durableObjectBlock, /async releaseGeneration/u);
});

test("private atomic marker is not part of the public usage report", () => {
  const reportBlock = workerSource.slice(
    workerSource.indexOf("function buildUsageReport"),
    workerSource.indexOf("export class GlucoUsageCounter")
  );
  assert.doesNotMatch(reportBlock, /atomicUsageCounterSchemaVersion|atomicUsageCounterActivatedAt/u);
});

test("Phase A legacy generation uses the same bounded provider deadline", () => {
  const legacyGenerationBlock = workerSource.slice(workerSource.lastIndexOf("let generationResult;"));
  assert.match(legacyGenerationBlock, /runWithGenerationDeadline\(\{/u);
  assert.match(legacyGenerationBlock, /signal:\s*request\.signal/u);
  assert.match(legacyGenerationBlock, /enabled:\s*quotaConfig\.enabled/u);
});

test("runbook prohibits Phase A rollback after activation", () => {
  assert.match(readmeSource, /Treat activation as irreversible/u);
  assert.match(readmeSource, /never roll traffic back to a Worker Version that can perform legacy whole-state saves/u);
  assert.match(readmeSource, /AI_USAGE_ATOMIC_COUNTER_ENABLED=true` and `AI_ENABLED=false/u);
  assert.match(readmeSource, /Quiesce legacy generation before Phase B/u);
  assert.match(readmeSource, /quiet window of at least 130 additional seconds/u);
});
