import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  getPublicUsagePeriod,
  publicAggregateTesting,
  readPublicUsageAggregate,
} from "../src/public-aggregate.js";

function fakeDatabase(row) {
  const seen = { sql: "", bindings: [] };
  return {
    seen,
    prepare(sql) {
      seen.sql = sql;
      return {
        bind(...values) {
          seen.bindings = values;
          return { first: async () => row };
        },
      };
    },
  };
}

class SqliteD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new SqliteD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.bindings) || null;
  }
}

class SqliteD1Database {
  constructor(database) {
    this.database = database;
  }

  prepare(sql) {
    return new SqliteD1Statement(this.database, sql);
  }
}

test("public period is the 30 completed JST days ending yesterday", () => {
  const period = getPublicUsagePeriod(Date.parse("2026-08-15T01:00:00.000Z"));
  assert.deepEqual(period, {
    fromDay: "2026-07-16",
    throughDay: "2026-08-14",
    windowDays: 30,
    timezone: "Asia/Tokyo",
  });
});

test("nine contributing profiles suppress all exact totals", async () => {
  const database = fakeDatabase({
    contributing_profiles: 9,
    active_days_total: 90,
    ai_success_total: 45,
    ordinary_memories_total: 72,
  });
  const report = await readPublicUsageAggregate(database, {
    nowMs: Date.parse("2026-08-15T01:00:00.000Z"),
  });

  assert.deepEqual(report, {
    status: "suppressed",
    period: {
      fromDay: "2026-07-16",
      throughDay: "2026-08-14",
      windowDays: 30,
      timezone: "Asia/Tokyo",
    },
    minimumContributors: 10,
  });
  assert.equal(JSON.stringify(report).includes("90"), false);
  assert.deepEqual(database.seen.bindings, ["2026-07-16", "2026-08-14"]);
});

test("ten contributing profiles return only the approved aggregate totals", async () => {
  const database = fakeDatabase({
    contributing_profiles: 10,
    active_days_total: 38,
    ai_success_total: 14,
    ordinary_memories_total: 26,
    display_name: "must not escape",
    profile_id: "must not escape",
  });
  const report = await readPublicUsageAggregate(database, {
    nowMs: Date.parse("2026-08-15T01:00:00.000Z"),
  });

  assert.deepEqual(report.totals, {
    contributingDeviceProfiles: 10,
    activeDays: 38,
    successfulAiAnalyses: 14,
    ordinaryGlucoMemories: 26,
  });
  assert.equal(JSON.stringify(report).includes("display_name"), false);
  assert.equal(JSON.stringify(report).includes("profile_id"), false);
  assert.doesNotMatch(publicAggregateTesting.PUBLIC_AGGREGATE_SQL, /display_name|token_hash|event_receipts/iu);
});

test("aggregate query includes only recording profiles and completed daily activity", () => {
  assert.match(publicAggregateTesting.PUBLIC_AGGREGATE_SQL, /p\.collection_enabled = 1/u);
  assert.match(publicAggregateTesting.PUBLIC_AGGREGATE_SQL, /u\.day BETWEEN \?1 AND \?2/u);
  assert.match(publicAggregateTesting.PUBLIC_AGGREGATE_SQL, /GROUP BY profile_id/u);
});

test("real SQL works on the production 0001-only schema", async (t) => {
  const database = new DatabaseSync(":memory:");
  t.after(() => database.close());
  database.exec(await readFile(
    new URL("../migrations/0001_initial_usage_schema.sql", import.meta.url),
    "utf8",
  ));

  const quotaTable = database.prepare(`
    SELECT name FROM sqlite_schema WHERE name = 'ai_quota_days'
  `).get();
  assert.equal(quotaTable, undefined);

  const insertProfile = database.prepare(`
    INSERT INTO profiles (
      id, token_hash, display_name, collection_enabled, notice_version,
      created_at, updated_at, last_seen_at, request_day, request_count
    ) VALUES (?, ?, '', 1, 'test', 1, 1, 1, '2026-08-14', 0)
  `);
  const insertUsage = database.prepare(`
    INSERT INTO usage_daily (
      profile_id, day, visit_day_count, ai_generation_success_count,
      ordinary_gluco_memory_count, updated_at
    ) VALUES (?, '2026-08-14', 1, ?, 2, 1)
  `);
  for (let index = 1; index <= 10; index += 1) {
    const profileId = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
    insertProfile.run(profileId, String(index).padStart(43, "T"));
    insertUsage.run(profileId, index === 1 ? 3 : 0);
  }
  const report = await readPublicUsageAggregate(new SqliteD1Database(database), {
    nowMs: Date.parse("2026-08-15T01:00:00.000Z"),
  });
  assert.equal(report.status, "available");
  assert.deepEqual(report.totals, {
    contributingDeviceProfiles: 10,
    activeDays: 10,
    successfulAiAnalyses: 3,
    ordinaryGlucoMemories: 20,
  });
  assert.doesNotMatch(publicAggregateTesting.PUBLIC_AGGREGATE_SQL, /ai_quota_days/iu);
});
