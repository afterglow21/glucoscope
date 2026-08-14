import assert from "node:assert/strict";
import { test } from "node:test";
import {
  plusSummaryTesting,
  readAdminPlusSummary,
} from "../src/plus-summary.js";

const unavailable = {
  available: false,
  activePlusCount: null,
};

test("treats a missing optional Plus service binding as unavailable", async () => {
  assert.deepEqual(await readAdminPlusSummary(undefined), unavailable);
  assert.deepEqual(await readAdminPlusSummary({}), unavailable);
});

test("returns only the exact active Plus aggregate", async () => {
  let calls = 0;
  const summary = await readAdminPlusSummary({
    async getActivePlusSummary(...args) {
      calls += 1;
      assert.deepEqual(args, []);
      return {
        activePlusCount: 3,
        email: "must-not-escape@example.test",
        stripeCustomerId: "cus_must_not_escape",
        purchasers: [{ id: "must-not-escape" }],
      };
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(summary, {
    available: true,
    activePlusCount: 3,
  });
  assert.equal(JSON.stringify(summary).includes("must-not-escape"), false);
  assert.equal(Object.isFrozen(summary), true);
});

test("accepts a real zero but never converts missing or malformed data into zero", async () => {
  assert.deepEqual(await readAdminPlusSummary({
    async getActivePlusSummary() {
      return { activePlusCount: 0 };
    },
  }), {
    available: true,
    activePlusCount: 0,
  });

  for (const activePlusCount of [
    undefined,
    null,
    "0",
    -1,
    1.5,
    Number.NaN,
    plusSummaryTesting.MAX_ACTIVE_PLUS_COUNT + 1,
  ]) {
    assert.deepEqual(await readAdminPlusSummary({
      async getActivePlusSummary() {
        return { activePlusCount };
      },
    }), unavailable);
  }
});

test("treats a Plus service failure as unavailable without leaking the error", async () => {
  assert.deepEqual(await readAdminPlusSummary({
    async getActivePlusSummary() {
      throw new Error("private service detail");
    },
  }), unavailable);
});
