import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createEmailLookupHmac,
  createVerificationCodeHmac,
  normalizeEmailAddress,
} from "../src/account-auth-crypto.js";
import {
  AccountAuthError,
  createAccountAuthService,
} from "../src/account-auth-core.js";
import { handleAccountAuthRequest } from "../src/account-auth-http.js";
import { createD1AccountAuthStore } from "../src/account-auth-store.js";
import { verifyAccountTurnstile } from "../src/account-auth-turnstile.js";
import { hashSessionToken } from "../src/credentials.js";

const NOW = Date.parse("2026-08-15T03:00:00.000Z");
const ORIGIN = "https://afterglow21.github.io";
const EMAIL_SECRET = "email-lookup-secret-for-local-tests-0001";
const NEW_EMAIL_SECRET = "email-lookup-secret-for-local-tests-0002";
const CODE_SECRET = "verification-code-secret-local-tests-0001";
const EMAIL = "family@example.com";
const ACCOUNT_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
];
const CHALLENGE_IDS = [
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6",
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7",
];
const SESSION_IDS = [
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
];
const SESSION_TOKENS = ["A".repeat(43), "B".repeat(43)];
const VERIFICATION_GRANTS = [
  "C".repeat(43),
  "D".repeat(43),
  "E".repeat(43),
  "F".repeat(43),
  "G".repeat(43),
  "H".repeat(43),
  "I".repeat(43),
];

const ENABLED_ENV = Object.freeze({
  PLUS_ACCOUNT_AUTH_HTTP_ENABLED: "true",
  ACCOUNT_AUTH_ALLOWED_ORIGIN: ORIGIN,
  ACCOUNT_AUTH_EXPECTED_HOSTNAME: "afterglow21.github.io",
  ACCOUNT_AUTH_REQUEST_CODE_ACTION: "glucoscope-plus-request-code",
  ACCOUNT_AUTH_DELETE_ACTION: "glucoscope-plus-delete-account",
  ACCOUNT_EMAIL_LOOKUP_HMAC_KEY: EMAIL_SECRET,
  ACCOUNT_CODE_HMAC_KEY: CODE_SECRET,
  ACCOUNT_AUTH_CODE_TTL_SECONDS: "600",
  ACCOUNT_AUTH_CODE_ATTEMPTS: "5",
  ACCOUNT_AUTH_RESEND_SECONDS: "60",
  ACCOUNT_AUTH_MAX_SENDS_PER_HOUR: "5",
  ACCOUNT_AUTH_SESSION_TTL_DAYS: "90",
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
  for (const migration of [
    "../migrations/0001_initial_plus_entitlement_schema.sql",
    "../migrations/0002_account_auth.sql",
    "../migrations/0003_stripe_checkout_state.sql",
  ]) {
    database.raw.exec(readFileSync(new URL(migration, import.meta.url), "utf8"));
  }
  return database;
}

function createDeterministicDependencies(store, clock, delivered) {
  const challenges = [...CHALLENGE_IDS];
  const codes = ["123456", "234567", "345678", "456789", "567890", "678901", "789012"];
  const sessions = [...SESSION_IDS];
  const tokens = [...SESSION_TOKENS];
  const accounts = [...ACCOUNT_IDS];
  const grants = [...VERIFICATION_GRANTS];
  return {
    store,
    now: () => clock.value,
    emailAdapter: {
      async sendAccountCode(message) {
        delivered.push(message);
        return { accepted: true };
      },
    },
    async createVerificationChallengeCredentials({ codeHmacSecret, cryptoImpl }) {
      const challengeId = challenges.shift();
      const code = codes.shift();
      const verificationGrant = grants.shift();
      return {
        challengeId,
        code,
        codeHmac: await createVerificationCodeHmac(
          challengeId,
          code,
          codeHmacSecret,
          cryptoImpl,
        ),
        verificationGrant,
        verificationGrantHash: await hashSessionToken(
          verificationGrant,
          cryptoImpl,
        ),
      };
    },
    async createSessionCredentials() {
      const id = sessions.shift();
      const sessionToken = tokens.shift();
      return {
        id,
        sessionToken,
        tokenHash: await hashSessionToken(sessionToken),
      };
    },
    crypto: {
      subtle: crypto.subtle,
      getRandomValues: crypto.getRandomValues.bind(crypto),
      randomUUID() {
        const id = accounts.shift();
        if (!id) throw new Error("test account IDs exhausted");
        return id;
      },
    },
  };
}

function assertAuthError(code, status) {
  return (error) => error instanceof AccountAuthError
    && error.code === code
    && error.status === status;
}

test("checked-in auth configuration is disabled and contains no runtime bindings or Secrets", () => {
  const config = JSON.parse(readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  ));
  assert.equal(config.vars.PLUS_ACCOUNT_AUTH_HTTP_ENABLED, "false");
  assert.equal(config.vars.ACCOUNT_AUTH_ALLOWED_ORIGIN, ORIGIN);
  assert.equal(
    config.vars.ACCOUNT_AUTH_REQUEST_CODE_ACTION,
    "glucoscope-plus-request-code",
  );
  assert.equal(
    config.vars.ACCOUNT_AUTH_DELETE_ACTION,
    "glucoscope-plus-delete-account",
  );
  assert.equal("ACCOUNT_AUTH_VERIFY_ACTION" in config.vars, false);
  assert.equal("ACCOUNT_EMAIL_LOOKUP_HMAC_PREVIOUS_KEY" in config.vars, false);
  assert.equal("d1_databases" in config, false);
  assert.equal("services" in config, false);
  assert.equal("secrets" in config, false);
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(
    serialized,
    /ACCOUNT_(?:EMAIL_LOOKUP_HMAC_(?:KEY|PREVIOUS_KEY)|CODE_HMAC_KEY|EMAIL_ADAPTER)|TURNSTILE_SECRET_KEY/u,
  );
});

