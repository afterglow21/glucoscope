import assert from "node:assert/strict";
import test from "node:test";
import {
  ATOMIC_USAGE_GENERATION_TIMEOUT_MS,
  invokeAtomicUsageFinalization,
  invokeAtomicUsageCounter,
  runWithAtomicUsageReservation,
  runWithGenerationDeadline
} from "../src/usage-counter-client.js";
import { USAGE_RESERVATION_PENDING_TTL_MS } from "../src/usage-counter-core.js";
import {
  applyAtomicGenerationComplete,
  applyAtomicGenerationRelease,
  applyAtomicGenerationReserve
} from "../src/usage-counter-core.js";

test("atomic usage counter stays inactive during Phase A", async () => {
  let bindingTouched = false;
  const result = await invokeAtomicUsageCounter({
    enabled: false,
    namespace: {
      getByName() {
        bindingTouched = true;
        return {};
      }
    },
    method: "reserveGeneration"
  });

  assert.equal(result.error, "atomic_usage_counter_disabled");
  assert.equal(bindingTouched, false);
});

test("missing mixed-version RPC fails closed without a legacy save fallback", async () => {
  let legacySaveCalled = false;
  const result = await invokeAtomicUsageCounter({
    enabled: true,
    namespace: {
      getByName() {
        return {
          async saveState() {
            legacySaveCalled = true;
          }
        };
      }
    },
    method: "reserveGeneration"
  });

  assert.equal(result.error, "usage_counter_unavailable");
  assert.equal(result.reason, "rpc_missing");
  assert.equal(legacySaveCalled, false);
});

test("old Durable Object RPC rejection fails closed", async () => {
  const result = await invokeAtomicUsageCounter({
    enabled: true,
    namespace: {
      getByName() {
        return {
          async reserveGeneration() {
            throw new Error("Couldn't find a class member named 'reserveGeneration'");
          }
        };
      }
    },
    method: "reserveGeneration"
  });

  assert.equal(result.error, "usage_counter_unavailable");
  assert.equal(result.reason, "rpc_failed");
});

test("valid atomic RPC result is returned", async () => {
  const state = { dailyGenerationCount: 0 };
  const result = await invokeAtomicUsageCounter({
    enabled: true,
    namespace: {
      getByName() {
        return {
          async reserveGeneration(input, config) {
            assert.equal(input.requestId, "11111111-1111-4111-8111-111111111111");
            assert.equal(config.stopBudgetJpy, 80);
            return { ok: true, status: "reserved", state };
          }
        };
      }
    },
    method: "reserveGeneration",
    input: { requestId: "11111111-1111-4111-8111-111111111111" },
    config: { stopBudgetJpy: 80 }
  });

  assert.equal(result.ok, true);
  assert.equal(result.result.status, "reserved");
  assert.equal(result.result.state, state);
});

test("provider deadline is safely shorter than the pending reservation TTL", () => {
  assert.equal(ATOMIC_USAGE_GENERATION_TIMEOUT_MS, 120_000);
  assert.ok(ATOMIC_USAGE_GENERATION_TIMEOUT_MS < USAGE_RESERVATION_PENDING_TTL_MS);
});

test("a provider that never settles is timed out and releases its reservation", async () => {
  let releaseCount = 0;
  const execution = await runWithAtomicUsageReservation({
    timeoutMs: 20,
    abortGraceMs: 5,
    run: () => new Promise(() => {}),
    release: async (error) => {
      releaseCount += 1;
      assert.equal(error.code, "generation_timeout");
      return { ok: true, status: "released" };
    }
  });

  assert.equal(execution.ok, false);
  assert.equal(execution.error.code, "generation_timeout");
  assert.equal(execution.releaseResult.status, "released");
  assert.equal(releaseCount, 1);
});

test("legacy generation without an atomic reservation still has a hard provider deadline", async () => {
  await assert.rejects(
    runWithGenerationDeadline({
      timeoutMs: 20,
      abortGraceMs: 5,
      run: () => new Promise(() => {})
    }),
    (error) => error?.code === "generation_timeout"
  );
});

