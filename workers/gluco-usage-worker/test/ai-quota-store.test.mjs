import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { createD1AiQuotaStore } from "../src/ai-quota-store.js";

const NOW = Date.parse("2026-08-15T03:00:00.000Z");
const PROFILE_ID = "10000000-0000-4000-8000-000000000001";
const TOKEN_HASH = "H".repeat(43);
const SUBJECT_KEY = "S".repeat(43);

function uuid(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
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

  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => {
        const rows = this.database.prepare(statement.sql).all(...statement.bindings);
        const changes = Number(
          this.database.prepare("SELECT changes() AS count").get().count,
        );
        return { success: true, results: rows, meta: { changes } };
      });
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

async function createDatabase() {
  const database = new DatabaseSync(":memory:");
  const initial = await readFile(
    new URL("../migrations/0001_initial_usage_schema.sql", import.meta.url),
    "utf8",
  );
  const quota = await readFile(
    new URL("../migrations/0002_ai_quota.sql", import.meta.url),
    "utf8",
  );
  database.exec(initial);
  database.exec(quota);
  database.prepare(`
    INSERT INTO profiles (
      id, token_hash, display_name, collection_enabled, notice_version,
      created_at, updated_at, last_seen_at, request_day, request_count
    ) VALUES (?, ?, '', 1, 'test', ?, ?, ?, '2026-08-15', 0)
  `).run(PROFILE_ID, TOKEN_HASH, NOW, NOW, NOW);
  return { database, d1: new SqliteD1Database(database) };
}

function reserveInput(number) {
  return {
    subjectKey: SUBJECT_KEY,
    subjectKind: "device_profile",
    deviceProfileId: PROFILE_ID,
    day: "2026-08-15",
    requestId: uuid(number),
    reservationId: uuid(1000 + number),
    tier: "free",
    dailyLimit: 1,
    analysisMode: "letter",
    now: NOW,
    expiresAt: NOW + 600_000,
  };
}

test("D1 reservation transaction admits only one concurrent free request", async (t) => {
  const { database, d1 } = await createDatabase();
  t.after(() => database.close());
  const store = createD1AiQuotaStore(d1);

  const inputs = [reserveInput(1), reserveInput(2)];
  const results = await Promise.all(inputs.map((input) => store.reserve(input)));
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    ["limit_reached", "reserved"],
  );
  assert.equal(
    database.prepare("SELECT COUNT(*) AS count FROM ai_quota_attempts").get().count,
    1,
  );

  const winnerIndex = results.findIndex((result) => result.status === "reserved");
  const completed = await store.complete({
    reservationId: inputs[winnerIndex].reservationId,
    now: NOW + 1_000,
  });
  const repeated = await store.complete({
    reservationId: inputs[winnerIndex].reservationId,
    now: NOW + 2_000,
  });
  assert.equal(completed.status, "completed");
  assert.equal(repeated.status, "already_succeeded");
  assert.equal(repeated.successful, 1);
  assert.equal(
    database.prepare("SELECT success_count AS count FROM ai_quota_days").get().count,
    1,
  );
});

test("failure release preserves the count and device profile deletion cascades quota rows", async (t) => {
  const { database, d1 } = await createDatabase();
  t.after(() => database.close());
  const store = createD1AiQuotaStore(d1);

  const input = reserveInput(10);
  const reserved = await store.reserve(input);
  assert.equal(reserved.status, "reserved");
  const released = await store.release({
    reservationId: input.reservationId,
    reasonCode: "quality_failed",
    now: NOW + 1_000,
  });
  assert.equal(released.status, "released");
  assert.equal(released.successful, 0);
  assert.equal(released.remaining, 1);

  database.prepare("DELETE FROM profiles WHERE id = ?").run(PROFILE_ID);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_quota_days").get().count, 0);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM ai_quota_attempts").get().count, 0);
});

test("account quota stores only a derived subject key, not a session or account identifier", async (t) => {
  const { database, d1 } = await createDatabase();
  t.after(() => database.close());
  const store = createD1AiQuotaStore(d1);
  const accountSubjectKey = "A".repeat(43);

  const result = await store.reserve({
    subjectKey: accountSubjectKey,
    subjectKind: "account",
    deviceProfileId: null,
    day: "2026-08-15",
    requestId: uuid(20),
    reservationId: uuid(1020),
    tier: "plus",
    dailyLimit: 5,
    analysisMode: "deep",
    now: NOW,
    expiresAt: NOW + 600_000,
  });
  assert.equal(result.status, "reserved");
  const row = database.prepare("SELECT * FROM ai_quota_days WHERE subject_key = ?").get(
    accountSubjectKey,
  );
  assert.equal(row.subject_kind, "account");
  assert.equal(row.device_profile_id, null);
  assert.deepEqual(Object.keys(row).sort(), [
    "day",
    "device_profile_id",
    "last_completed_reservation_id",
    "subject_key",
    "subject_kind",
    "success_count",
    "updated_at",
  ]);
});
