import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  completeAiGeneration,
  getAggregateAiUsage,
  readAiQuotaConfig,
  releaseAiGeneration,
  reserveAiGeneration,
  runAiQuotaCleanup,
} from "../src/ai-quota-core.js";

const NOW = Date.parse("2026-08-15T03:00:00.000Z");
const DEVICE_TOKEN = "D".repeat(43);
const ACCOUNT_TOKEN = "account-session-token-000000000001";
const TOKEN_HASH = "H".repeat(43);
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "20000000-0000-4000-8000-000000000001";

function uuid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

class FakeQuotaStore {
  constructor() {
    this.profiles = new Map([[TOKEN_HASH, { id: PROFILE_ID }]]);
    this.days = new Map();
    this.attemptsByRequest = new Map();
    this.attemptsByReservation = new Map();
    this.reserveCalls = 0;
  }

  dayKey(subjectKey, day) {
    return `${subjectKey}:${day}`;
  }

  requestKey(subjectKey, requestId) {
    return `${subjectKey}:${requestId}`;
  }

  activeReservations(subjectKey, day, now) {
    let count = 0;
    for (const attempt of this.attemptsByReservation.values()) {
      if (
        attempt.subjectKey === subjectKey
        && attempt.day === day
        && attempt.status === "reserved"
        && attempt.expiresAt > now
      ) count += 1;
    }
    return count;
  }

  snapshot(attempt, now, fallbackLimit = 0) {
    const dayRow = attempt
      ? this.days.get(this.dayKey(attempt.subjectKey, attempt.day))
      : null;
    const successful = dayRow?.successCount || 0;
    const activeReservations = attempt
      ? this.activeReservations(attempt.subjectKey, attempt.day, now)
      : 0;
    const dailyLimit = attempt?.dailyLimit || fallbackLimit;
    return {
      attempt,
      successful,
      activeReservations,
      dailyLimit,
      remaining: Math.max(0, dailyLimit - successful - activeReservations),
    };
  }

  async findDeviceProfileByTokenHash({ tokenHash }) {
    return this.profiles.get(tokenHash) || null;
  }

  async reserve(input) {
    this.reserveCalls += 1;
    const dayKey = this.dayKey(input.subjectKey, input.day);
    let dayRow = this.days.get(dayKey);
    if (!dayRow) {
      dayRow = {
        subjectKey: input.subjectKey,
        subjectKind: input.subjectKind,
        deviceProfileId: input.deviceProfileId,
        day: input.day,
        successCount: 0,
      };
      this.days.set(dayKey, dayRow);
    }

    const existing = this.attemptsByRequest.get(
      this.requestKey(input.subjectKey, input.requestId),
    );
    if (existing) {
      const status = existing.status === "succeeded"
        ? "already_succeeded"
        : existing.status === "released"
          ? "already_released"
          : existing.expiresAt <= input.now
            ? "expired"
            : "in_progress";
      return { status, ...this.snapshot(existing, input.now) };
    }

    const active = this.activeReservations(input.subjectKey, input.day, input.now);
    if (dayRow.successCount + active >= input.dailyLimit) {
      return {
        status: "limit_reached",
        attempt: null,
        successful: dayRow.successCount,
        activeReservations: active,
        dailyLimit: input.dailyLimit,
        remaining: 0,
      };
    }

    const attempt = {
      ...input,
      status: "reserved",
      completedAt: null,
      releaseReason: null,
    };
    this.attemptsByRequest.set(this.requestKey(input.subjectKey, input.requestId), attempt);
    this.attemptsByReservation.set(input.reservationId, attempt);
    return { status: "reserved", ...this.snapshot(attempt, input.now) };
  }

  async complete({ reservationId, now }) {
    const attempt = this.attemptsByReservation.get(reservationId);
    if (!attempt) return { status: "not_found" };
    if (attempt.status === "succeeded") {
      return { status: "already_succeeded", ...this.snapshot(attempt, now) };
    }
    if (attempt.status === "released") {
      return { status: "released", ...this.snapshot(attempt, now) };
    }
    if (attempt.expiresAt <= now) {
      return { status: "expired", ...this.snapshot(attempt, now) };
    }
    const dayRow = this.days.get(this.dayKey(attempt.subjectKey, attempt.day));
    if (dayRow.successCount >= attempt.dailyLimit) {
      return { status: "conflict", ...this.snapshot(attempt, now) };
    }
    dayRow.successCount += 1;
    attempt.status = "succeeded";
    attempt.completedAt = now;
    return { status: "completed", ...this.snapshot(attempt, now) };
  }