test("auth migration enforces non-recoverable email storage", (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const migration = readFileSync(
    new URL("../migrations/0002_account_auth.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /email-not-stored-v1/u);
  assert.match(migration, /accounts_reject_email_ciphertext_insert/u);
  assert.match(migration, /CREATE TABLE account_auth_challenges/u);
  assert.doesNotMatch(migration, /email_address|plaintext_email|raw_email/iu);
  assert.throws(() => database.raw.prepare(`
    INSERT INTO accounts (
      id, email_lookup_hmac, email_ciphertext, email_key_version,
      email_verified_at, status, created_at, updated_at
    ) VALUES (
      '99999999-9999-4999-8999-999999999999', ?1,
      'person@example.com', 1, ?2, 'active', ?2, ?2
    )
  `).run("z".repeat(43), NOW), /recoverable email storage is disabled/u);
});

test("email normalization and HMAC lookup are stable without storing a recoverable address", async () => {
  assert.equal(normalizeEmailAddress("  Family@Example.COM  "), "Family@example.com");
  assert.equal(normalizeEmailAddress("  family@Example.COM  "), EMAIL);
  assert.equal(
    normalizeEmailAddress("User@例え.テスト"),
    "User@xn--r8jz45g.xn--zckzah",
  );
  assert.equal(
    normalizeEmailAddress("User@XN--R8JZ45G.XN--ZCKZAH"),
    "User@xn--r8jz45g.xn--zckzah",
  );
  assert.equal(normalizeEmailAddress("not-an-email"), null);
  assert.equal(normalizeEmailAddress("a..b@example.com"), null);
  const first = await createEmailLookupHmac(EMAIL, EMAIL_SECRET);
  const second = await createEmailLookupHmac(EMAIL, EMAIL_SECRET);
  assert.equal(first, second);
  assert.notEqual(
    await createEmailLookupHmac("Family@example.com", EMAIL_SECRET),
    first,
    "the potentially case-sensitive local part must not be rewritten",
  );
  assert.match(first, /^[A-Za-z0-9_-]{43}$/u);
  assert.doesNotMatch(first, /family|example/iu);
});

test("checked-in auth flag fails before reading inputs, adapters, Secrets, or D1", async () => {
  let touched = false;
  const guarded = new Proxy({}, {
    get() {
      touched = true;
      throw new Error("must remain untouched");
    },
  });
  const service = createAccountAuthService({
    PLUS_ACCOUNT_AUTH_HTTP_ENABLED: "false",
  }, {
    store: guarded,
    emailAdapter: guarded,
  });
  await assert.rejects(
    service.requestCode(guarded, { turnstileVerified: true }),
    assertAuthError("service_unavailable", 503),
  );
  assert.equal(touched, false);
});

test("missing or ambiguous email adapter fails closed and never reports code_sent", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const base = {
    store,
    now: () => NOW,
  };
  for (const dependencies of [
    base,
    {
      ...base,
      emailAdapter: { async sendAccountCode() { return {}; } },
    },
  ]) {
    const service = createAccountAuthService(ENABLED_ENV, dependencies);
    await assert.rejects(
      service.requestCode({ email: EMAIL }, { turnstileVerified: true }),
      assertAuthError("service_unavailable", 503),
    );
  }
});

test("real SQLite flow sends a short code, rotates sessions for recovery, and stores no email", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );

  const requested = await service.requestCode({
    email: " family@Example.COM ",
    contactRole: "guardian",
    guardianConfirmed: true,
  }, { turnstileVerified: true });
  assert.deepEqual(requested, {
    ok: true,
    status: "code_sent",
    verificationGrant: VERIFICATION_GRANTS[0],
  });
  assert.deepEqual(delivered[0], {
    destinationEmail: EMAIL,
    code: "123456",
    expiresInMinutes: 10,
    contactRole: "guardian",
    purpose: "sign_in_or_recover",
  });
  await assert.rejects(
    service.requestCode({ email: EMAIL }, { turnstileVerified: true }),
    assertAuthError("please_wait", 429),
  );
  assert.equal(delivered.length, 1);

  const verified = await service.verifyCode({
    email: EMAIL,
    code: "123456",
    verificationGrant: requested.verificationGrant,
  }, { turnstileVerified: true });
  assert.equal(verified.status, "verified");
  assert.equal(verified.sessionToken, SESSION_TOKENS[0]);
  assert.deepEqual(verified.session, {
    status: "ready",
    accountVerified: true,
    plusActive: false,
    purchasePending: false,
    startsAt: null,
    endsAt: null,
    shareStudioTrialAvailable: true,
    issuedAt: NOW,
    expiresAt: NOW + 90 * 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(await service.getSessionStatus(SESSION_TOKENS[0]), {
    ok: true,
    status: "ready",
    accountVerified: true,
    plusActive: false,
    purchasePending: false,
    startsAt: null,
    endsAt: null,
    shareStudioTrialAvailable: true,
  });

  const storedAccount = database.raw.prepare(`
    SELECT email_lookup_hmac, email_ciphertext, email_key_version
    FROM accounts
  `).get();
  assert.equal(storedAccount.email_ciphertext, "email-not-stored-v1");
  assert.equal(Number(storedAccount.email_key_version), 1);
  assert.doesNotMatch(JSON.stringify(storedAccount), /family@example\.com/iu);
  const storedChallenge = database.raw.prepare(`
    SELECT email_lookup_hmac, code_hmac, verification_grant_hash, contact_role
    FROM account_auth_challenges
  `).get();
  assert.match(storedChallenge.email_lookup_hmac, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(storedChallenge.code_hmac, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(storedChallenge.verification_grant_hash, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(storedChallenge.verification_grant_hash, requested.verificationGrant);
  assert.doesNotMatch(JSON.stringify(storedChallenge), /family|example|123456/iu);

  clock.value += 61_000;
  const recoveryRequest = await service.requestCode({ email: EMAIL }, {
    turnstileVerified: true,
  });
  assert.deepEqual(recoveryRequest, {
    ok: true,
    status: "code_sent",
    verificationGrant: VERIFICATION_GRANTS[2],
  });
  const recovered = await service.verifyCode({
    email: EMAIL,
    code: delivered[1].code,
    verificationGrant: recoveryRequest.verificationGrant,
  }, { turnstileVerified: true });
  assert.equal(recovered.sessionToken, SESSION_TOKENS[1]);
  assert.equal(await service.getSessionStatus(SESSION_TOKENS[0]), null);
  assert.equal((await service.getSessionStatus(SESSION_TOKENS[1])).status, "ready");

  assert.deepEqual(await service.logout(SESSION_TOKENS[1]), {
    ok: true,
    status: "signed_out",
  });
  assert.equal(await service.getSessionStatus(SESSION_TOKENS[1]), null);
  assert.deepEqual(await service.logout("malformed"), {
    ok: true,
    status: "signed_out",
  });
});

test("email HMAC rotation atomically rekeys the same Plus account without losing its entitlement", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const oldEmailHmac = await createEmailLookupHmac(EMAIL, EMAIL_SECRET);
  const newEmailHmac = await createEmailLookupHmac(EMAIL, NEW_EMAIL_SECRET);
  const entitlementStartsAt = NOW - 60_000;
  const entitlementEndsAt = entitlementStartsAt + 30 * 24 * 60 * 60 * 1000;
  database.raw.prepare(`
    INSERT INTO accounts (
      id, email_lookup_hmac, email_ciphertext, email_key_version,
      email_verified_at, status, created_at, updated_at
    ) VALUES (?1, ?2, 'email-not-stored-v1', 1, ?3, 'active', ?3, ?3)
  `).run(ACCOUNT_IDS[0], oldEmailHmac, NOW - 120_000);
  database.raw.prepare(`
    INSERT INTO share_trial_state (account_id, updated_at) VALUES (?1, ?2)
  `).run(ACCOUNT_IDS[0], NOW - 120_000);
  database.raw.prepare(`
    INSERT INTO processed_webhook_events (
      event_id, checkout_session_id, event_type, account_id, amount_jpy,
      currency, paid_at, outcome, received_at, processed_at
    ) VALUES (
      'evt_rotation_receipt', 'cs_test_rotation123456',
      'checkout.session.completed', ?1, 300, 'jpy', ?2,
      'granted', ?2, ?2
    )
  `).run(ACCOUNT_IDS[0], entitlementStartsAt);
  database.raw.prepare(`
    INSERT INTO entitlements (
      id, account_id, product_code, purchase_kind, amount_jpy, currency,
      starts_at, ends_at, status, source_event_id, created_at, updated_at
    ) VALUES (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ?1, 'plus_30d',
      'one_time', 300, 'jpy', ?2, ?3, 'granted',
      'evt_rotation_receipt', ?2, ?2
    )
  `).run(ACCOUNT_IDS[0], entitlementStartsAt, entitlementEndsAt);

  const rotatedEnv = {
    ...ENABLED_ENV,
    ACCOUNT_EMAIL_LOOKUP_HMAC_KEY: NEW_EMAIL_SECRET,
    ACCOUNT_EMAIL_HMAC_KEY_VERSION: "2",
    ACCOUNT_EMAIL_LOOKUP_HMAC_PREVIOUS_KEY: EMAIL_SECRET,
    ACCOUNT_EMAIL_PREVIOUS_HMAC_KEY_VERSION: "1",
  };
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    rotatedEnv,
    createDeterministicDependencies(store, clock, delivered),
  );
  const requested = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  const verified = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: requested.verificationGrant,
  });
  assert.equal(verified.session.plusActive, true);
  assert.equal(verified.session.startsAt, entitlementStartsAt);
  assert.equal(verified.session.endsAt, entitlementEndsAt);
  const accounts = database.raw.prepare(`
    SELECT id, email_lookup_hmac, email_key_version FROM accounts
  `).all();
  assert.deepEqual(accounts.map((account) => ({ ...account })), [{
    id: ACCOUNT_IDS[0],
    email_lookup_hmac: newEmailHmac,
    email_key_version: 2,
  }]);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM entitlements WHERE account_id = ?1
  `).get(ACCOUNT_IDS[0]).count), 1);
});

test("email HMAC rotation fails closed for unsafe key configuration or duplicate identities", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };

  for (const unsafeEnv of [
    {
      ...ENABLED_ENV,
      ACCOUNT_EMAIL_LOOKUP_HMAC_KEY: NEW_EMAIL_SECRET,
      ACCOUNT_EMAIL_HMAC_KEY_VERSION: "2",
      ACCOUNT_EMAIL_PREVIOUS_HMAC_KEY_VERSION: "1",
    },
    {
      ...ENABLED_ENV,
      ACCOUNT_EMAIL_LOOKUP_HMAC_KEY: NEW_EMAIL_SECRET,
      ACCOUNT_EMAIL_HMAC_KEY_VERSION: "2",
      ACCOUNT_EMAIL_LOOKUP_HMAC_PREVIOUS_KEY: EMAIL_SECRET,
    },
  ]) {
    const delivered = [];
    const unsafeService = createAccountAuthService(
      unsafeEnv,
      createDeterministicDependencies(store, clock, delivered),
    );
    await assert.rejects(
      unsafeService.requestCode({ email: EMAIL }, { turnstileVerified: true }),
      assertAuthError("service_unavailable", 503),
    );
    assert.equal(delivered.length, 0);
  }

  const oldEmailHmac = await createEmailLookupHmac(EMAIL, EMAIL_SECRET);
  const newEmailHmac = await createEmailLookupHmac(EMAIL, NEW_EMAIL_SECRET);
  for (const [id, hmac, version] of [
    [ACCOUNT_IDS[0], oldEmailHmac, 1],
    [ACCOUNT_IDS[1], newEmailHmac, 2],
  ]) {
    database.raw.prepare(`
      INSERT INTO accounts (
        id, email_lookup_hmac, email_ciphertext, email_key_version,
        email_verified_at, status, created_at, updated_at
      ) VALUES (?1, ?2, 'email-not-stored-v1', ?3, ?4, 'active', ?4, ?4)
    `).run(id, hmac, version, NOW - 60_000);
  }
  const rotatedEnv = {
    ...ENABLED_ENV,
    ACCOUNT_EMAIL_LOOKUP_HMAC_KEY: NEW_EMAIL_SECRET,
    ACCOUNT_EMAIL_HMAC_KEY_VERSION: "2",
    ACCOUNT_EMAIL_LOOKUP_HMAC_PREVIOUS_KEY: EMAIL_SECRET,
    ACCOUNT_EMAIL_PREVIOUS_HMAC_KEY_VERSION: "1",
  };
  const delivered = [];
  const service = createAccountAuthService(
    rotatedEnv,
    createDeterministicDependencies(store, clock, delivered),
  );
  const requested = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  await assert.rejects(
    service.verifyCode({
      email: EMAIL,
      code: delivered[0].code,
      verificationGrant: requested.verificationGrant,
    }),
    assertAuthError("service_unavailable", 503),
  );
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM accounts
  `).get().count), 2);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM sessions
  `).get().count), 0);
});

test("five wrong attempts exhaust the code and all failures stay enumeration-resistant", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );
  const requested = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  await assert.rejects(
    service.verifyCode({ email: EMAIL, code: delivered[0].code }),
    assertAuthError("invalid_or_expired_code", 400),
  );
  await assert.rejects(
    service.verifyCode({
      email: EMAIL,
      code: delivered[0].code,
      verificationGrant: VERIFICATION_GRANTS[1],
    }),
    assertAuthError("invalid_or_expired_code", 400),
  );
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      service.verifyCode({
        email: EMAIL,
        code: "000000",
        verificationGrant: requested.verificationGrant,
      }, {
        turnstileVerified: true,
      }),
      assertAuthError("invalid_or_expired_code", 400),
    );
  }
  const challenge = database.raw.prepare(`
    SELECT attempts_remaining, invalidated_at
    FROM account_auth_challenges
  `).get();
  assert.equal(Number(challenge.attempts_remaining), 0);
  assert.equal(Number(challenge.invalidated_at), NOW);
  await assert.rejects(
    service.verifyCode({
      email: EMAIL,
      code: "123456",
      verificationGrant: requested.verificationGrant,
    }, {
      turnstileVerified: true,
    }),
    assertAuthError("invalid_or_expired_code", 400),
  );
  await assert.rejects(
    service.verifyCode({
      email: "nobody@example.com",
      code: "123456",
      verificationGrant: requested.verificationGrant,
    }, {
      turnstileVerified: true,
    }),
    assertAuthError("invalid_or_expired_code", 400),
  );
});

test("codes expire after ten minutes and sending is capped per HMAC per hour", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );
  const requested = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  clock.value += 10 * 60 * 1000;
  await assert.rejects(
    service.verifyCode({
      email: EMAIL,
      code: delivered[0].code,
      verificationGrant: requested.verificationGrant,
    }),
    assertAuthError("invalid_or_expired_code", 400),
  );

  for (let accepted = 1; accepted < 5; accepted += 1) {
    clock.value += 61_000;
    await service.requestCode({ email: EMAIL }, { turnstileVerified: true });
  }
  clock.value += 61_000;
  await assert.rejects(
    service.requestCode({ email: EMAIL }, { turnstileVerified: true }),
    assertAuthError("please_wait", 429),
  );
  assert.equal(delivered.length, 5);
});

test("guardian email requires an explicit confirmation", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const service = createAccountAuthService(ENABLED_ENV, {
    store: createD1AccountAuthStore(database),
    emailAdapter: { async sendAccountCode() { return { accepted: true }; } },
  });
  await assert.rejects(
    service.requestCode({ email: EMAIL, contactRole: "guardian" }, {
      turnstileVerified: true,
    }),
    assertAuthError("guardian_confirmation_required", 400),
  );
});

test("authenticated deletion removes the account and allows a fresh registration", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );
  const firstRequest = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  const first = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: firstRequest.verificationGrant,
  });

  await assert.rejects(
    service.deleteAccount(first.sessionToken, { confirmDelete: false }, {
      turnstileVerified: true,
    }),
    assertAuthError("deletion_confirmation_required", 400),
  );
  assert.deepEqual(await service.deleteAccount(first.sessionToken, {
    confirmDelete: true,
  }, { turnstileVerified: true }), {
    ok: true,
    status: "account_deleted",
  });
  assert.equal(await service.getSessionStatus(first.sessionToken), null);
  for (const table of [
    "accounts",
    "sessions",
    "share_trial_state",
    "share_trial_operations",
    "account_auth_challenges",
    "processed_checkout_failure_events",
    "processed_checkout_expiry_events",
  ]) {
    const row = database.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    assert.equal(Number(row.count), 0, table);
  }

  clock.value += 61_000;
  const recreateRequest = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  const recreated = await service.verifyCode({
    email: EMAIL,
    code: delivered[1].code,
    verificationGrant: recreateRequest.verificationGrant,
  });
  assert.equal(recreated.status, "verified");
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM accounts
  `).get().count), 1);
  assert.equal(database.raw.prepare("SELECT id FROM accounts").get().id, ACCOUNT_IDS[1]);
});