test("a caller abort releases its reservation exactly once", async () => {
  const controller = new AbortController();
  let releaseCount = 0;
  const executionPromise = runWithAtomicUsageReservation({
    timeoutMs: 1000,
    signal: controller.signal,
    run: (signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    }),
    release: async (error) => {
      releaseCount += 1;
      assert.equal(error.code, "request_aborted");
      return { ok: true, status: "released" };
    }
  });
  controller.abort();
  const execution = await executionPromise;

  assert.equal(execution.ok, false);
  assert.equal(execution.error.code, "request_aborted");
  assert.equal(releaseCount, 1);
});

test("lost completion response retries once and idempotency prevents double counting", async () => {
  const now = new Date("2026-08-16T03:00:00.000Z");
  const config = { aiEnabled: true, dailyGenerationLimit: 30, slotGenerationLimit: 10, stopBudgetJpy: 80 };
  const requestId = "44444444-4444-4444-8444-444444444444";
  let current = applyAtomicGenerationReserve({
    dayKey: "2026-08-16",
    monthKey: "2026-08",
    estimatedCostJpy: 0
  }, {
    requestId,
    slot: "morning",
    analysisMode: "letter",
    reservedCostJpy: 1
  }, config, now).state;
  let calls = 0;
  const stub = {
    async completeGeneration(input) {
      calls += 1;
      const completed = applyAtomicGenerationComplete(current, input, now);
      current = completed.state;
      if (calls === 1) throw new Error("response lost after commit");
      return completed;
    }
  };

  const result = await invokeAtomicUsageFinalization({
    enabled: true,
    namespace: { getByName: () => stub },
    method: "completeGeneration",
    input: {
      requestId,
      actualUsage: { inputTokens: 100, outputTokens: 20, estimatedCostJpy: 0.01 }
    },
    config
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.result.idempotent, true);
  assert.equal(current.dailyGenerationCount, 1);
  assert.equal(current.inputTokens, 100);
  assert.equal(current.estimatedCostJpy, 0.01);
});

test("lost release response retries once without double provider usage", async () => {
  const now = new Date("2026-08-16T03:00:00.000Z");
  const config = { aiEnabled: true, dailyGenerationLimit: 30, slotGenerationLimit: 10, stopBudgetJpy: 80 };
  const requestId = "55555555-5555-4555-8555-555555555555";
  let current = applyAtomicGenerationReserve({
    dayKey: "2026-08-16",
    monthKey: "2026-08",
    estimatedCostJpy: 0
  }, {
    requestId,
    slot: "night",
    analysisMode: "deep",
    reservedCostJpy: 1
  }, config, now).state;
  let calls = 0;
  const stub = {
    async releaseGeneration(input) {
      calls += 1;
      const released = applyAtomicGenerationRelease(current, input, now);
      current = released.state;
      if (calls === 1) throw new Error("response lost after commit");
      return released;
    }
  };

  const result = await invokeAtomicUsageFinalization({
    enabled: true,
    namespace: { getByName: () => stub },
    method: "releaseGeneration",
    input: {
      requestId,
      reason: "provider_error",
      actualUsage: { inputTokens: 80, outputTokens: 0, estimatedCostJpy: 0.0026 }
    },
    config
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.result.idempotent, true);
  assert.equal(current.inputTokens, 80);
  assert.equal(current.estimatedCostJpy, 0.0026);
});

test("persistent finalization failure retries once then stays unavailable and pending", async () => {
  let calls = 0;
  const result = await invokeAtomicUsageFinalization({
    enabled: true,
    namespace: {
      getByName() {
        return {
          async completeGeneration() {
            calls += 1;
            throw new Error("temporary RPC failure");
          }
        };
      }
    },
    method: "completeGeneration",
    input: { requestId: "66666666-6666-4666-8666-666666666666" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error, "usage_counter_unavailable");
  assert.equal(result.attempts, 2);
  assert.equal(calls, 2);
});