  async release({ reservationId, reasonCode, now }) {
    const attempt = this.attemptsByReservation.get(reservationId);
    if (!attempt) return { status: "not_found" };
    if (attempt.status === "succeeded") {
      return { status: "already_succeeded", ...this.snapshot(attempt, now) };
    }
    if (attempt.status === "released") {
      return { status: "already_released", ...this.snapshot(attempt, now) };
    }
    attempt.status = "released";
    attempt.completedAt = now;
    attempt.releaseReason = reasonCode;
    return { status: "released", ...this.snapshot(attempt, now) };
  }

  async getAggregate({ day, monthStartDay, monthEndDay }) {
    const todayRows = [...this.days.values()].filter((row) => row.day === day);
    const monthRows = [...this.days.values()].filter(
      (row) => row.day >= monthStartDay && row.day < monthEndDay,
    );
    const successes = [...this.attemptsByReservation.values()].filter(
      (attempt) => attempt.day === day && attempt.status === "succeeded",
    );
    return {
      today: {
        successCount: todayRows.reduce((sum, row) => sum + row.successCount, 0),
        activeSubjects: todayRows.filter((row) => row.successCount > 0).length,
        freeSuccessCount: successes.filter((attempt) => attempt.tier === "free").length,
        plusSuccessCount: successes.filter((attempt) => attempt.tier === "plus").length,
      },
      month: {
        successCount: monthRows.reduce((sum, row) => sum + row.successCount, 0),
        activeSubjects: new Set(
          monthRows.filter((row) => row.successCount > 0).map((row) => row.subjectKey),
        ).size,
      },
    };
  }

  async cleanup({ attemptCutoff, dayCutoff }) {
    let attemptsDeleted = 0;
    for (const [reservationId, attempt] of this.attemptsByReservation) {
      if (attempt.reservedAt >= attemptCutoff) continue;
      this.attemptsByReservation.delete(reservationId);
      this.attemptsByRequest.delete(this.requestKey(attempt.subjectKey, attempt.requestId));
      attemptsDeleted += 1;
    }
    let daysDeleted = 0;
    for (const [key, row] of this.days) {
      if (row.day >= dayCutoff) continue;
      this.days.delete(key);
      daysDeleted += 1;
    }
    return { attemptsDeleted, daysDeleted };
  }
}

function createHarness({ plusActive = true, entitlementStatus = "ok", now = NOW } = {}) {
  const store = new FakeQuotaStore();
  let reservationSequence = 900000;
  let currentNow = now;
  let entitlementCalls = 0;
  const services = {
    store,
    crypto: webcrypto,
    now: () => currentNow,
    hashBearerToken: async () => TOKEN_HASH,
    createReservationId: () => uuid(reservationSequence++),
    resolveAccountEntitlement: async () => {
      entitlementCalls += 1;
      if (entitlementStatus !== "ok") return { status: entitlementStatus };
      return { status: "ok", subjectId: ACCOUNT_ID, plusActive };
    },
  };
  return {
    env: {
      AI_PER_USER_QUOTA_ENABLED: "true",
      AI_QUOTA_TIMEZONE_OFFSET_HOURS: "9",
      AI_FREE_DAILY_LIMIT: "1",
      AI_PLUS_DAILY_LIMIT: "5",
      AI_QUOTA_RESERVATION_TTL_SECONDS: "600",
      AI_QUOTA_RETENTION_DAYS: "90",
    },
    services,
    store,
    entitlementCalls: () => entitlementCalls,
    setNow(value) {
      currentNow = value;
    },
  };
}

function deviceRequest(requestId, extraCredential = {}) {
  return {
    credential: { kind: "device_profile", token: DEVICE_TOKEN, ...extraCredential },
    requestId,
    analysisMode: "letter",
  };
}

function accountRequest(requestId) {
  return {
    credential: { kind: "account", token: ACCOUNT_TOKEN },
    requestId,
    analysisMode: "deep",
  };
}

test("checked-in policy is disabled with fixed 1/5 limits, TTL, and retention", async () => {
  assert.deepEqual(readAiQuotaConfig({}), {
    enabled: false,
    timezoneOffsetHours: 9,
    freeDailyLimit: 1,
    plusDailyLimit: 5,
    reservationTtlSeconds: 600,
    retentionDays: 90,
  });

  const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const migration = await readFile(
    new URL("../migrations/0002_ai_quota.sql", import.meta.url),
    "utf8",
  );
  assert.match(wrangler, /"AI_PER_USER_QUOTA_ENABLED": "false"/u);
  assert.match(wrangler, /"AI_QUOTA_RESERVATION_TTL_SECONDS": "600"/u);
  assert.match(wrangler, /"AI_QUOTA_RETENTION_DAYS": "90"/u);
  assert.match(migration, /success_count BETWEEN 0 AND 5/u);
  assert.match(migration, /FOREIGN KEY \(device_profile_id\)[\s\S]*ON DELETE CASCADE/u);
  assert.doesNotMatch(migration, /email|glucose|nightscout|session_token|token_hash/iu);
});

