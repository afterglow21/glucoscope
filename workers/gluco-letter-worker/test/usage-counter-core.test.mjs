import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAtomicCacheHit,
  applyAtomicGenerationComplete,
  applyAtomicGenerationRelease,
  applyAtomicGenerationReserve,
  applyAtomicTurnstileEvent,
  applyLegacyUsageStateSaveBoundary,
  carryAtomicUsageStateAcrossMonth,
  estimateMaximumOpenAiCostJpy,
  getPendingUsageTotals,
  markAtomicUsageState,
  shouldUseAtomicUsageCounter
} from "../src/usage-counter-core.js";

const IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333"
];
const NOW = new Date("2026-08-16T03:00:00.000Z");
const CONFIG = {
  aiEnabled: true,
  dailyGenerationLimit: 30,
  slotGenerationLimit: 10,
  stopBudgetJpy: 80
};

function state(overrides = {}) {
  return {
    dayKey: "2026-08-16",
    monthKey: "2026-08",
    estimatedCostJpy: 0,
    ...overrides
  };
}

function reserve(inputState, requestId, overrides = {}, now = NOW) {
  return applyAtomicGenerationReserve(inputState, {
    requestId,
    slot: "morning",
    analysisMode: "letter",
    reservedCostJpy: 1,
    ...overrides
  }, CONFIG, now);
}

test("serialized simultaneous reserves cannot exceed the last slot", async () => {
  const harness = {
    current: state({
      dailyGenerationCount: 9,
      dailySlotGenerationCounts: { morning: 9 }
    }),
    async reserve(requestId) {
      const result = reserve(this.current, requestId);
      this.current = result.state;
      return result;
    }
  };

  const results = await Promise.all([IDS[0], IDS[1]].map((requestId) => harness.reserve(requestId)));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => result.status === "rate_limited").length, 1);
  assert.equal(getPendingUsageTotals(harness.current, NOW).totals.count, 1);
  assert.equal(harness.current.dailyRateLimitedCount, 1);
});

test("per-user rollout can remove shared count caps without removing the global budget stop", () => {
  const perUserPolicy = {
    ...CONFIG,
    sharedCountLimitsEnabled: false
  };
  const beyondFormerCountCaps = applyAtomicGenerationReserve(state({
    dailyGenerationCount: 30,
    dailySlotGenerationCounts: { morning: 10 }
  }), {
    requestId: IDS[0],
    slot: "morning",
    analysisMode: "letter",
    reservedCostJpy: 1
  }, perUserPolicy, NOW);
  assert.equal(beyondFormerCountCaps.status, "reserved");

  const budgetStopped = applyAtomicGenerationReserve(state({
    dailyGenerationCount: 30,
    dailySlotGenerationCounts: { morning: 10 },
    estimatedCostJpy: 79
  }), {
    requestId: IDS[1],
    slot: "morning",
    analysisMode: "letter",
    reservedCostJpy: 1
  }, perUserPolicy, NOW);
  assert.equal(budgetStopped.status, "budget_stopped");
  assert.equal(budgetStopped.reason, "budget");
});

test("duplicate request IDs create one pending reservation", () => {
  const first = reserve(state(), IDS[0]);
  const duplicate = reserve(first.state, IDS[0]);

  assert.equal(first.status, "reserved");
  assert.equal(duplicate.status, "request_in_progress");
  assert.equal(duplicate.idempotent, true);
  assert.equal(getPendingUsageTotals(duplicate.state, NOW).totals.count, 1);
});

test("duplicate completion counts generation, tokens, and actual cost once", () => {
  const pending = reserve(state(), IDS[0]);
  const completed = applyAtomicGenerationComplete(pending.state, {
    requestId: IDS[0],
    actualUsage: { inputTokens: 1200, outputTokens: 300, estimatedCostJpy: 0.0987 }
  }, NOW);
  const duplicate = applyAtomicGenerationComplete(completed.state, {
    requestId: IDS[0],
    actualUsage: { inputTokens: 9999, outputTokens: 9999, estimatedCostJpy: 9 }
  }, NOW);

  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.state.dailyGenerationCount, 1);
  assert.equal(duplicate.state.monthlyGenerationCount, 1);
  assert.equal(duplicate.state.inputTokens, 1200);
  assert.equal(duplicate.state.outputTokens, 300);
  assert.equal(duplicate.state.estimatedCostJpy, 0.0987);
});

