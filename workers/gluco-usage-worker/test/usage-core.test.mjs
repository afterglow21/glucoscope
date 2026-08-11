import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  handleUsageRequest,
  normalizeDisplayName,
  runUsageCleanup,
  UsageApiError,
} from "../src/usage-core.js";
import { verifyTurnstileToken } from "../src/turnstile.js";

const ORIGIN = "https://afterglow21.github.io";
const NOW = Date.parse("2026-08-11T03:00:00.000Z");
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_TOKEN = "A".repeat(43);
const PROFILE_TOKEN_HASH = "h".repeat(43);
const TURNSTILE_TOKEN = "turnstile-test-token";
const TURNSTILE_SECRET = "test-only-turnstile-secret";

const ENABLED_ENV = Object.freeze({
  USAGE_COLLECTION_ENABLED: "true",
  USAGE_NOTICE_VERSION: "2026-08-11",
  USAGE_TIMEZONE_OFFSET_HOURS: "9",
  CORS_ALLOWED_ORIGIN: ORIGIN,
  MAX_REQUEST_BYTES: "8192",
  MAX_EVENTS_PER_REQUEST: "20",
  PROFILE_DAILY_REQUEST_LIMIT: "250",
  AI_GENERATION_SUCCESS_DAILY_LIMIT: "30",
  DAILY_USAGE_RETENTION_DAYS: "90",
  EVENT_RECEIPT_RETENTION_DAYS: "7",
  INACTIVE_PROFILE_RETENTION_DAYS: "90",
});

function turnstileEnv(overrides = {}) {
  return {
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    TURNSTILE_EXPECTED_HOSTNAME: "afterglow21.github.io",
    TURNSTILE_EXPECTED_ACTION: "glucoscope-usage-profile",
    TURNSTILE_TIMEOUT_MS: "100",
    ...overrides,
  };
}