test("disabled enforcement performs no authentication or quota write", async () => {
  const harness = createHarness();
  const result = await reserveAiGeneration(
    { invalid: true },
    { AI_PER_USER_QUOTA_ENABLED: "false" },
    harness.services,
  );
  assert.equal(result.status, "disabled");
  assert.equal(harness.store.reserveCalls, 0);
});

test("disabled quota cleanup performs no D1 operation", async () => {
  let cleanupCalls = 0;
  const store = {
    async cleanup() {
      cleanupCalls += 1;
      throw new Error("disabled cleanup must not touch quota tables");
    },
  };

  const result = await runAiQuotaCleanup(
    store,
    { AI_PER_USER_QUOTA_ENABLED: "false" },
    NOW,
  );

  assert.deepEqual(result, {
    attemptsDeleted: 0,
    daysDeleted: 0,
  });
  assert.equal(cleanupCalls, 0);
});

test("a free device profile consumes one successful generation per JST day", async () => {
  const harness = createHarness();
  const first = await reserveAiGeneration(deviceRequest(uuid(1)), harness.env, harness.services);
  assert.equal(first.status, "reserved");
  assert.equal(first.quota.dailyLimit, 1);
  assert.equal(first.quota.remaining, 0);

  const completed = await completeAiGeneration(
    { reservationId: first.reservationId },
    harness.env,
    harness.services,
  );
  assert.equal(completed.status, "completed");
  assert.equal(completed.quota.successful, 1);

  const second = await reserveAiGeneration(deviceRequest(uuid(2)), harness.env, harness.services);
  assert.equal(second.status, "limit_reached");
  assert.equal(second.error, "daily_limit_reached");
});

test("Free can reserve gentle analysis only, while active Plus can reserve detailed analysis", async () => {
  const freeHarness = createHarness({ plusActive: false });
  const freeDeep = await reserveAiGeneration({
    credential: { kind: "account", token: ACCOUNT_TOKEN },
    requestId: uuid(7),
    analysisMode: "deep",
  }, freeHarness.env, freeHarness.services);
  assert.deepEqual(freeDeep, {
    ok: false,
    status: "error",
    error: "plus_required",
    retryable: false,
  });
  assert.equal(freeHarness.store.reserveCalls, 0);

  const freeGentle = await reserveAiGeneration({
    credential: { kind: "account", token: ACCOUNT_TOKEN },
    requestId: uuid(8),
    analysisMode: "letter",
  }, freeHarness.env, freeHarness.services);
  assert.equal(freeGentle.status, "reserved");
  assert.equal(freeGentle.quota.tier, "free");

  const plusHarness = createHarness({ plusActive: true });
  const plusDeep = await reserveAiGeneration(accountRequest(uuid(9)), plusHarness.env, plusHarness.services);
  assert.equal(plusDeep.status, "reserved");
  assert.equal(plusDeep.quota.tier, "plus");
});

test("provider and quality failures release a reservation without consuming quota", async () => {
  for (const reasonCode of ["provider_error", "quality_failed", "generation_incomplete"]) {
    const harness = createHarness();
    const first = await reserveAiGeneration(deviceRequest(uuid(10)), harness.env, harness.services);
    const released = await releaseAiGeneration(
      { reservationId: first.reservationId, reasonCode },
      harness.env,
      harness.services,
    );
    assert.equal(released.status, "released");
    assert.equal(released.quota.successful, 0);
    assert.equal(released.quota.remaining, 1);

    const retry = await reserveAiGeneration(deviceRequest(uuid(11)), harness.env, harness.services);
    assert.equal(retry.status, "reserved");
  }
});

test("client-provided tier is rejected before the entitlement resolver or store", async () => {
  const harness = createHarness();
  const result = await reserveAiGeneration(
    deviceRequest(uuid(20), { tier: "plus" }),
    harness.env,
    harness.services,
  );
  assert.equal(result.error, "invalid_request");
  assert.equal(harness.entitlementCalls(), 0);
  assert.equal(harness.store.reserveCalls, 0);
});

test("only the trusted entitlement resolver can grant the five-success Plus limit", async () => {
  const harness = createHarness({ plusActive: true });
  for (let index = 0; index < 5; index += 1) {
    const reserved = await reserveAiGeneration(
      accountRequest(uuid(100 + index)),
      harness.env,
      harness.services,
    );
    assert.equal(reserved.status, "reserved");
    assert.equal(reserved.quota.tier, "plus");
    assert.equal(reserved.quota.dailyLimit, 5);
    const completed = await completeAiGeneration(
      { reservationId: reserved.reservationId },
      harness.env,
      harness.services,
    );
    assert.equal(completed.status, "completed");
  }

  const sixth = await reserveAiGeneration(accountRequest(uuid(106)), harness.env, harness.services);
  assert.equal(sixth.status, "limit_reached");
  assert.equal(sixth.quota.successful, 5);
  assert.equal(harness.entitlementCalls(), 6);
});