test("provider failure releases the slot while retaining actual provider usage", () => {
  const oneSlotConfig = { ...CONFIG, slotGenerationLimit: 1 };
  const first = applyAtomicGenerationReserve(state(), {
    requestId: IDS[0], slot: "night", analysisMode: "deep", reservedCostJpy: 2
  }, oneSlotConfig, NOW);
  const released = applyAtomicGenerationRelease(first.state, {
    requestId: IDS[0],
    reason: "provider_error",
    actualUsage: { inputTokens: 700, outputTokens: 40, estimatedCostJpy: 0.0304 }
  }, NOW);
  const second = applyAtomicGenerationReserve(released.state, {
    requestId: IDS[1], slot: "night", analysisMode: "deep", reservedCostJpy: 2
  }, oneSlotConfig, NOW);

  assert.equal(released.state.dailyGenerationCount, 0);
  assert.equal(released.state.inputTokens, 700);
  assert.equal(released.state.outputTokens, 40);
  assert.equal(released.state.estimatedCostJpy, 0.0304);
  assert.equal(second.status, "reserved");
});

test("JST day rollover allows a new reserve after completed daily counters reset", () => {
  const beforeMidnight = new Date("2026-08-16T14:59:55.000Z");
  const completed = applyAtomicGenerationComplete(
    reserve(state(), IDS[0], {}, beforeMidnight).state,
    { requestId: IDS[0], actualUsage: {} },
    beforeMidnight
  );
  const rolledState = {
    ...completed.state,
    dayKey: "2026-08-17",
    dailyGenerationCount: 0,
    dailySlotGenerationCounts: { morning: 0 },
    dailyModeGenerationCounts: { letter: 0, deep: 0 },
    dailyModeSlotGenerationCounts: { letter: { morning: 0 }, deep: {} }
  };
  const afterMidnight = new Date("2026-08-16T15:00:05.000Z");
  const next = reserve(rolledState, IDS[1], {}, afterMidnight);

  assert.equal(next.status, "reserved");
  assert.equal(getPendingUsageTotals(next.state, afterMidnight).totals.count, 1);
});

test("Turnstile and cache-hit events update all public report counters atomically", () => {
  const verified = applyAtomicTurnstileEvent(state(), { required: true, verified: true }, NOW);
  const failed = applyAtomicTurnstileEvent(verified.state, { required: true, verified: false }, NOW);
  const cached = applyAtomicCacheHit(failed.state, {
    slot: "afternoon",
    analysisMode: "deep"
  }, NOW);

  assert.equal(cached.state.dailyTurnstileVerifiedCount, 1);
  assert.equal(cached.state.monthlyTurnstileVerifiedCount, 1);
  assert.equal(cached.state.dailyTurnstileFailedCount, 1);
  assert.equal(cached.state.monthlyTurnstileFailedCount, 1);
  assert.equal(cached.state.dailyCacheHitCount, 1);
  assert.equal(cached.state.monthlyCacheHitCount, 1);
  assert.equal(cached.state.dailySlotCacheHitCounts.afternoon, 1);
  assert.equal(cached.state.dailyModeCacheHitCounts.deep, 1);
  assert.equal(cached.state.dailyModeSlotCacheHitCounts.deep.afternoon, 1);
});

test("pending reserved cost blocks concurrent work at the 80 yen stop boundary", async () => {
  const harness = {
    current: state({ estimatedCostJpy: 79 }),
    async reserve(requestId, reservedCostJpy) {
      const result = reserve(this.current, requestId, { reservedCostJpy });
      this.current = result.state;
      return result;
    }
  };

  const results = await Promise.all([
    harness.reserve(IDS[0], 0.6),
    harness.reserve(IDS[1], 0.4)
  ]);
  assert.equal(results[0].status, "reserved");
  assert.equal(results[1].status, "budget_stopped");
  assert.equal(harness.current.estimatedCostJpy, 79);
  assert.equal(getPendingUsageTotals(harness.current, NOW).totals.reservedCostJpy, 0.6);
  assert.equal(harness.current.monthlyBudgetBlockedCount, 1);
});

