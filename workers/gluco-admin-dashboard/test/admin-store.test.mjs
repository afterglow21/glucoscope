import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_USAGE_SELECT,
  adminStoreTesting,
  readAdminUsage,
} from "../src/admin-store.js";

function fakeDatabase(rows, inspectSql = () => {}) {
  return {
    prepare(sql) {
      inspectSql(sql);
      return {
        async all() {
          return { results: rows };
        },
      };
    },
  };
}

test("uses one fixed read-only SELECT against the administrator view", async () => {
  let prepareCount = 0;
  await readAdminUsage(fakeDatabase([], (sql) => {
    prepareCount += 1;
    assert.equal(sql, ADMIN_USAGE_SELECT);
    assert.match(sql, /FROM admin_device_usage/u);
    assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/iu);
    assert.doesNotMatch(sql, /\b(?:profile_id|created_at|day)\s+AS\b/iu);
    assert.match(sql, /last_seen_at AS lastSeenAt/iu);
  }));
  assert.equal(prepareCount, 1);
});

test("allowlists the last-seen timestamp while dropping identifiers and daily data", async () => {
  const report = await readAdminUsage(fakeDatabase([{
    displayName: "グルコさん",
    collectionEnabled: 1,
    activeDays: 4,
    aiGenerationSuccessTotal: 2,
    ordinaryGlucoMemoryCount: 12,
    lastSeenAt: Date.parse("2026-08-14T01:02:03.000Z"),
    profile_id: "must-not-escape",
    created_at: 123,
    last_seen_at: 456,
    day: "2026-08-14",
  }]));

  assert.deepEqual(report, {
    profiles: [{
      displayName: "グルコさん",
      collectionEnabled: true,
      activeDays: 4,
      aiGenerationSuccessTotal: 2,
      ordinaryGlucoMemoryCount: 12,
      lastSeenAt: Date.parse("2026-08-14T01:02:03.000Z"),
    }],
    truncated: false,
  });
  assert.equal(JSON.stringify(report).includes("must-not-escape"), false);
  assert.equal(JSON.stringify(report).includes("2026-08-14"), false);
  assert.equal(report.profiles[0].lastSeenAt, Date.parse("2026-08-14T01:02:03.000Z"));
});

test("normalizes repeated names but keeps every device-profile row separate", async () => {
  const report = await readAdminUsage(fakeDatabase([
    {
      displayName: "  カズマ  ",
      collectionEnabled: 1,
      activeDays: 2,
      aiGenerationSuccessTotal: 1,
      ordinaryGlucoMemoryCount: 4,
      lastSeenAt: 100,
    },
    {
      displayName: "カズマ",
      collectionEnabled: 0,
      activeDays: 9,
      aiGenerationSuccessTotal: 10,
      ordinaryGlucoMemoryCount: 11,
      lastSeenAt: 200,
    },
  ]));

  assert.deepEqual(report.profiles, [
    {
      displayName: "カズマ",
      collectionEnabled: true,
      activeDays: 2,
      aiGenerationSuccessTotal: 1,
      ordinaryGlucoMemoryCount: 4,
      lastSeenAt: 100,
    },
    {
      displayName: "カズマ",
      collectionEnabled: false,
      activeDays: 9,
      aiGenerationSuccessTotal: 10,
      ordinaryGlucoMemoryCount: 11,
      lastSeenAt: 200,
    },
  ]);
});

test("shows at most 100 device profiles", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    displayName: `端末 ${index + 1}`,
    collectionEnabled: 1,
    activeDays: 1,
    aiGenerationSuccessTotal: 0,
    ordinaryGlucoMemoryCount: 0,
    lastSeenAt: index,
  }));
  const report = await readAdminUsage(fakeDatabase(rows));
  assert.equal(report.profiles.length, adminStoreTesting.MAX_VISIBLE_PROFILES);
  assert.equal(report.truncated, true);
});