test("an account with a purchase receipt stays intact and requires private support", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );
  const requested = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  const verified = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: requested.verificationGrant,
  });
  database.raw.prepare(`
    INSERT INTO processed_webhook_events (
      event_id, checkout_session_id, event_type, account_id, amount_jpy,
      currency, paid_at, outcome, received_at, processed_at
    ) VALUES (
      'evt_local_receipt', 'cs_test_1234567890123456',
      'checkout.session.completed', ?1, 300, 'jpy', ?2,
      'pending', ?2, NULL
    )
  `).run(ACCOUNT_IDS[0], NOW);

  await assert.rejects(
    service.deleteAccount(verified.sessionToken, { confirmDelete: true }, {
      turnstileVerified: true,
    }),
    assertAuthError("account_deletion_requires_support", 409),
  );
  const pendingStatus = await service.getSessionStatus(verified.sessionToken);
  assert.equal(pendingStatus.status, "ready");
  assert.equal(pendingStatus.purchasePending, true);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM accounts
  `).get().count), 1);
});

test("an open Checkout attempt blocks deletion before an unresolved payment can be stranded", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );
  const requested = await service.requestCode(
    { email: EMAIL },
    { turnstileVerified: true },
  );
  const verified = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: requested.verificationGrant,
  });
  database.raw.prepare(`
    INSERT INTO checkout_attempts (
      account_id, request_id, state, checkout_session_id, reserved_at,
      reservation_expires_at, checkout_expires_at, completed_at, updated_at
    ) VALUES (
      ?1, 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'open',
      'cs_test_1234567890123456', ?2, ?3, ?4, NULL, ?2
    )
  `).run(ACCOUNT_IDS[0], NOW, NOW + 10 * 60 * 1000, NOW + 24 * 60 * 60 * 1000);

  await assert.rejects(
    service.deleteAccount(verified.sessionToken, { confirmDelete: true }, {
      turnstileVerified: true,
    }),
    assertAuthError("account_deletion_requires_support", 409),
  );
  const pendingStatus = await service.getSessionStatus(verified.sessionToken);
  assert.equal(pendingStatus.status, "ready");
  assert.equal(pendingStatus.purchasePending, true);

  clock.value = NOW + 48 * 60 * 60 * 1000;
  assert.equal(
    (await service.getSessionStatus(verified.sessionToken)).purchasePending,
    true,
    "open remains pending until Stripe reconciliation changes its state",
  );
  database.raw.prepare(`
    UPDATE checkout_attempts SET state = 'expired', updated_at = ?2
    WHERE account_id = ?1 AND state = 'open'
  `).run(ACCOUNT_IDS[0], clock.value);
  assert.equal(
    (await service.getSessionStatus(verified.sessionToken)).purchasePending,
    false,
    "only Stripe-confirmed reconciliation releases an open Checkout",
  );
});

test("HTTP contract enforces exact Origin, bounded JSON, CORS, route methods, and actions", async () => {
  const calls = [];
  const service = {
    async requestCode(payload) {
      calls.push(["requestCode", payload]);
      return {
        ok: true,
        status: "code_sent",
        verificationGrant: VERIFICATION_GRANTS[0],
      };
    },
    async verifyCode(payload) {
      calls.push(["verifyCode", payload]);
      return {
        ok: true,
        status: "verified",
        sessionToken: SESSION_TOKENS[0],
        session: {
          ok: true,
          status: "ready",
          accountVerified: true,
          plusActive: false,
          purchasePending: false,
          startsAt: null,
          endsAt: null,
          shareStudioTrialAvailable: true,
          issuedAt: NOW - 1000,
          expiresAt: NOW,
        },
      };
    },
    async getSessionStatus(token) {
      calls.push(["session", token]);
      return token ? {
        ok: true,
        status: "ready",
        accountVerified: true,
        plusActive: false,
        purchasePending: false,
        startsAt: null,
        endsAt: null,
        shareStudioTrialAvailable: true,
      } : null;
    },
    async logout(token) {
      calls.push(["logout", token]);
      return { ok: true, status: "signed_out" };
    },
    async deleteAccount(token, payload) {
      calls.push(["deleteAccount", token, payload]);
      return { ok: true, status: "account_deleted" };
    },
  };
  const turnstileCalls = [];
  const dependencies = {
    service,
    async verifyTurnstile(input) {
      turnstileCalls.push(input);
      return { verified: true };
    },
  };
  const requestCode = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, turnstileToken: "token-one" }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(requestCode.status, 200);
  assert.equal(requestCode.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(requestCode.headers.get("cache-control"), "no-store");
  assert.deepEqual(await requestCode.json(), {
    ok: true,
    status: "code_sent",
    verificationGrant: VERIFICATION_GRANTS[0],
  });
  assert.equal(turnstileCalls[0].expectedAction, "glucoscope-plus-request-code");
  assert.equal(turnstileCalls[0].expectedHostname, "afterglow21.github.io");

  const verify = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/verify",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: EMAIL,
        code: "123456",
        verificationGrant: VERIFICATION_GRANTS[0],
      }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(verify.status, 200);
  assert.equal(turnstileCalls.length, 1);
  assert.deepEqual(calls[1], ["verifyCode", {
    email: EMAIL,
    code: "123456",
    verificationGrant: VERIFICATION_GRANTS[0],
  }]);

  const session = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/session",
    { headers: { Origin: ORIGIN, Authorization: `Bearer ${SESSION_TOKENS[0]}` } },
  ), ENABLED_ENV, dependencies);
  assert.equal(session.status, 200);
  assert.equal((await session.json()).status, "ready");

  const logout = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/logout",
    {
      method: "POST",
      headers: { Origin: ORIGIN, Authorization: `Bearer ${SESSION_TOKENS[0]}` },
    },
  ), ENABLED_ENV, dependencies);
  assert.deepEqual(await logout.json(), { ok: true, status: "signed_out" });

  const deletion = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/account/delete",
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${SESSION_TOKENS[0]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ turnstileToken: "delete-token", confirmDelete: true }),
    },
  ), ENABLED_ENV, dependencies);
  assert.deepEqual(await deletion.json(), { ok: true, status: "account_deleted" });
  assert.equal(turnstileCalls[1].expectedAction, "glucoscope-plus-delete-account");

  const preflight = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    { method: "OPTIONS", headers: { Origin: ORIGIN } },
  ), ENABLED_ENV, dependencies);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.match(preflight.headers.get("access-control-allow-headers"), /Authorization/u);

  const forbidden = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/session",
    { headers: { Origin: "https://evil.example" } },
  ), ENABLED_ENV, dependencies);
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.headers.get("access-control-allow-origin"), null);

  const tooLarge = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, turnstileToken: "x".repeat(9000) }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(tooLarge.status, 413);
  assert.deepEqual(await tooLarge.json(), { ok: false, error: "request_too_large" });

  const publicGuardianPayload = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: EMAIL,
        turnstileToken: "token-three",
        contactRole: "guardian",
        guardianConfirmed: true,
      }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(publicGuardianPayload.status, 400);
  assert.deepEqual(await publicGuardianPayload.json(), {
    ok: false,
    error: "invalid_request",
  });

  const queryRejected = await handleAccountAuthRequest(new Request(
    `https://worker.invalid/v1/auth/request-code?email=${encodeURIComponent(EMAIL)}`,
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, turnstileToken: "token-four" }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(queryRejected.status, 400);
  assert.deepEqual(await queryRejected.json(), {
    ok: false,
    error: "invalid_request",
  });
});

