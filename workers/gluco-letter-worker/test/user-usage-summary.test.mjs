import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPublicUsageAggregate,
  normalizePublicUsageAggregate,
} from "../src/user-usage-summary.js";

const PERIOD = Object.freeze({
  fromDay: "2026-07-16",
  throughDay: "2026-08-14",
  windowDays: 30,
  timezone: "Asia/Tokyo",
});

test("missing or failed service binding stays unavailable without throwing", async () => {
  assert.deepEqual(await loadPublicUsageAggregate(undefined), { status: "unavailable" });
  assert.deepEqual(await loadPublicUsageAggregate({
    async getPublicUsageAggregate() { throw new Error("private failure"); },
  }), { status: "unavailable" });
});

test("suppressed aggregate never includes exact totals", async () => {
  const report = await loadPublicUsageAggregate({
    async getPublicUsageAggregate() {
      return {
        status: "suppressed",
        period: PERIOD,
        minimumContributors: 10,
        totals: { contributingDeviceProfiles: 9, activeDays: 99 },
      };
    },
  });
  assert.deepEqual(report, {
    status: "suppressed",
    period: PERIOD,
    minimumContributors: 10,
  });
  assert.equal(JSON.stringify(report).includes("99"), false);
});

test("available aggregate returns only allowlisted bounded counts", () => {
  const report = normalizePublicUsageAggregate({
    status: "available",
    period: PERIOD,
    minimumContributors: 10,
    totals: {
      contributingDeviceProfiles: 12,
      activeDays: 40,
      successfulAiAnalyses: 15,
      ordinaryGlucoMemories: 22,
      displayName: "must not escape",
    },
    profileId: "must not escape",
  });
  assert.deepEqual(report.totals, {
    contributingDeviceProfiles: 12,
    activeDays: 40,
    successfulAiAnalyses: 15,
    ordinaryGlucoMemories: 22,
  });
  assert.equal(JSON.stringify(report).includes("displayName"), false);
  assert.equal(JSON.stringify(report).includes("profileId"), false);
});

test("invalid dates or counts fail closed", () => {
  assert.deepEqual(normalizePublicUsageAggregate({
    status: "available",
    period: { ...PERIOD, fromDay: "private" },
    minimumContributors: 10,
    totals: {},
  }), { status: "unavailable" });
  assert.deepEqual(normalizePublicUsageAggregate({
    status: "available",
    period: PERIOD,
    minimumContributors: 10,
    totals: {
      contributingDeviceProfiles: -1,
      activeDays: 1,
      successfulAiAnalyses: 1,
      ordinaryGlucoMemories: 1,
    },
  }), { status: "unavailable" });
});
