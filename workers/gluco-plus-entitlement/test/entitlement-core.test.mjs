import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  PLUS_DURATION_MS,
  PLUS_PRICE_JPY,
} from "../src/constants.js";
import {
  createSessionCredentials,
  hashSessionToken,
} from "../src/credentials.js";
import { createD1PlusEntitlementStore } from "../src/d1-store.js";
import {
  applyVerifiedPlusPayment,
  createPlusEntitlementService,
  createPublicUnavailableResponse,
  PlusEntitlementError,
} from "../src/entitlement-core.js";

const NOW = Date.parse("2026-08-15T03:00:00.000Z");
const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const THIRD_ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_TOKEN = "A".repeat(43);
const SESSION_TOKEN_HASH = "h".repeat(43);
const REQUEST_ONE = "00000000-0000-4000-8000-000000000001";
const REQUEST_TWO = "00000000-0000-4000-8000-000000000002";
const REQUEST_THREE = "00000000-0000-4000-8000-000000000003";
const ENTITLEMENT_ONE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const ENTITLEMENT_TWO = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";
const CHECKOUT_ONE = "cs_test_1111111111111111";
const CHECKOUT_TWO = "cs_test_2222222222222222";
const CHECKOUT_THREE = "cs_test_3333333333333333";
const CHECKOUT_FOUR = "cs_test_4444444444444444";
const CHECKOUT_FIVE = "cs_test_5555555555555555";
const CHECKOUT_SIX = "cs_test_6666666666666666";
const CHECKOUT_SEVEN = "cs_test_7777777777777777";
const ENABLED_ENV = Object.freeze({
  PLUS_ENTITLEMENT_RPC_ENABLED: "true",
  PLUS_PURCHASES_ENABLED: "false",
  SHARE_TRIAL_RESERVATION_TTL_SECONDS: "600",
});

class NodeD1Statement {
  constructor(database, sql, bindings = []) {
    this.database = database;
    this.sql = sql;
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new NodeD1Statement(this.database, this.sql, bindings);
  }

  async first() {
    return this.database.raw.prepare(this.sql).get(...this.bindings) || null;
  }

  async all() {
    return { results: this.database.raw.prepare(this.sql).all(...this.bindings) };
  }

  async run() {
    const result = this.database.raw.prepare(this.sql).run(...this.bindings);
    return { meta: { changes: Number(result.changes) } };
  }

  executeForBatch() {
    const statement = this.database.raw.prepare(this.sql);
    const returnsRows = /^\s*(?:SELECT|WITH)\b/iu.test(this.sql)
      || /\bRETURNING\b/iu.test(this.sql);
    if (returnsRows) {
      const results = statement.all(...this.bindings);
      const changes = Number(
        this.database.raw.prepare("SELECT changes() AS count").get().count,
      );
      return { results, meta: { changes } };
    }
    const result = statement.run(...this.bindings);
    return { results: [], meta: { changes: Number(result.changes) } };
  }
}

class NodeD1Database {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new NodeD1Statement(this, sql);
  }

  async batch(statements) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map((statement) => statement.executeForBatch());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.raw.close();
  }
}

function createDatabase() {
  const database = new NodeD1Database();
  for (const migrationName of [
    "0001_initial_plus_entitlement_schema.sql",
    "0002_account_auth.sql",
    "0003_stripe_checkout_state.sql",
    "0004_guardian_buyer_confirmation.sql",
  ]) {
    const migration = readFileSync(
      new URL(`../migrations/${migrationName}`, import.meta.url),
      "utf8",
    );
    database.raw.exec(migration);
  }
  return database;
}

async function createAccountAndSession(store, {
  accountId = ACCOUNT_ID,
  sessionId = SESSION_ID,
  tokenHash = SESSION_TOKEN_HASH,
  marker = "one",
  now = NOW,
} = {}) {
  await store.createAccount({
    id: accountId,
    emailLookupHmac: marker.padEnd(43, marker.slice(0, 1) || "x").slice(0, 43),
    emailCiphertext: `encrypted-email-${marker}`.padEnd(24, "x"),
    emailKeyVersion: 1,
    verifiedAt: now,
    now,
  });
  await store.createSession({
    id: sessionId,
    accountId,
    tokenHash,
    createdAt: now,
    expiresAt: now + 180 * 24 * 60 * 60 * 1000,
  });
}