test("public estimated cost remains actual-only through reserve and release", () => {
  const pending = reserve(state({ estimatedCostJpy: 12.5 }), IDS[0], { reservedCostJpy: 3.5 });
  assert.equal(pending.state.estimatedCostJpy, 12.5);
  assert.equal(getPendingUsageTotals(pending.state, NOW).totals.reservedCostJpy, 3.5);

  const released = applyAtomicGenerationRelease(pending.state, {
    requestId: IDS[0],
    reason: "provider_error",
    actualUsage: { estimatedCostJpy: 0.25 }
  }, NOW);
  assert.equal(released.state.estimatedCostJpy, 12.75);
  assert.equal(getPendingUsageTotals(released.state, NOW).totals.reservedCostJpy, 0);
});

test("maximum-cost estimator includes two transport attempts for both prompt stages", () => {
  const estimate = estimateMaximumOpenAiCostJpy({
    instructionsUtf8Bytes: 1000,
    initialPromptUtf8Bytes: 500,
    retryPromptUtf8Bytes: 700,
    initialMaxOutputTokens: 700,
    retryMaxOutputTokens: 1100,
    inputPriceJpyPerMillionTokens: 32,
    outputPriceJpyPerMillionTokens: 200,
    framingInputTokensPerCall: 100,
    transportAttemptsPerStage: 2
  });

  assert.equal(estimate.inputTokens, 6800);
  assert.equal(estimate.outputTokens, 3600);
  assert.equal(estimate.reservedCostJpy, 0.9376);
});

test("late Phase A legacy save cannot overwrite state after atomic activation", () => {
  const atomicState = markAtomicUsageState(state({
    dailyGenerationCount: 1,
    monthlyGenerationCount: 16,
    estimatedCostJpy: 14.25
  }), NOW);
  const staleLegacySnapshot = state({
    dailyGenerationCount: 0,
    monthlyGenerationCount: 15,
    estimatedCostJpy: 13.47
  });
  const boundary = applyLegacyUsageStateSaveBoundary(atomicState, staleLegacySnapshot);

  assert.equal(boundary.accepted, false);
  assert.equal(boundary.reason, "atomic_usage_counter_active");
  assert.equal(boundary.state.dailyGenerationCount, 1);
  assert.equal(boundary.state.monthlyGenerationCount, 16);
  assert.equal(boundary.state.estimatedCostJpy, 14.25);
  assert.equal(boundary.state.atomicUsageCounterSchemaVersion, 1);
});

test("atomic activation is sticky even if the rollout flag is later set false", () => {
  assert.equal(shouldUseAtomicUsageCounter(
    { atomicUsageCounterEnabled: false },
    markAtomicUsageState(state(), NOW)
  ), true);
  assert.equal(shouldUseAtomicUsageCounter(
    { atomicUsageCounterEnabled: false },
    state()
  ), false);
});

test("month rollover resets monthly totals while preserving marker and pending completion", () => {
  const augustPending = reserve(
    markAtomicUsageState(state({
      monthlyGenerationCount: 15,
      estimatedCostJpy: 13.47
    }), new Date("2026-08-31T14:59:50.000Z")),
    IDS[0],
    {},
    new Date("2026-08-31T14:59:50.000Z")
  ).state;
  const septemberFresh = state({
    dayKey: "2026-09-01",
    monthKey: "2026-09",
    monthlyGenerationCount: 0,
    estimatedCostJpy: 0
  });
  const rolled = carryAtomicUsageStateAcrossMonth(augustPending, septemberFresh);
  const completed = applyAtomicGenerationComplete(rolled, {
    requestId: IDS[0],
    actualUsage: { inputTokens: 10, outputTokens: 5, estimatedCostJpy: 0.01 }
  }, new Date("2026-08-31T15:00:05.000Z"));

  assert.equal(rolled.monthlyGenerationCount, 0);
  assert.equal(rolled.estimatedCostJpy, 0);
  assert.equal(rolled.atomicUsageCounterSchemaVersion, 1);
  assert.equal(completed.ok, true);
  assert.equal(completed.state.monthlyGenerationCount, 1);
  assert.equal(completed.state.estimatedCostJpy, 0.01);
  assert.equal(completed.state.usageReservations[IDS[0]].monthKey, "2026-09");
});