test("disabled HTTP stays a no-CORS 503 before invoking the service", async () => {
  let touched = false;
  const response = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/session",
    { headers: { Origin: ORIGIN } },
  ), { PLUS_ACCOUNT_AUTH_HTTP_ENABLED: "false" }, {
    service: new Proxy({}, {
      get() {
        touched = true;
        throw new Error("must not run");
      },
    }),
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(touched, false);
});

test("Turnstile verification checks both the exact action and hostname", async () => {
  const base = {
    token: "turnstile-token",
    expectedAction: "glucoscope-plus-delete-account",
    expectedHostname: "afterglow21.github.io",
    env: { TURNSTILE_SECRET_KEY: "turnstile-secret-for-local-tests" },
  };
  const success = await verifyAccountTurnstile(base, async () => new Response(JSON.stringify({
    success: true,
    action: "glucoscope-plus-delete-account",
    hostname: "afterglow21.github.io",
  }), { status: 200 }));
  assert.deepEqual(success, { verified: true });

  for (const result of [
    { success: true, action: "wrong-action", hostname: "afterglow21.github.io" },
    { success: true, action: "glucoscope-plus-delete-account", hostname: "evil.example" },
    { success: false, action: "glucoscope-plus-delete-account", hostname: "afterglow21.github.io" },
  ]) {
    await assert.rejects(
      verifyAccountTurnstile(base, async () => new Response(JSON.stringify(result), {
        status: 200,
      })),
      assertAuthError("turnstile_failed", 403),
    );
  }
});