function createService(store, now = NOW, tokenHash = SESSION_TOKEN_HASH) {
  return createPlusEntitlementService(ENABLED_ENV, {
    store,
    now: () => now,
    hashSessionToken: async (token) => token === SESSION_TOKEN
      ? tokenHash
      : "x".repeat(43),
  });
}

function sequentialCrypto(...ids) {
  const remaining = [...ids];
  return {
    randomUUID() {
      const id = remaining.shift();
      if (!id) throw new Error("test UUID sequence exhausted");
      return id;
    },
  };
}

function applyEnabledPayment(input, store, dependencies = {}) {
  return applyVerifiedPlusPayment(input, store, {
    ...dependencies,
    env: { PLUS_PURCHASES_ENABLED: "true" },
  });
}

test("checked-in config is non-public, paused, and has no unprovisioned bindings or Secrets", () => {
  const config = JSON.parse(readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  ));
  assert.equal(config.compatibility_date, "2026-08-15");
  assert.deepEqual(config.compatibility_flags, ["nodejs_compat"]);
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.vars.PLUS_ENTITLEMENT_RPC_ENABLED, "false");
  assert.equal(config.vars.PLUS_PURCHASES_ENABLED, "false");
  assert.equal(config.vars.PLUS_CHECKOUT_HTTP_ENABLED, "false");
  assert.equal(config.vars.PLUS_STRIPE_WEBHOOK_ENABLED, "false");
  assert.equal(config.vars.PLUS_PRICE_JPY, "300");
  assert.equal(config.vars.PLUS_DURATION_DAYS, "30");
  assert.equal("d1_databases" in config, false);
  assert.equal("secrets" in config, false);
  assert.deepEqual(config.observability, { enabled: false });
  const entrypointSource = readFileSync(
    new URL("../src/index.js", import.meta.url),
    "utf8",
  );
  assert.match(
    entrypointSource,
    /class AdminPlusAggregateEntrypoint extends WorkerEntrypoint/u,
  );
});