test("an inactive Plus account gets the free limit and resolver failure fails closed", async () => {
  const freeHarness = createHarness({ plusActive: false });
  const free = await reserveAiGeneration(
    { ...accountRequest(uuid(200)), analysisMode: "letter" },
    freeHarness.env,
    freeHarness.services,
  );
  assert.equal(free.quota.tier, "free");
  assert.equal(free.quota.dailyLimit, 1);

  const invalidHarness = createHarness({ entitlementStatus: "invalid_session" });
  const invalid = await reserveAiGeneration(
    accountRequest(uuid(201)),
    invalidHarness.env,
    invalidHarness.services,
  );
  assert.equal(invalid.error, "authentication_required");

  const unavailableHarness = createHarness({ entitlementStatus: "unavailable" });
  const unavailable = await reserveAiGeneration(
    accountRequest(uuid(202)),
    unavailableHarness.env,
    unavailableHarness.services,
  );
  assert.equal(unavailable.error, "entitlement_unavailable");
  assert.equal(unavailable.retryable, true);
});

test("concurrent reservations cannot exceed the free or Plus capacity", async () => {
  const freeHarness = createHarness();
  const freeResults = await Promise.all([
    reserveAiGeneration(deviceRequest(uuid(300)), freeHarness.env, freeHarness.services),
    reserveAiGeneration(deviceRequest(uuid(301)), freeHarness.env, freeHarness.services),
  ]);
  assert.deepEqual(
    freeResults.map((result) => result.status).sort(),
    ["limit_reached", "reserved"],
  );

  const plusHarness = createHarness({ plusActive: true });
  const plusResults = await Promise.all(
    Array.from({ length: 6 }, (_, index) => reserveAiGeneration(
      accountRequest(uuid(400 + index)),
      plusHarness.env,
      plusHarness.services,
    )),
  );
  assert.equal(plusResults.filter((result) => result.status === "reserved").length, 5);
  assert.equal(plusResults.filter((result) => result.status === "limit_reached").length, 1);
});

test("duplicate reserve and complete calls are idempotent", async () => {
  const harness = createHarness();
  const request = deviceRequest(uuid(500));
  const first = await reserveAiGeneration(request, harness.env, harness.services);
  const duplicate = await reserveAiGeneration(request, harness.env, harness.services);
  assert.equal(duplicate.status, "in_progress");

  const completed = await completeAiGeneration(
    { reservationId: first.reservationId },
    harness.env,
    harness.services,
  );
  const repeated = await completeAiGeneration(
    { reservationId: first.reservationId },
    harness.env,
    harness.services,
  );
  assert.equal(completed.status, "completed");
  assert.equal(repeated.status, "already_succeeded");
  assert.equal(repeated.quota.successful, 1);
});

test("expired reservations stop blocking capacity and cannot be completed", async () => {
  const harness = createHarness();
  const first = await reserveAiGeneration(deviceRequest(uuid(600)), harness.env, harness.services);
  harness.setNow(NOW + 601_000);

  const expired = await completeAiGeneration(
    { reservationId: first.reservationId },
    harness.env,
    harness.services,
  );
  assert.equal(expired.status, "expired");
  assert.equal(expired.quota.successful, 0);

  const replacement = await reserveAiGeneration(
    deviceRequest(uuid(601)),
    harness.env,
    harness.services,
  );
  assert.equal(replacement.status, "reserved");
});

test("aggregate totals count only completed attempts and cleanup uses retention settings", async () => {
  const harness = createHarness();
  const first = await reserveAiGeneration(deviceRequest(uuid(700)), harness.env, harness.services);
  await completeAiGeneration(
    { reservationId: first.reservationId },
    harness.env,
    harness.services,
  );
  const aggregate = await getAggregateAiUsage(harness.env, harness.services);
  assert.equal(aggregate.today.successCount, 1);
  assert.equal(aggregate.today.freeSuccessCount, 1);
  assert.equal(aggregate.today.plusSuccessCount, 0);

  const cleanup = await runAiQuotaCleanup(
    harness.store,
    {
      AI_PER_USER_QUOTA_ENABLED: "true",
      AI_QUOTA_RETENTION_DAYS: "1",
      AI_QUOTA_TIMEZONE_OFFSET_HOURS: "9",
    },
    NOW + 2 * 24 * 60 * 60 * 1000,
  );
  assert.deepEqual(cleanup, { attemptsDeleted: 1, daysDeleted: 1 });
});