function eventId(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

class FakeD1UsageStore {
  constructor() {
    this.profiles = new Map();
    this.profileIdsByTokenHash = new Map();
    this.daily = new Map();
    this.receipts = new Map();
    this.createCalls = 0;
    this.cleanupCalls = [];
  }

  async createProfile({ id, tokenHash, displayName, noticeVersion, day, now }) {
    this.createCalls += 1;
    const profile = {
      id,
      tokenHash,
      displayName,
      collectionEnabled: true,
      noticeVersion,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      requestDay: day,
      requestCount: 0,
    };
    this.profiles.set(id, profile);
    this.profileIdsByTokenHash.set(tokenHash, id);
    return { ...profile };
  }

  async authenticate({ tokenHash, day, now, requestLimit, consumeRequest }) {
    const id = this.profileIdsByTokenHash.get(tokenHash);
    const profile = this.profiles.get(id);
    if (!profile) return { status: "not_found" };
    if (consumeRequest) {
      if (profile.requestDay !== day) {
        profile.requestDay = day;
        profile.requestCount = 0;
      }
      if (profile.requestCount >= requestLimit) return { status: "rate_limited" };
      profile.requestCount += 1;
    }
    profile.updatedAt = now;
    profile.lastSeenAt = now;
    return { status: "ok", profile: { ...profile } };
  }

  async updateProfile({
    profileId,
    hasDisplayName,
    displayName,
    hasCollectionEnabled,
    collectionEnabled,
    now,
  }) {
    const profile = this.profiles.get(profileId);
    if (hasDisplayName) profile.displayName = displayName;
    if (hasCollectionEnabled) profile.collectionEnabled = collectionEnabled;
    profile.updatedAt = now;
    return { ...profile };
  }

  async recordEvent({ profileId, day, event, now, aiDailyLimit }) {
    const receiptKey = `${profileId}:${event.eventId}`;
    const prior = this.receipts.get(receiptKey);
    if (prior) {
      return {
        eventId: event.eventId,
        type: event.type,
        status: prior === "accepted" ? "duplicate" : prior,
      };
    }

    const dailyKey = `${profileId}:${day}`;
    const daily = this.daily.get(dailyKey) || {
      day,
      visitDayCount: 0,
      aiGenerationSuccessCount: 0,
      ordinaryGlucoMemoryCount: 0,
      updatedAt: now,
    };
    let outcome = "accepted";
    if (event.type === "visit_day") daily.visitDayCount = 1;
    if (event.type === "ordinary_gluco_memory_count") {
      daily.ordinaryGlucoMemoryCount = Math.max(
        daily.ordinaryGlucoMemoryCount,
        event.count,
      );
    }
    if (event.type === "ai_generation_success") {
      if (daily.aiGenerationSuccessCount >= aiDailyLimit) outcome = "daily_limit";
      else daily.aiGenerationSuccessCount += 1;
    }
    daily.updatedAt = now;
    this.daily.set(dailyKey, daily);
    this.receipts.set(receiptKey, outcome);
    return { eventId: event.eventId, type: event.type, status: outcome };
  }

  async exportProfile({ profileId, cutoffDay }) {
    return {
      profile: { ...this.profiles.get(profileId) },
      dailyUsage: [...this.daily.entries()]
        .filter(([key, row]) => key.startsWith(`${profileId}:`) && row.day >= cutoffDay)
        .map(([, row]) => ({
          day: row.day,
          visitDayCount: row.visitDayCount,
          aiGenerationSuccessCount: row.aiGenerationSuccessCount,
          ordinaryGlucoMemoryCount: row.ordinaryGlucoMemoryCount,
        }))
        .sort((left, right) => left.day.localeCompare(right.day)),
    };
  }

  async deleteProfile({ profileId }) {
    const profile = this.profiles.get(profileId);
    this.profiles.delete(profileId);
    if (profile) this.profileIdsByTokenHash.delete(profile.tokenHash);
    for (const key of [...this.daily.keys()]) {
      if (key.startsWith(`${profileId}:`)) this.daily.delete(key);
    }
    for (const key of [...this.receipts.keys()]) {
      if (key.startsWith(`${profileId}:`)) this.receipts.delete(key);
    }
    return { deleted: true };
  }

  async cleanup(cutoffs) {
    this.cleanupCalls.push(cutoffs);
    return { receiptsDeleted: 0, dailyRowsDeleted: 0, profilesDeleted: 0 };
  }
}

function createContext(overrides = {}) {
  const store = overrides.store || new FakeD1UsageStore();
  let turnstileCalls = 0;
  const services = {
    store,
    now: () => NOW,
    verifyTurnstile: async () => {
      turnstileCalls += 1;
      if (overrides.turnstileFailure) throw overrides.turnstileFailure;
      return { ok: true };
    },
    createCredentials: async () => ({
      id: PROFILE_ID,
      bearerToken: PROFILE_TOKEN,
      tokenHash: PROFILE_TOKEN_HASH,
    }),
    hashBearerToken: async (token) => token === PROFILE_TOKEN
      ? PROFILE_TOKEN_HASH
      : "x".repeat(43),
    ...overrides.services,
  };
  return {
    store,
    services,
    getTurnstileCalls: () => turnstileCalls,
  };
}

function request(path, {
  method = "GET",
  body,
  token,
  origin = ORIGIN,
  headers = {},
} = {}) {
  const requestHeaders = new Headers(headers);
  if (origin !== null) requestHeaders.set("Origin", origin);
  if (token) requestHeaders.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) requestHeaders.set("Content-Type", "application/json");
  return new Request(`https://glucoscope-usage.example${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

async function createProfile(context, displayName = "グルコさん") {
  const response = await handleUsageRequest(request("/v1/profiles", {
    method: "POST",
    body: { displayName, turnstileToken: "turnstile-token" },
  }), ENABLED_ENV, context.services);
  assert.equal(response.status, 201);
  return json(response);
}

test("checked-in config is paused and declares D1, cron, privacy settings, and required Secret name", () => {
  const configText = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(configText);
  assert.equal(config.compatibility_date, "2026-08-11");
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.observability.enabled, false);
  assert.equal(config.observability.logs.invocation_logs, false);
  assert.equal(config.vars.USAGE_COLLECTION_ENABLED, "false");
  assert.equal(config.vars.CORS_ALLOWED_ORIGIN, ORIGIN);
  assert.equal(config.vars.CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN, "false");
  assert.deepEqual(config.secrets.required, ["TURNSTILE_SECRET_KEY"]);
  assert.equal(config.d1_databases[0].binding, "USAGE_DB");
  assert.equal(config.d1_databases[0].database_name, "glucoscope-usage");
  assert.match(
    config.d1_databases[0].database_id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  );
  assert.equal(config.triggers.crons.length, 1);
});

test("migration limits the schema and adds a D1-only admin view", () => {
  const migration = readFileSync(
    new URL("../migrations/0001_initial_usage_schema.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CHECK \(length\(display_name\) <= 30\)/u);
  assert.match(migration, /CREATE VIEW admin_device_usage/u);
  assert.match(migration, /ai_generation_success_total/u);
  assert.doesNotMatch(migration, /glucose|nightscout|gluroo|api_secret|user_agent|ip_address/iu);
});

test("Turnstile Siteverify sends only URL-encoded secret and response fields", async () => {
  let seenUrl;
  let seenInit;
  const config = Object.freeze({ marker: "usage-profile" });
  const result = await verifyTurnstileToken({
    token: TURNSTILE_TOKEN,
    env: turnstileEnv(),
    config,
  }, async (url, init) => {
    seenUrl = url;
    seenInit = init;
    return Response.json({
      success: true,
      hostname: "afterglow21.github.io",
      action: "glucoscope-usage-profile",
    });
  });

  assert.deepEqual(result, { ok: true, config });
  assert.equal(seenUrl, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(seenInit.method, "POST");
  assert.deepEqual(seenInit.headers, {
    "Content-Type": "application/x-www-form-urlencoded",
  });
  assert.equal(seenInit.redirect, undefined);
  assert.equal(seenInit.signal instanceof AbortSignal, true);
  assert.equal(seenInit.body instanceof URLSearchParams, true);
  assert.deepEqual([...seenInit.body.entries()], [
    ["secret", TURNSTILE_SECRET],
    ["response", TURNSTILE_TOKEN],
  ]);
});

test("Turnstile Siteverify timeout fails closed", async () => {
  await assert.rejects(
    verifyTurnstileToken({
      token: TURNSTILE_TOKEN,
      env: turnstileEnv({ TURNSTILE_TIMEOUT_MS: "5" }),
      config: {},
    }, async (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    })),
    (error) => {
      assert.equal(error.code, "turnstile_unavailable");
      assert.equal(error.status, 503);
      return true;
    },
  );
});

test("Turnstile Siteverify transport, HTTP, and JSON failures stay closed", async () => {
  const failures = [
    [async () => { throw new TypeError("network detail"); }, "turnstile_unavailable", 503],
    [async () => new Response("provider detail", { status: 503 }), "turnstile_unavailable", 503],
    [async () => new Response("not-json"), "turnstile_failed", 403],
  ];

  for (const [fetchImpl, expectedCode, expectedStatus] of failures) {
    await assert.rejects(
      verifyTurnstileToken({
        token: TURNSTILE_TOKEN,
        env: turnstileEnv(),
        config: {},
      }, fetchImpl),
      (error) => {
        assert.equal(error.code, expectedCode);
        assert.equal(error.status, expectedStatus);
        assert.equal(String(error).includes("network detail"), false);
        assert.equal(String(error).includes("provider detail"), false);
        assert.equal(String(error).includes("not-json"), false);
        return true;
      },
    );
  }
});

test("Turnstile Siteverify rejects missing secrets and verification mismatches", async () => {
  let fetchCalls = 0;
  await assert.rejects(
    verifyTurnstileToken({
      token: TURNSTILE_TOKEN,
      env: turnstileEnv({ TURNSTILE_SECRET_KEY: "short" }),
      config: {},
    }, async () => {
      fetchCalls += 1;
      return Response.json({ success: true });
    }),
    (error) => {
      assert.equal(error.code, "service_unavailable");
      assert.equal(error.status, 503);
      return true;
    },
  );
  assert.equal(fetchCalls, 0);

  const mismatches = [
    { success: false, hostname: "afterglow21.github.io", action: "glucoscope-usage-profile" },
    { success: true, hostname: "other.example", action: "glucoscope-usage-profile" },
    { success: true, hostname: "afterglow21.github.io", action: "other-action" },
  ];
  for (const siteverifyResult of mismatches) {
    await assert.rejects(
      verifyTurnstileToken({
        token: TURNSTILE_TOKEN,
        env: turnstileEnv(),
        config: {},
      }, async () => Response.json(siteverifyResult)),
      (error) => {
        assert.equal(error.code, "turnstile_failed");
        assert.equal(error.status, 403);
        return true;
      },
    );
  }
});

test("global kill switch rejects profile creation before Turnstile or D1", async () => {
  const context = createContext();
  const response = await handleUsageRequest(request("/v1/profiles", {
    method: "POST",
    body: { turnstileToken: "not-used" },
  }), { ...ENABLED_ENV, USAGE_COLLECTION_ENABLED: "false" }, context.services);
  assert.equal(response.status, 503);
  assert.equal((await json(response)).error, "usage_collection_paused");
  assert.equal(context.getTurnstileCalls(), 0);
  assert.equal(context.store.createCalls, 0);
});

test("CORS requires the exact GitHub Pages origin and limits preflight", async () => {
  const context = createContext();
  const missing = await handleUsageRequest(request("/v1/me/export", {
    origin: null,
  }), ENABLED_ENV, context.services);
  assert.equal(missing.status, 403);
  assert.equal(missing.headers.get("access-control-allow-origin"), null);

  const wrong = await handleUsageRequest(request("/v1/me/export", {
    origin: "https://example.com",
  }), ENABLED_ENV, context.services);
  assert.equal(wrong.status, 403);
  assert.equal(wrong.headers.get("access-control-allow-origin"), null);

  const preflight = await handleUsageRequest(request("/v1/events", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization, content-type",
    },
  }), ENABLED_ENV, context.services);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/u);
  assert.equal(preflight.headers.get("cache-control"), "no-store");
  assert.equal(preflight.headers.get("vary"), "Origin");

  const disallowedHeader = await handleUsageRequest(request("/v1/events", {
    method: "OPTIONS",
    headers: {
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "x-private-data",
    },
  }), ENABLED_ENV, context.services);
  assert.equal(disallowedHeader.status, 403);
});

test("profile creation normalizes the optional name and stores only the token hash", async () => {
  const context = createContext();
  const longName = `  グルコ\u0000   ${"🍀".repeat(40)}  `;
  const result = await createProfile(context, longName);
  assert.deepEqual(Object.keys(result).sort(), ["ok", "profile", "profileToken"]);
  assert.deepEqual(result.profile, {
    id: PROFILE_ID,
    displayName: normalizeDisplayName(longName),
    collectionEnabled: true,
  });
  assert.equal(Array.from(result.profile.displayName).length, 30);
  assert.equal(result.profileToken, PROFILE_TOKEN);
  assert.equal(context.getTurnstileCalls(), 1);
  const stored = context.store.profiles.get(PROFILE_ID);
  assert.equal(stored.tokenHash, PROFILE_TOKEN_HASH);
  assert.equal(JSON.stringify(stored).includes(PROFILE_TOKEN), false);
});

test("profile creation rejects unknown fields and oversized bodies", async () => {
  const context = createContext();
  const unknown = await handleUsageRequest(request("/v1/profiles", {
    method: "POST",
    body: { turnstileToken: "token", glucose: 123 },
  }), ENABLED_ENV, context.services);
  assert.equal(unknown.status, 400);
  assert.equal(context.store.createCalls, 0);

  const oversized = await handleUsageRequest(request("/v1/profiles", {
    method: "POST",
    body: { turnstileToken: "x".repeat(8100), displayName: "y".repeat(200) },
  }), ENABLED_ENV, context.services);
  assert.equal(oversized.status, 413);
  assert.equal(context.store.createCalls, 0);
});

test("profile creation fails closed when Turnstile verification fails", async () => {
  const context = createContext({
    turnstileFailure: new UsageApiError("turnstile_failed", 403),
  });
  const response = await handleUsageRequest(request("/v1/profiles", {
    method: "POST",
    body: { turnstileToken: "rejected-token" },
  }), ENABLED_ENV, context.services);
  assert.equal(response.status, 403);
  assert.equal((await json(response)).error, "turnstile_failed");
  assert.equal(context.getTurnstileCalls(), 1);
  assert.equal(context.store.createCalls, 0);
});

test("authentication, PATCH allowlist, and collection stop gate work", async () => {
  const context = createContext();
  await createProfile(context);

  const unauthenticated = await handleUsageRequest(request("/v1/me", {
    method: "PATCH",
    body: { displayName: "no" },
  }), ENABLED_ENV, context.services);
  assert.equal(unauthenticated.status, 401);

  const unknown = await handleUsageRequest(request("/v1/me", {
    method: "PATCH",
    token: PROFILE_TOKEN,
    body: { userId: "not-allowed" },
  }), ENABLED_ENV, context.services);
  assert.equal(unknown.status, 400);

  const stopped = await handleUsageRequest(request("/v1/me", {
    method: "PATCH",
    token: PROFILE_TOKEN,
    body: { displayName: "  新しい  名前  ", collectionEnabled: false },
  }), ENABLED_ENV, context.services);
  assert.equal(stopped.status, 200);
  assert.deepEqual((await json(stopped)).profile, {
    id: PROFILE_ID,
    displayName: "新しい 名前",
    collectionEnabled: false,
  });

  const eventWhileStopped = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events: [{ type: "visit_day", eventId: eventId(1) }] },
  }), ENABLED_ENV, context.services);
  assert.equal(eventWhileStopped.status, 403);
  assert.equal((await json(eventWhileStopped)).error, "usage_collection_stopped");
});

test("global pause blocks resume but never traps stop, export, or deletion behind the event cap", async () => {
  const context = createContext();
  await createProfile(context);
  const stored = context.store.profiles.get(PROFILE_ID);
  stored.requestCount = 250;

  const pausedEnv = { ...ENABLED_ENV, USAGE_COLLECTION_ENABLED: "false" };
  const resume = await handleUsageRequest(request("/v1/me", {
    method: "PATCH",
    token: PROFILE_TOKEN,
    body: { collectionEnabled: true },
  }), pausedEnv, context.services);
  assert.equal(resume.status, 503);
  assert.equal((await json(resume)).error, "usage_collection_paused");

  const stop = await handleUsageRequest(request("/v1/me", {
    method: "PATCH",
    token: PROFILE_TOKEN,
    body: { collectionEnabled: false },
  }), pausedEnv, context.services);
  assert.equal(stop.status, 200);
  assert.equal((await json(stop)).profile.collectionEnabled, false);

  const exportResponse = await handleUsageRequest(request("/v1/me/export", {
    token: PROFILE_TOKEN,
  }), pausedEnv, context.services);
  assert.equal(exportResponse.status, 200);

  const deletion = await handleUsageRequest(request("/v1/me", {
    method: "DELETE",
    token: PROFILE_TOKEN,
  }), pausedEnv, context.services);
  assert.equal(deletion.status, 200);
  assert.equal(context.store.profiles.size, 0);
});

test("daily request cap applies to event ingestion only", async () => {
  const context = createContext();
  await createProfile(context);
  context.store.profiles.get(PROFILE_ID).requestCount = 250;

  const eventResponse = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events: [{ type: "visit_day", eventId: eventId(250) }] },
  }), ENABLED_ENV, context.services);
  assert.equal(eventResponse.status, 429);
  assert.equal((await json(eventResponse)).error, "rate_limited");

  const stop = await handleUsageRequest(request("/v1/me", {
    method: "PATCH",
    token: PROFILE_TOKEN,
    body: { collectionEnabled: false },
  }), ENABLED_ENV, context.services);
  assert.equal(stop.status, 200);
});

test("events use the fixed body, reject metadata, dedupe, cap AI, and keep memory max", async () => {
  const context = createContext();
  await createProfile(context);

  const invalidMetadata = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events: [{ type: "visit_day", eventId: eventId(1), path: "/private" }] },
  }), ENABLED_ENV, context.services);
  assert.equal(invalidMetadata.status, 400);

  const invalidMemory = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: {
      events: [{
        type: "ordinary_gluco_memory_count",
        eventId: eventId(2),
        count: 51,
      }],
    },
  }), ENABLED_ENV, context.services);
  assert.equal(invalidMemory.status, 400);

  const events = [
    { type: "visit_day", eventId: eventId(3) },
    { type: "ai_generation_success", eventId: eventId(4) },
    { type: "ordinary_gluco_memory_count", eventId: eventId(5), count: 12 },
  ];
  const first = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events },
  }), ENABLED_ENV, context.services);
  assert.equal(first.status, 200);
  assert.deepEqual((await json(first)).results.map((item) => item.status), [
    "accepted",
    "accepted",
    "accepted",
  ]);

  const duplicate = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events },
  }), ENABLED_ENV, context.services);
  assert.deepEqual((await json(duplicate)).results.map((item) => item.status), [
    "duplicate",
    "duplicate",
    "duplicate",
  ]);

  await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: {
      events: [{
        type: "ordinary_gluco_memory_count",
        eventId: eventId(6),
        count: 5,
      }],
    },
  }), ENABLED_ENV, context.services);

  for (let index = 0; index < 29; index += 1) {
    const response = await handleUsageRequest(request("/v1/events", {
      method: "POST",
      token: PROFILE_TOKEN,
      body: {
        events: [{ type: "ai_generation_success", eventId: eventId(100 + index) }],
      },
    }), ENABLED_ENV, context.services);
    assert.equal(response.status, 200);
  }
  const capped = await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events: [{ type: "ai_generation_success", eventId: eventId(200) }] },
  }), ENABLED_ENV, context.services);
  assert.equal((await json(capped)).results[0].status, "daily_limit");

  const daily = [...context.store.daily.values()][0];
  assert.equal(daily.visitDayCount, 1);
  assert.equal(daily.aiGenerationSuccessCount, 30);
  assert.equal(daily.ordinaryGlucoMemoryCount, 12);
});

test("export is allowlisted and DELETE removes the profile and all usage", async () => {
  const context = createContext();
  await createProfile(context, "端末A");
  await handleUsageRequest(request("/v1/events", {
    method: "POST",
    token: PROFILE_TOKEN,
    body: { events: [{ type: "visit_day", eventId: eventId(300) }] },
  }), ENABLED_ENV, context.services);

  const exportResponse = await handleUsageRequest(request("/v1/me/export", {
    token: PROFILE_TOKEN,
  }), ENABLED_ENV, context.services);
  assert.equal(exportResponse.status, 200);
  assert.equal(exportResponse.headers.get("cache-control"), "no-store");
  const exported = await json(exportResponse);
  assert.equal(exported.export.profile.displayName, "端末A");
  assert.equal(exported.export.dailyUsage[0].visitDayCount, 1);
  const serialized = JSON.stringify(exported);
  assert.equal(serialized.includes(PROFILE_TOKEN), false);
  assert.equal(/tokenHash|requestCount|eventId|receipt/iu.test(serialized), false);

  const deletion = await handleUsageRequest(request("/v1/me", {
    method: "DELETE",
    token: PROFILE_TOKEN,
  }), ENABLED_ENV, context.services);
  assert.equal(deletion.status, 200);
  assert.deepEqual(await json(deletion), { ok: true, deleted: true });
  assert.equal(context.store.profiles.size, 0);
  assert.equal(context.store.daily.size, 0);
  assert.equal(context.store.receipts.size, 0);

  const afterDelete = await handleUsageRequest(request("/v1/me/export", {
    token: PROFILE_TOKEN,
  }), ENABLED_ENV, context.services);
  assert.equal(afterDelete.status, 401);
});

test("scheduled cleanup keeps exactly 90 inclusive calendar days and 7-day receipts", async () => {
  const store = new FakeD1UsageStore();
  await runUsageCleanup(store, ENABLED_ENV, NOW);
  assert.equal(store.cleanupCalls.length, 1);
  const cutoffs = store.cleanupCalls[0];
  assert.equal(cutoffs.receiptCutoff, NOW);
  assert.equal(cutoffs.dailyCutoffDay, "2026-05-14");
  assert.equal(cutoffs.inactiveProfileCutoff, NOW - 90 * 24 * 60 * 60 * 1000);
});