test("migration fixes one-time JPY 300 entitlements to exactly 30 days and excludes health fields", () => {
  const migration = readFileSync(
    new URL("../migrations/0001_initial_plus_entitlement_schema.sql", import.meta.url),
    "utf8",
  );
  for (const table of [
    "accounts",
    "sessions",
    "processed_webhook_events",
    "entitlements",
    "share_trial_state",
    "share_trial_operations",
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE ${table}\\b`, "u"));
  }
  assert.match(migration, /amount_jpy = 300/u);
  assert.match(migration, /currency = 'jpy'/u);
  assert.match(migration, /purchase_kind = 'one_time'/u);
  assert.match(migration, /ends_at - starts_at = 2592000000/u);
  assert.match(migration, /checkout_session_id TEXT UNIQUE NOT NULL/u);
  assert.doesNotMatch(
    migration,
    /glucose|nightscout|gluroo|dexcom|libre|\btir\b|\btar\b|\btbr\b|\bgmi\b|\bcgm\b/iu,
  );
});

test("public fetch response stays closed without CORS or internal details", async () => {
  const response = createPublicUnavailableResponse();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "service_unavailable",
  });
});

test("session credentials expose a random token once and store only its fixed-size hash", async () => {
  const credentials = await createSessionCredentials();
  assert.match(credentials.id, /^[0-9a-f-]{36}$/u);
  assert.match(credentials.sessionToken, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(credentials.tokenHash, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(credentials.tokenHash, await hashSessionToken(credentials.sessionToken));
  assert.notEqual(credentials.sessionToken, credentials.tokenHash);
});

test("disabled RPC fails before touching tokens or D1", async () => {
  let touched = false;
  const service = createPlusEntitlementService({
    PLUS_ENTITLEMENT_RPC_ENABLED: "false",
  }, {
    store: {
      async getSessionSnapshot() {
        touched = true;
        throw new Error("must not run");
      },
    },
    hashSessionToken: async () => {
      touched = true;
      return SESSION_TOKEN_HASH;
    },
  });
  await assert.rejects(
    service.getActivePlusSummary(SESSION_TOKEN),
    (error) => error instanceof PlusEntitlementError
      && error.code === "plus_entitlement_paused"
      && error.status === 503,
  );
  await assert.rejects(
    service.getAdminActivePlusSummary(),
    (error) => error instanceof PlusEntitlementError
      && error.code === "plus_entitlement_paused"
      && error.status === 503,
  );
  assert.equal(touched, false);
});

test("enabled admin aggregate fails closed while the D1 binding is absent", async () => {
  const service = createPlusEntitlementService(ENABLED_ENV, { now: () => NOW });
  await assert.rejects(
    service.getAdminActivePlusSummary(),
    (error) => error instanceof TypeError
      && error.message === "PLUS_DB binding is unavailable",
  );
});

test("verified payment processing touches nothing unless purchases are explicitly enabled", async () => {
  let inputTouches = 0;
  let storeTouches = 0;
  let clockTouches = 0;
  let uuidTouches = 0;
  const guardedInput = new Proxy({}, {
    get() {
      inputTouches += 1;
      throw new Error("input must stay untouched");
    },
  });
  const guardedStore = new Proxy({}, {
    get() {
      storeTouches += 1;
      throw new Error("store must stay untouched");
    },
  });
  const disabledDependencies = {
    now() {
      clockTouches += 1;
      return NOW;
    },
    crypto: {
      randomUUID() {
        uuidTouches += 1;
        return ENTITLEMENT_ONE;
      },
    },
  };

  for (const env of [undefined, { PLUS_PURCHASES_ENABLED: "false" }]) {
    await assert.rejects(
      applyVerifiedPlusPayment(guardedInput, guardedStore, {
        ...disabledDependencies,
        env,
      }),
      (error) => error instanceof PlusEntitlementError
        && error.code === "plus_purchases_paused"
        && error.status === 503,
    );
  }
  assert.deepEqual({
    inputTouches,
    storeTouches,
    clockTouches,
    uuidTouches,
  }, {
    inputTouches: 0,
    storeTouches: 0,
    clockTouches: 0,
    uuidTouches: 0,
  });

  let writes = 0;
  const enabledResult = await applyVerifiedPlusPayment({
    eventId: "evt_explicitly_enabled",
    checkoutSessionId: CHECKOUT_ONE,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  }, {
    async applyVerifiedPayment() {
      writes += 1;
      return { status: "accepted_for_test" };
    },
  }, {
    env: { PLUS_PURCHASES_ENABLED: "true" },
    now: () => NOW,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });
  assert.deepEqual(enabledResult, { status: "accepted_for_test" });
  assert.equal(writes, 1);
});

test("verified payment grants exactly one 30-day entitlement and deduplicates its event", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);
  const input = {
    eventId: "evt_test_paid_one",
    checkoutSessionId: CHECKOUT_ONE,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: PLUS_PRICE_JPY,
    currency: "jpy",
    paidAt: NOW,
  };
  const first = await applyEnabledPayment(input, store, {
    now: () => NOW + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });
  assert.deepEqual(first, {
    status: "granted",
    entitlement: {
      id: ENTITLEMENT_ONE,
      startsAt: NOW,
      endsAt: NOW + PLUS_DURATION_MS,
    },
  });

  const duplicate = await applyEnabledPayment(input, store, {
    now: () => NOW + 2,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.deepEqual(duplicate, {
    status: "duplicate",
    outcome: "granted",
    entitlement: {
      id: ENTITLEMENT_ONE,
      startsAt: NOW,
      endsAt: NOW + PLUS_DURATION_MS,
    },
  });
  const count = database.raw.prepare("SELECT COUNT(*) AS count FROM entitlements").get();
  assert.equal(Number(count.count), 1);
});

test("Checkout Session identity prevents a second grant across distinct webhook events", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);
  await createAccountAndSession(store, {
    accountId: SECOND_ACCOUNT_ID,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    tokenHash: "j".repeat(43),
    marker: "two",
  });
  const base = {
    checkoutSessionId: CHECKOUT_ONE,
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  };

  const first = await applyEnabledPayment({
    ...base,
    eventId: "evt_checkout_primary",
    eventType: "checkout.session.completed",
  }, store, {
    now: () => NOW + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });
  assert.equal(first.status, "granted");

  const duplicate = await applyEnabledPayment({
    ...base,
    eventId: "evt_checkout_secondary",
    eventType: "checkout.session.async_payment_succeeded",
  }, store, {
    now: () => NOW + 2,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.deepEqual(duplicate, {
    status: "duplicate",
    outcome: "granted",
    entitlement: {
      id: ENTITLEMENT_ONE,
      startsAt: NOW,
      endsAt: NOW + PLUS_DURATION_MS,
    },
  });
  assert.doesNotMatch(JSON.stringify(duplicate), /cs_(?:test|live)_/u);

  const mismatchedSession = await applyEnabledPayment({
    ...base,
    eventId: "evt_checkout_conflict",
    eventType: "checkout.session.async_payment_succeeded",
    accountId: SECOND_ACCOUNT_ID,
  }, store, {
    now: () => NOW + 3,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.deepEqual(mismatchedSession, {
    status: "checkout_session_conflict",
  });

  const mismatchedEvent = await applyEnabledPayment({
    ...base,
    eventId: "evt_checkout_primary",
    checkoutSessionId: CHECKOUT_TWO,
    eventType: "checkout.session.completed",
  }, store, {
    now: () => NOW + 4,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.deepEqual(mismatchedEvent, { status: "event_conflict" });

  const counts = database.raw.prepare(`
    SELECT
      (SELECT COUNT(*) FROM entitlements) AS entitlements,
      (SELECT COUNT(*) FROM processed_webhook_events) AS receipts
  `).get();
  assert.equal(Number(counts.entitlements), 1);
  assert.equal(Number(counts.receipts), 1);
});

test("payment validation rejects the wrong amount, currency, type, or future timestamp before D1", async () => {
  let calls = 0;
  const store = {
    async applyVerifiedPayment() {
      calls += 1;
      return {};
    },
  };
  const base = {
    eventId: "evt_invalid",
    checkoutSessionId: CHECKOUT_ONE,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  };
  const invalid = [
    { ...base, amountJpy: 301 },
    { ...base, currency: "usd" },
    { ...base, eventType: "customer.subscription.created" },
    { ...base, paidAt: NOW + 5 * 60 * 1000 + 1 },
    { ...base, checkoutSessionId: "not-a-checkout-session" },
  ];
  for (const input of invalid) {
    await assert.rejects(
      applyEnabledPayment(input, store, {
        now: () => NOW,
        crypto: sequentialCrypto(ENTITLEMENT_ONE),
      }),
      PlusEntitlementError,
    );
  }
  assert.equal(calls, 0);
});

test("active pass blocks a second event, while an explicit purchase after expiry creates a new pass", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);
  await applyEnabledPayment({
    eventId: "evt_first",
    checkoutSessionId: CHECKOUT_ONE,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  }, store, {
    now: () => NOW + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });

  const activeDuplicatePurchase = await applyEnabledPayment({
    eventId: "evt_second_while_active",
    checkoutSessionId: CHECKOUT_TWO,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW + 1000,
  }, store, {
    now: () => NOW + 1001,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.deepEqual(activeDuplicatePurchase, {
    status: "rejected_overlap",
    entitlement: null,
  });

  const repurchaseAt = NOW + PLUS_DURATION_MS + 1;
  const repurchase = await applyEnabledPayment({
    eventId: "evt_repurchase",
    checkoutSessionId: CHECKOUT_THREE,
    eventType: "checkout.session.async_payment_succeeded",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: repurchaseAt,
  }, store, {
    now: () => repurchaseAt + 1,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.equal(repurchase.status, "granted");
  assert.equal(repurchase.entitlement.startsAt, repurchaseAt);
  assert.equal(repurchase.entitlement.endsAt, repurchaseAt + PLUS_DURATION_MS);
});

test("overlap rejection is independent of webhook arrival order", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);
  const laterStart = NOW + 20 * 24 * 60 * 60 * 1000;

  const laterWindow = await applyEnabledPayment({
    eventId: "evt_later_window_arrived_first",
    checkoutSessionId: CHECKOUT_ONE,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: laterStart,
  }, store, {
    now: () => laterStart + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });
  assert.equal(laterWindow.status, "granted");

  const olderOverlappingWindow = await applyEnabledPayment({
    eventId: "evt_older_window_arrived_second",
    checkoutSessionId: CHECKOUT_TWO,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  }, store, {
    now: () => laterStart + 2,
    crypto: sequentialCrypto(ENTITLEMENT_TWO),
  });
  assert.deepEqual(olderOverlappingWindow, {
    status: "rejected_overlap",
    entitlement: null,
  });
  const entitlementCount = database.raw.prepare(`
    SELECT COUNT(*) AS count FROM entitlements
  `).get();
  assert.equal(Number(entitlementCount.count), 1);
});

test("AI subject and Plus summary return only opaque entitlement facts", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);

  const freeService = createService(store, NOW);
  assert.deepEqual(await freeService.resolveAiSubject(SESSION_TOKEN), {
    status: "ok",
    subjectId: ACCOUNT_ID,
    plusActive: false,
  });
  const freeSummary = await freeService.getActivePlusSummary(SESSION_TOKEN);
  assert.equal(freeSummary.active, false);
  assert.equal(freeSummary.features.aiDailySuccessLimit, 1);
  assert.equal(freeSummary.shareTrial.available, true);
  assert.deepEqual(await freeService.resolveAiSubject("Z".repeat(43)), {
    status: "invalid_session",
  });
  assert.deepEqual(await freeService.resolveAiSubject("malformed"), {
    status: "invalid_session",
  });

  await applyEnabledPayment({
    eventId: "evt_summary",
    checkoutSessionId: CHECKOUT_FOUR,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  }, store, {
    now: () => NOW + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });
  const plusService = createService(store, NOW + 2);
  const subject = await plusService.resolveAiSubject(SESSION_TOKEN);
  assert.deepEqual(subject, {
    status: "ok",
    subjectId: ACCOUNT_ID,
    plusActive: true,
  });
  const summary = await plusService.getActivePlusSummary(SESSION_TOKEN);
  assert.equal(summary.active, true);
  assert.equal(summary.endsAt, NOW + PLUS_DURATION_MS);
  assert.equal(summary.features.customRange, true);
  assert.equal(summary.features.shareStudio, true);
  assert.equal(summary.features.aiDailySuccessLimit, 5);
  const serialized = JSON.stringify({ subject, summary });
  assert.doesNotMatch(serialized, /email|cipher|evt_|stripe|glucose|cgm/iu);

  const expiredSummary = await createService(
    store,
    NOW + PLUS_DURATION_MS,
  ).getActivePlusSummary(SESSION_TOKEN);
  assert.equal(expiredSummary.active, false);
});

test("admin aggregate returns only the distinct active Plus account count", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);
  await createAccountAndSession(store, {
    accountId: SECOND_ACCOUNT_ID,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    tokenHash: "j".repeat(43),
    marker: "two",
  });

  assert.deepEqual(await createService(store).getAdminActivePlusSummary(), {
    activePlusCount: 0,
  });
  await applyEnabledPayment({
    eventId: "evt_admin_aggregate",
    checkoutSessionId: CHECKOUT_FIVE,
    eventType: "checkout.session.completed",
    accountId: SECOND_ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  }, store, {
    now: () => NOW + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });

  const aggregate = await createService(
    store,
    NOW + 2,
  ).getAdminActivePlusSummary();
  assert.deepEqual(aggregate, { activePlusCount: 1 });
  assert.deepEqual(Object.keys(aggregate), ["activePlusCount"]);
  assert.doesNotMatch(
    JSON.stringify(aggregate),
    /account|email|cipher|stripe|event|session|subject/iu,
  );

  const expiredAggregate = await createService(
    store,
    NOW + PLUS_DURATION_MS,
  ).getAdminActivePlusSummary();
  assert.deepEqual(expiredAggregate, { activePlusCount: 0 });
});

test("Share Studio trial consumes only a completed reservation and remains idempotent", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store, {
    accountId: SECOND_ACCOUNT_ID,
    sessionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    tokenHash: "j".repeat(43),
    marker: "two",
  });
  const service = createService(store, NOW, "j".repeat(43));

  const reserved = await service.reserveShareTrial(SESSION_TOKEN, REQUEST_ONE);
  assert.deepEqual(reserved, {
    status: "reserved",
    grant: "trial",
    requestId: REQUEST_ONE,
    reservationExpiresAt: NOW + 10 * 60 * 1000,
  });
  assert.deepEqual(
    await service.reserveShareTrial(SESSION_TOKEN, REQUEST_ONE),
    reserved,
  );
  assert.deepEqual(await service.releaseShareTrial(SESSION_TOKEN, REQUEST_ONE), {
    status: "released",
    requestId: REQUEST_ONE,
  });

  assert.equal(
    (await service.reserveShareTrial(SESSION_TOKEN, REQUEST_TWO)).status,
    "reserved",
  );
  assert.deepEqual(await service.completeShareTrial(SESSION_TOKEN, REQUEST_TWO), {
    status: "completed",
    grant: "trial",
    requestId: REQUEST_TWO,
  });
  assert.deepEqual(await service.completeShareTrial(SESSION_TOKEN, REQUEST_TWO), {
    status: "completed",
    grant: "trial",
    requestId: REQUEST_TWO,
  });
  assert.deepEqual(await service.reserveShareTrial(SESSION_TOKEN, REQUEST_THREE), {
    status: "trial_already_used",
  });
  const summary = await service.getActivePlusSummary(SESSION_TOKEN);
  assert.equal(summary.shareTrial.used, true);
  assert.equal(summary.shareTrial.available, false);
});

test("expired trial reservation releases itself, and active Plus never consumes the trial", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store, {
    accountId: THIRD_ACCOUNT_ID,
    sessionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    tokenHash: "k".repeat(43),
    marker: "three",
  });
  const firstService = createService(store, NOW, "k".repeat(43));
  assert.equal(
    (await firstService.reserveShareTrial(SESSION_TOKEN, REQUEST_ONE)).status,
    "reserved",
  );

  const afterExpiry = createService(
    store,
    NOW + 10 * 60 * 1000,
    "k".repeat(43),
  );
  assert.equal(
    (await afterExpiry.reserveShareTrial(SESSION_TOKEN, REQUEST_TWO)).status,
    "reserved",
  );

  await createAccountAndSession(store);
  await applyEnabledPayment({
    eventId: "evt_plus_trial",
    checkoutSessionId: CHECKOUT_SIX,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW,
  }, store, {
    now: () => NOW + 1,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });
  const plusService = createService(store, NOW + 2);
  assert.deepEqual(await plusService.reserveShareTrial(SESSION_TOKEN, REQUEST_THREE), {
    status: "plus_active",
    grant: "plus",
  });
  const trial = database.raw.prepare(`
    SELECT used_at FROM share_trial_state WHERE account_id = ?
  `).get(ACCOUNT_ID);
  assert.equal(trial.used_at, null);
});

test("a pass activated after trial reservation wins the completion race without consuming trial", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1PlusEntitlementStore(database);
  await createAccountAndSession(store);

  const trialService = createService(store, NOW);
  assert.equal(
    (await trialService.reserveShareTrial(SESSION_TOKEN, REQUEST_ONE)).status,
    "reserved",
  );

  await applyEnabledPayment({
    eventId: "evt_plus_after_reservation",
    checkoutSessionId: CHECKOUT_SEVEN,
    eventType: "checkout.session.completed",
    accountId: ACCOUNT_ID,
    amountJpy: 300,
    currency: "jpy",
    paidAt: NOW + 1,
  }, store, {
    now: () => NOW + 2,
    crypto: sequentialCrypto(ENTITLEMENT_ONE),
  });

  const plusService = createService(store, NOW + 3);
  assert.deepEqual(await plusService.completeShareTrial(SESSION_TOKEN, REQUEST_ONE), {
    status: "plus_active",
    grant: "plus",
  });
  const trial = database.raw.prepare(`
    SELECT used_at FROM share_trial_state WHERE account_id = ?
  `).get(ACCOUNT_ID);
  assert.equal(trial.used_at, null);
});
