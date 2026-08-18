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
import {
  AccountAuthCleanupError,
  runAccountAuthCleanup,
} from "../src/account-auth-cleanup.js";
import { handleAccountAuthRequest } from "../src/account-auth-http.js";
import { enforceAccountAuthRateLimit } from "../src/account-auth-rate-limit.js";
import { createD1AccountAuthStore } from "../src/account-auth-store.js";
import { verifyAccountTurnstile } from "../src/account-auth-turnstile.js";
import { hashSessionToken } from "../src/credentials.js";
import { createD1PlusEntitlementStore } from "../src/d1-store.js";

const NOW = Date.parse("2026-08-15T03:00:00.000Z");
const ORIGIN = "https://glucoscope.app";
const EMAIL_SECRET = "email-lookup-secret-for-local-tests-0001";
const NEW_EMAIL_SECRET = "email-lookup-secret-for-local-tests-0002";
const CODE_SECRET = "verification-code-secret-local-tests-0001";
const EMAIL = "family@example.com";
const ACCOUNT_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
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
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3",
];
const SESSION_TOKENS = ["A".repeat(43), "B".repeat(43), "J".repeat(43)];
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
  ACCOUNT_AUTH_EXPECTED_HOSTNAME: "glucoscope.app",
  ACCOUNT_AUTH_REQUEST_CODE_ACTION: "glucoscope-plus-request-code",
  ACCOUNT_AUTH_DELETE_ACTION: "glucoscope-plus-delete-account",
  ACCOUNT_EMAIL_LOOKUP_HMAC_KEY: EMAIL_SECRET,
  ACCOUNT_CODE_HMAC_KEY: CODE_SECRET,
  ACCOUNT_AUTH_CODE_TTL_SECONDS: "600",
  ACCOUNT_AUTH_CODE_ATTEMPTS: "5",
  ACCOUNT_AUTH_RESEND_SECONDS: "60",
  ACCOUNT_AUTH_MAX_SENDS_PER_HOUR: "5",
  ACCOUNT_AUTH_GLOBAL_MAX_SENDS_PER_24_HOURS: "80",
  ACCOUNT_AUTH_SESSION_TTL_DAYS: "90",
  PLUS_BUYER_CONFIRMATION_VERSION: "2026-08-15",
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
    "../migrations/0004_guardian_buyer_confirmation.sql",
    "../migrations/0005_account_email_global_send_limit.sql",
    "../migrations/0006_plus_price_400.sql",
    "../migrations/0007_share_trial_reuse_retention.sql",
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

function confirmedSelf(email = EMAIL) {
  return {
    email,
    contactRole: "self",
    adultConfirmed: true,
    guardianConfirmed: false,
  };
}

function confirmedGuardian(email = EMAIL) {
  return {
    email,
    contactRole: "guardian",
    adultConfirmed: true,
    guardianConfirmed: true,
  };
}

test("checked-in auth configuration is disabled and binds only provisioned production D1", () => {
  const config = JSON.parse(readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  ));
  assert.equal(config.vars.PLUS_ACCOUNT_AUTH_HTTP_ENABLED, "false");
  assert.equal(config.vars.ACCOUNT_AUTH_ALLOWED_ORIGIN, ORIGIN);
  assert.equal(config.vars.ACCOUNT_AUTH_EXPECTED_HOSTNAME, "glucoscope.app");
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
  assert.deepEqual(config.d1_databases, [{
    binding: "PLUS_DB",
    database_name: "glucoscope-plus-production",
    database_id: "9de9b4d7-e523-428a-90b7-f657e020764c",
    migrations_dir: "migrations",
  }]);
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
      service.requestCode(confirmedSelf(), { turnstileVerified: true }),
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
    ...confirmedGuardian(" family@Example.COM "),
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
    requestId: CHALLENGE_IDS[0],
  });
  await assert.rejects(
    service.requestCode(confirmedGuardian(), { turnstileVerified: true }),
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
    SELECT
      email_lookup_hmac, email_ciphertext, email_key_version, buyer_role,
      buyer_confirmation_version, adult_confirmed_at, guardian_confirmed_at
    FROM accounts
  `).get();
  assert.equal(storedAccount.email_ciphertext, "email-not-stored-v1");
  assert.equal(Number(storedAccount.email_key_version), 1);
  assert.equal(storedAccount.buyer_role, "guardian");
  assert.equal(storedAccount.buyer_confirmation_version, "2026-08-15");
  assert.equal(Number(storedAccount.adult_confirmed_at), NOW);
  assert.equal(Number(storedAccount.guardian_confirmed_at), NOW);
  assert.doesNotMatch(JSON.stringify(storedAccount), /family@example\.com/iu);
  const storedChallenge = database.raw.prepare(`
    SELECT
      email_lookup_hmac, code_hmac, verification_grant_hash, contact_role,
      adult_confirmed, guardian_confirmed, buyer_confirmation_version
    FROM account_auth_challenges
  `).get();
  assert.match(storedChallenge.email_lookup_hmac, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(storedChallenge.code_hmac, /^[A-Za-z0-9_-]{43}$/u);
  assert.match(storedChallenge.verification_grant_hash, /^[A-Za-z0-9_-]{43}$/u);
  assert.notEqual(storedChallenge.verification_grant_hash, requested.verificationGrant);
  assert.equal(storedChallenge.contact_role, "guardian");
  assert.equal(Number(storedChallenge.adult_confirmed), 1);
  assert.equal(Number(storedChallenge.guardian_confirmed), 1);
  assert.equal(storedChallenge.buyer_confirmation_version, "2026-08-15");
  assert.doesNotMatch(JSON.stringify(storedChallenge), /family|example|123456/iu);

  clock.value += 61_000;
  const recoveryRequest = await service.requestCode(confirmedGuardian(), {
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

test("a failed resend keeps the previously delivered code usable", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const dependencies = createDeterministicDependencies(store, clock, delivered);
  let sendAttempts = 0;
  dependencies.emailAdapter = {
    async sendAccountCode(message) {
      sendAttempts += 1;
      if (sendAttempts === 1) {
        delivered.push(message);
        return { accepted: true };
      }
      return { accepted: false };
    },
  };
  const service = createAccountAuthService(ENABLED_ENV, dependencies);

  const first = await service.requestCode(confirmedSelf(), { turnstileVerified: true });
  clock.value += 61_000;
  await assert.rejects(
    service.requestCode(confirmedSelf(), { turnstileVerified: true }),
    assertAuthError("service_unavailable", 503),
  );

  const challenges = database.raw.prepare(`
    SELECT id, send_state, invalidated_at
    FROM account_auth_challenges
    ORDER BY created_at
  `).all();
  assert.equal(challenges.length, 2);
  assert.equal(challenges[0].send_state, "sent");
  assert.equal(challenges[0].invalidated_at, null);
  assert.equal(challenges[1].send_state, "failed");
  assert.equal(Number(challenges[1].invalidated_at), clock.value);

  const verified = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: first.verificationGrant,
  });
  assert.equal(verified.status, "verified");
});

test("a successfully delivered resend replaces the older code", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );

  const first = await service.requestCode(confirmedSelf(), { turnstileVerified: true });
  clock.value += 61_000;
  const second = await service.requestCode(confirmedSelf(), { turnstileVerified: true });

  await assert.rejects(
    service.verifyCode({
      email: EMAIL,
      code: delivered[0].code,
      verificationGrant: first.verificationGrant,
    }),
    assertAuthError("invalid_or_expired_code", 400),
  );
  const verified = await service.verifyCode({
    email: EMAIL,
    code: delivered[1].code,
    verificationGrant: second.verificationGrant,
  });
  assert.equal(verified.status, "verified");
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
      'checkout.session.completed', ?1, 400, 'jpy', ?2,
      'granted', ?2, ?2
    )
  `).run(ACCOUNT_IDS[0], entitlementStartsAt);
  database.raw.prepare(`
    INSERT INTO entitlements (
      id, account_id, product_code, purchase_kind, amount_jpy, currency,
      starts_at, ends_at, status, source_event_id, created_at, updated_at
    ) VALUES (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd', ?1, 'plus_30d',
      'one_time', 400, 'jpy', ?2, ?3, 'granted',
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
    confirmedSelf(),
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

test("email HMAC rotation preserves an active Share Studio reuse block", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const oldEmailHmac = await createEmailLookupHmac(EMAIL, EMAIL_SECRET);
  const newEmailHmac = await createEmailLookupHmac(EMAIL, NEW_EMAIL_SECRET);
  const trialUsedAt = NOW - 24 * 60 * 60 * 1000;
  database.raw.prepare(`
    INSERT INTO share_trial_reuse_retention (
      email_lookup_hmac, email_hmac_key_version, trial_used_at,
      expires_at, created_at, updated_at
    ) VALUES (?1, 1, ?2, ?3, ?4, ?4)
  `).run(
    oldEmailHmac,
    trialUsedAt,
    trialUsedAt + 90 * 24 * 60 * 60 * 1000,
    trialUsedAt + 1_000,
  );
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
    confirmedSelf(),
    { turnstileVerified: true },
  );
  const verified = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: requested.verificationGrant,
  });
  assert.equal(verified.session.shareStudioTrialAvailable, false);
  assert.deepEqual({ ...database.raw.prepare(`
    SELECT email_lookup_hmac, email_hmac_key_version, trial_used_at, expires_at
    FROM share_trial_reuse_retention
  `).get() }, {
    email_lookup_hmac: newEmailHmac,
    email_hmac_key_version: 2,
    trial_used_at: trialUsedAt,
    expires_at: trialUsedAt + 90 * 24 * 60 * 60 * 1000,
  });
});

test("conflicting current and previous Share Studio reuse blocks fail closed", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const oldEmailHmac = await createEmailLookupHmac(EMAIL, EMAIL_SECRET);
  const newEmailHmac = await createEmailLookupHmac(EMAIL, NEW_EMAIL_SECRET);
  const trialUsedAt = NOW - 24 * 60 * 60 * 1000;
  for (const [hmac, version, offset] of [
    [oldEmailHmac, 1, 0],
    [newEmailHmac, 2, 1_000],
  ]) {
    database.raw.prepare(`
      INSERT INTO share_trial_reuse_retention (
        email_lookup_hmac, email_hmac_key_version, trial_used_at,
        expires_at, created_at, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    `).run(
      hmac,
      version,
      trialUsedAt + offset,
      trialUsedAt + offset + 90 * 24 * 60 * 60 * 1000,
      trialUsedAt + offset + 1,
    );
  }
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
    confirmedSelf(),
    { turnstileVerified: true },
  );
  await assert.rejects(service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: requested.verificationGrant,
  }), assertAuthError("service_unavailable", 503));
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM share_trial_reuse_retention
  `).get().count), 2);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM accounts
  `).get().count), 0);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM sessions
  `).get().count), 0);
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
      unsafeService.requestCode(confirmedSelf(), { turnstileVerified: true }),
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
    confirmedSelf(),
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
    confirmedSelf(),
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
    confirmedSelf(),
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
    await service.requestCode(confirmedSelf(), { turnstileVerified: true });
  }
  clock.value += 61_000;
  await assert.rejects(
    service.requestCode(confirmedSelf(), { turnstileVerified: true }),
    assertAuthError("please_wait", 429),
  );
  assert.equal(delivered.length, 5);
});

test("rolling global email cap atomically reserves 80 attempts across addresses", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);

  function challengeInput(index, createdAt = NOW) {
    const suffix = index.toString(16).padStart(12, "0");
    const emailLookupHmac = index.toString(36).padStart(43, "0");
    return {
      id: `00000000-0000-4000-8000-${suffix}`,
      emailLookupHmac,
      alternateEmailLookupHmac: emailLookupHmac,
      emailHmacKeyVersion: 1,
      codeHmac: "K".repeat(43),
      verificationGrantHash: "V".repeat(43),
      contactRole: "self",
      adultConfirmed: true,
      guardianConfirmed: false,
      buyerConfirmationVersion: "2026-08-15",
      attempts: 5,
      createdAt,
      expiresAt: createdAt + 10 * 60 * 1000,
      resendAllowedAfter: createdAt - 60 * 1000,
      windowStartsAt: createdAt - 60 * 60 * 1000,
      maximumPerWindow: 5,
      retentionStartsAt: createdAt - 24 * 60 * 60 * 1000,
      rateWindowMs: 60 * 60 * 1000,
      resendCooldownMs: 60 * 1000,
      globalWindowStartsAt: createdAt - 24 * 60 * 60 * 1000,
      globalMaximumPerWindow: 80,
      globalRateWindowMs: 24 * 60 * 60 * 1000,
    };
  }

  const outcomes = await Promise.all(
    Array.from({ length: 81 }, (_, offset) => (
      store.issueChallenge(challengeInput(offset + 1))
    )),
  );
  assert.equal(outcomes.filter((item) => item.status === "pending").length, 80);
  assert.equal(outcomes.filter((item) => item.status === "throttled").length, 1);
  assert.ok(outcomes.find((item) => item.status === "throttled").retryAfterSeconds >= 86_399);

  const reserved = database.raw.prepare(`
    SELECT COUNT(*) AS count FROM account_email_send_reservations
  `).get();
  const challenges = database.raw.prepare(`
    SELECT COUNT(*) AS count FROM account_auth_challenges
  `).get();
  assert.equal(Number(reserved.count), 80);
  assert.equal(Number(challenges.count), 80);

  await store.markChallengeSent({
    id: challengeInput(1).id,
    emailLookupHmac: challengeInput(1).emailLookupHmac,
    alternateEmailLookupHmac: challengeInput(1).alternateEmailLookupHmac,
    sentAt: NOW + 1,
  });
  await store.markChallengeSendFailed({
    id: challengeInput(2).id,
    failedAt: NOW + 2,
  });
  const stateCounts = database.raw.prepare(`
    SELECT delivery_state, COUNT(*) AS count
    FROM account_email_send_reservations
    GROUP BY delivery_state
    ORDER BY delivery_state
  `).all();
  assert.equal(stateCounts.length, 3);
  assert.equal(stateCounts[0].delivery_state, "failed");
  assert.equal(Number(stateCounts[0].count), 1);
  assert.equal(stateCounts[1].delivery_state, "pending");
  assert.equal(Number(stateCounts[1].count), 78);
  assert.equal(stateCounts[2].delivery_state, "sent");
  assert.equal(Number(stateCounts[2].count), 1);
  assert.equal(
    (await store.issueChallenge(challengeInput(82))).status,
    "throttled",
  );

  const afterWindow = NOW + 24 * 60 * 60 * 1000 + 1;
  assert.equal(
    (await store.issueChallenge(challengeInput(83, afterWindow))).status,
    "pending",
  );
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM account_email_send_reservations
  `).get().count), 1);

  const reservationColumns = database.raw.prepare(`
    PRAGMA table_info(account_email_send_reservations)
  `).all().map((column) => column.name);
  assert.deepEqual(reservationColumns, [
    "challenge_id",
    "delivery_state",
    "reserved_at",
    "updated_at",
  ]);
});

test("hourly cleanup keeps the exact 24-hour boundary and deletes it one millisecond later", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const threshold = NOW - 24 * 60 * 60 * 1000;

  function insertChallenge({ id, marker, expiresAt }) {
    const createdAt = expiresAt - 10 * 60 * 1000;
    database.raw.prepare(`
      INSERT INTO account_auth_challenges (
        id, email_lookup_hmac, email_hmac_key_version, code_hmac,
        verification_grant_hash, contact_role, send_state,
        attempts_remaining, created_at, expires_at, sent_at,
        consumed_at, invalidated_at, adult_confirmed,
        guardian_confirmed, buyer_confirmation_version
      ) VALUES (
        ?1, ?2, 1, ?3, ?4, 'self', 'failed',
        5, ?5, ?6, NULL, NULL, ?6, 1, 0, '2026-08-15'
      )
    `).run(
      id,
      marker.repeat(43),
      marker.toUpperCase().repeat(43),
      marker.toLowerCase().repeat(43),
      createdAt,
      expiresAt,
    );
  }

  insertChallenge({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc1",
    marker: "a",
    expiresAt: threshold - 1,
  });
  insertChallenge({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    marker: "b",
    expiresAt: threshold,
  });
  insertChallenge({
    id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    marker: "c",
    expiresAt: NOW + 10 * 60 * 1000,
  });
  database.raw.prepare(`
    INSERT INTO account_email_send_reservations (
      challenge_id, delivery_state, reserved_at, updated_at
    ) VALUES
      ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'failed', ?1, ?1),
      ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'sent', ?2, ?2),
      ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'pending', ?3, ?3)
  `).run(threshold - 1, threshold, NOW);
  database.raw.prepare(`
    INSERT INTO share_trial_reuse_retention (
      email_lookup_hmac, email_hmac_key_version, trial_used_at,
      expires_at, created_at, updated_at
    ) VALUES
      (?1, 1, ?3, ?4, ?4 - 1, ?4 - 1),
      (?2, 1, ?5, ?6, ?6 - 1, ?6 - 1)
  `).run(
    "D".repeat(43),
    "E".repeat(43),
    NOW - 90 * 24 * 60 * 60 * 1000,
    NOW,
    NOW + 1 - 90 * 24 * 60 * 60 * 1000,
    NOW + 1,
  );

  const env = {
    ACCOUNT_AUTH_CLEANUP_ENABLED: "true",
    PLUS_DB: database,
  };
  assert.deepEqual(
    await runAccountAuthCleanup(env, { scheduledTime: NOW }),
    { cleaned: true },
  );
  assert.deepEqual(database.raw.prepare(`
    SELECT id FROM account_auth_challenges ORDER BY id
  `).all().map((row) => row.id), [
    "cccccccc-cccc-4ccc-8ccc-ccccccccccc2",
    "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
  ]);
  assert.deepEqual(database.raw.prepare(`
    SELECT challenge_id FROM account_email_send_reservations
    ORDER BY challenge_id
  `).all().map((row) => row.challenge_id), [
    "dddddddd-dddd-4ddd-8ddd-ddddddddddd2",
    "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
  ]);
  assert.deepEqual(database.raw.prepare(`
    SELECT email_lookup_hmac FROM share_trial_reuse_retention
  `).all().map((row) => row.email_lookup_hmac), ["E".repeat(43)]);

  await runAccountAuthCleanup(env, { scheduledTime: NOW + 1 });
  assert.deepEqual(database.raw.prepare(`
    SELECT id FROM account_auth_challenges ORDER BY id
  `).all().map((row) => row.id), [
    "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
  ]);
  assert.deepEqual(database.raw.prepare(`
    SELECT challenge_id FROM account_email_send_reservations
    ORDER BY challenge_id
  `).all().map((row) => row.challenge_id), [
    "dddddddd-dddd-4ddd-8ddd-ddddddddddd3",
  ]);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM share_trial_reuse_retention
  `).get().count), 0);
});

test("disabled cleanup touches neither controller time, D1, nor store factory", async () => {
  let touched = false;
  const env = new Proxy({ ACCOUNT_AUTH_CLEANUP_ENABLED: "false" }, {
    get(target, property, receiver) {
      if (property === "PLUS_DB") {
        touched = true;
        throw new Error("D1 must stay untouched");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const controller = Object.defineProperty({}, "scheduledTime", {
    get() {
      touched = true;
      throw new Error("time must stay untouched");
    },
  });
  const result = await runAccountAuthCleanup(env, controller, {
    createStore() {
      touched = true;
      throw new Error("store must stay untouched");
    },
  });
  assert.deepEqual(result, { cleaned: false, skipped: true });
  assert.equal(touched, false);
});

test("cleanup binding, clock, and D1 failures stay generic with no logging", async () => {
  const enabled = { ACCOUNT_AUTH_CLEANUP_ENABLED: "true" };
  for (const [env, controller, dependencies] of [
    [enabled, { scheduledTime: NOW }, {}],
    [enabled, { scheduledTime: -1 }, {}],
    [enabled, {}, {}],
    [enabled, { scheduledTime: NOW }, {
      createStore() {
        return {
          async cleanupExpiredAuthRecords() {
            throw new Error("private-database-detail");
          },
        };
      },
    }],
  ]) {
    await assert.rejects(
      runAccountAuthCleanup(env, controller, dependencies),
      (error) => {
        assert.ok(error instanceof AccountAuthCleanupError);
        assert.equal(error.code, "cleanup_unavailable");
        assert.equal(error.message, "cleanup_unavailable");
        assert.doesNotMatch(String(error), /private-database-detail/u);
        return true;
      },
    );
  }

  const cleanupSource = readFileSync(
    new URL("../src/account-auth-cleanup.js", import.meta.url),
    "utf8",
  );
  const indexSource = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
  const config = JSON.parse(readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  ));
  assert.doesNotMatch(cleanupSource, /console\s*\.|email_lookup|code_hmac/u);
  assert.match(indexSource, /runAccountAuthCleanup\(this\.env, controller\)/u);
  assert.equal(config.vars.ACCOUNT_AUTH_CLEANUP_ENABLED, "false");
  assert.deepEqual(config.triggers.crons, ["0 * * * *"]);
});

test("adult and guardian confirmations are explicit and role-specific", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const service = createAccountAuthService(ENABLED_ENV, {
    store: createD1AccountAuthStore(database),
    emailAdapter: { async sendAccountCode() { return { accepted: true }; } },
  });
  await assert.rejects(
    service.requestCode({
      email: EMAIL,
      contactRole: "self",
      guardianConfirmed: false,
    }, {
      turnstileVerified: true,
    }),
    assertAuthError("adult_confirmation_required", 400),
  );
  await assert.rejects(
    service.requestCode({
      email: EMAIL,
      contactRole: "guardian",
      adultConfirmed: true,
      guardianConfirmed: false,
    }, {
      turnstileVerified: true,
    }),
    assertAuthError("guardian_confirmation_required", 400),
  );
  await assert.rejects(
    service.requestCode({
      email: EMAIL,
      contactRole: "self",
      adultConfirmed: true,
      guardianConfirmed: true,
    }, {
      turnstileVerified: true,
    }),
    assertAuthError("invalid_request", 400),
  );
});

test("buyer confirmation schema rejects every partial legacy state", (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const insertPartial = database.raw.prepare(`
    INSERT INTO accounts (
      id, email_lookup_hmac, email_ciphertext, email_key_version,
      email_verified_at, status, created_at, updated_at,
      buyer_role, buyer_confirmation_version,
      adult_confirmed_at, guardian_confirmed_at
    ) VALUES (
      '33333333-3333-4333-8333-333333333333',
      ?2, 'email-not-stored-v1', 1,
      ?1, 'active', ?1, ?1,
      NULL, '2026-08-15', NULL, NULL
    )
  `);
  assert.throws(
    () => insertPartial.run(NOW, "P".repeat(43)),
    /invalid buyer confirmation/u,
  );

  database.raw.prepare(`
    INSERT INTO accounts (
      id, email_lookup_hmac, email_ciphertext, email_key_version,
      email_verified_at, status, created_at, updated_at
    ) VALUES (
      '44444444-4444-4444-8444-444444444444',
      ?2, 'email-not-stored-v1', 1,
      ?1, 'active', ?1, ?1
    )
  `).run(NOW, "L".repeat(43));
  assert.throws(() => database.raw.prepare(`
    UPDATE accounts
    SET adult_confirmed_at = ?1
    WHERE id = '44444444-4444-4444-8444-444444444444'
  `).run(NOW), /invalid buyer confirmation/u);
});

test("a verified account role cannot be changed by a later code", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const store = createD1AccountAuthStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(store, clock, delivered),
  );
  const firstRequest = await service.requestCode(confirmedGuardian(), {
    turnstileVerified: true,
  });
  const firstSession = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: firstRequest.verificationGrant,
  });

  clock.value += 61_000;
  const conflictingRequest = await service.requestCode(confirmedSelf(), {
    turnstileVerified: true,
  });
  await assert.rejects(
    service.verifyCode({
      email: EMAIL,
      code: delivered[1].code,
      verificationGrant: conflictingRequest.verificationGrant,
    }),
    assertAuthError("buyer_role_conflict", 409),
  );
  const account = database.raw.prepare(`
    SELECT buyer_role, guardian_confirmed_at FROM accounts
  `).get();
  assert.equal(account.buyer_role, "guardian");
  assert.equal(Number(account.guardian_confirmed_at), NOW);
  assert.equal((await service.getSessionStatus(firstSession.sessionToken)).status, "ready");
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM sessions WHERE revoked_at IS NULL
  `).get().count), 1);
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
    confirmedSelf(),
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
    "share_trial_reuse_retention",
    "account_auth_challenges",
    "processed_checkout_failure_events",
    "processed_checkout_expiry_events",
  ]) {
    const row = database.raw.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    assert.equal(Number(row.count), 0, table);
  }

  clock.value += 61_000;
  const recreateRequest = await service.requestCode(
    confirmedSelf(),
    { turnstileVerified: true },
  );
  const recreated = await service.verifyCode({
    email: EMAIL,
    code: delivered[1].code,
    verificationGrant: recreateRequest.verificationGrant,
  });
  assert.equal(recreated.status, "verified");
  assert.equal(recreated.session.shareStudioTrialAvailable, true);
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM accounts
  `).get().count), 1);
  assert.equal(database.raw.prepare("SELECT id FROM accounts").get().id, ACCOUNT_IDS[1]);
});

test("a completed Share Studio trial stays unavailable for 90 days after account deletion", async (t) => {
  const database = createDatabase();
  t.after(() => database.close());
  const authStore = createD1AccountAuthStore(database);
  const trialStore = createD1PlusEntitlementStore(database);
  const clock = { value: NOW };
  const delivered = [];
  const service = createAccountAuthService(
    ENABLED_ENV,
    createDeterministicDependencies(authStore, clock, delivered),
  );
  const firstRequest = await service.requestCode(
    confirmedSelf(),
    { turnstileVerified: true },
  );
  const first = await service.verifyCode({
    email: EMAIL,
    code: delivered[0].code,
    verificationGrant: firstRequest.verificationGrant,
  });
  const completedRequestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  database.raw.prepare(`
    UPDATE share_trial_state
    SET used_at = ?2, completed_request_id = ?3, updated_at = ?2
    WHERE account_id = ?1
  `).run(ACCOUNT_IDS[0], NOW, completedRequestId);

  clock.value += 1_000;
  assert.deepEqual(await service.deleteAccount(first.sessionToken, {
    confirmDelete: true,
  }, { turnstileVerified: true }), {
    ok: true,
    status: "account_deleted",
  });
  const retained = database.raw.prepare(`
    SELECT
      email_lookup_hmac, email_hmac_key_version, trial_used_at,
      expires_at, created_at, updated_at
    FROM share_trial_reuse_retention
  `).get();
  assert.match(retained.email_lookup_hmac, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(Number(retained.email_hmac_key_version), 1);
  assert.equal(Number(retained.trial_used_at), NOW);
  assert.equal(Number(retained.expires_at), NOW + 90 * 24 * 60 * 60 * 1000);
  assert.equal(Number(retained.created_at), clock.value);
  assert.equal(Number(retained.updated_at), clock.value);
  assert.deepEqual(database.raw.prepare(`
    PRAGMA table_info(share_trial_reuse_retention)
  `).all().map((column) => column.name), [
    "email_lookup_hmac",
    "email_hmac_key_version",
    "trial_used_at",
    "expires_at",
    "created_at",
    "updated_at",
  ]);
  assert.doesNotMatch(
    JSON.stringify(retained),
    /family|example|glucose|display|purchase|checkout|image/iu,
  );

  clock.value = NOW + 61_000;
  const recreateRequest = await service.requestCode(
    confirmedSelf(),
    { turnstileVerified: true },
  );
  const recreated = await service.verifyCode({
    email: EMAIL,
    code: delivered[1].code,
    verificationGrant: recreateRequest.verificationGrant,
  });
  assert.equal(recreated.session.shareStudioTrialAvailable, false);
  assert.deepEqual(await trialStore.reserveShareTrial({
    accountId: ACCOUNT_IDS[1],
    requestId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    reservedAt: clock.value,
    expiresAt: clock.value + 5 * 60 * 1000,
  }), { status: "trial_already_used" });

  clock.value = NOW + 90 * 24 * 60 * 60 * 1000 + 1;
  assert.equal(
    (await service.getSessionStatus(recreated.sessionToken)).shareStudioTrialAvailable,
    true,
  );
  assert.deepEqual(await trialStore.reserveShareTrial({
    accountId: ACCOUNT_IDS[1],
    requestId: "99999999-9999-4999-8999-999999999999",
    reservedAt: clock.value,
    expiresAt: clock.value + 5 * 60 * 1000,
  }), {
    status: "reserved",
    grant: "trial",
    requestId: "99999999-9999-4999-8999-999999999999",
    reservationExpiresAt: clock.value + 5 * 60 * 1000,
  });
  await runAccountAuthCleanup({
    ACCOUNT_AUTH_CLEANUP_ENABLED: "true",
    PLUS_DB: database,
  }, { scheduledTime: clock.value });
  assert.equal(Number(database.raw.prepare(`
    SELECT COUNT(*) AS count FROM share_trial_reuse_retention
  `).get().count), 0);
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
    confirmedSelf(),
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
      'checkout.session.completed', ?1, 400, 'jpy', ?2,
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
    confirmedSelf(),
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
    async enforceRateLimit() {
      return { allowed: true };
    },
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
      body: JSON.stringify({
        ...confirmedSelf(),
        turnstileToken: "token-one",
      }),
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
  assert.equal(turnstileCalls[0].expectedHostname, "glucoscope.app");
  assert.deepEqual(calls[0], ["requestCode", {
    ...confirmedSelf(),
    turnstileToken: "token-one",
  }]);

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
        adultConfirmed: true,
        guardianConfirmed: true,
      }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(publicGuardianPayload.status, 200);
  assert.deepEqual(calls.at(-1), ["requestCode", {
    email: EMAIL,
    turnstileToken: "token-three",
    contactRole: "guardian",
    adultConfirmed: true,
    guardianConfirmed: true,
  }]);

  const unexpectedChildField = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({
        ...confirmedGuardian(),
        turnstileToken: "token-four",
        childName: "must-not-be-sent",
      }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(unexpectedChildField.status, 400);
  assert.deepEqual(await unexpectedChildField.json(), {
    ok: false,
    error: "invalid_request",
  });

  const queryRejected = await handleAccountAuthRequest(new Request(
    `https://worker.invalid/v1/auth/request-code?email=${encodeURIComponent(EMAIL)}`,
    {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ ...confirmedSelf(), turnstileToken: "token-five" }),
    },
  ), ENABLED_ENV, dependencies);
  assert.equal(queryRejected.status, 400);
  assert.deepEqual(await queryRejected.json(), {
    ok: false,
    error: "invalid_request",
  });
});

test("Share Studio trial HTTP is separately gated and sends only session plus request ID", async () => {
  const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const calls = [];
  const service = {
    async reserveShareTrial(token, value) {
      calls.push(["reserve", token, value]);
      return { status: "reserved", grant: "trial", requestId: value, reservationExpiresAt: NOW };
    },
    async completeShareTrial(token, value) {
      calls.push(["complete", token, value]);
      return { status: "completed", grant: "trial", requestId: value };
    },
    async releaseShareTrial(token, value) {
      calls.push(["release", token, value]);
      return { status: "released", requestId: value };
    },
  };
  const request = (operation, body = { requestId }) => new Request(
    `https://worker.invalid/v1/share-trial/${operation}`,
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        Authorization: `Bearer ${SESSION_TOKENS[0]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  const disabled = await handleAccountAuthRequest(
    request("reserve"),
    ENABLED_ENV,
    { service },
  );
  assert.equal(disabled.status, 503);
  assert.equal(calls.length, 0);

  const env = { ...ENABLED_ENV, PLUS_SHARE_TRIAL_HTTP_ENABLED: "true" };
  for (const operation of ["reserve", "complete", "release"]) {
    const response = await handleAccountAuthRequest(request(operation), env, { service });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).ok, true);
  }
  assert.deepEqual(calls, [
    ["reserve", SESSION_TOKENS[0], requestId],
    ["complete", SESSION_TOKENS[0], requestId],
    ["release", SESSION_TOKENS[0], requestId],
  ]);

  const extraHealthData = await handleAccountAuthRequest(
    request("reserve", { requestId, glucose: 123 }),
    env,
    { service },
  );
  assert.equal(extraHealthData.status, 400);
  assert.equal(calls.length, 3);

  const preflight = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/share-trial/reserve",
    { method: "OPTIONS", headers: { Origin: ORIGIN } },
  ), env, { service });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
});

test("Cloudflare rate-limit bindings enforce 5 and 30 per IP with separate keys", async () => {
  function createCountingLimiter(maximum) {
    const counts = new Map();
    const keys = [];
    return {
      keys,
      async limit({ key }) {
        keys.push(key);
        const next = (counts.get(key) || 0) + 1;
        counts.set(key, next);
        return { success: next <= maximum };
      },
    };
  }

  const requestCodeLimiter = createCountingLimiter(5);
  const requestCodeRequest = new Request("https://worker.invalid/", {
    headers: { "CF-Connecting-IP": "203.0.113.10" },
  });
  for (let count = 0; count < 5; count += 1) {
    assert.deepEqual(
      await enforceAccountAuthRateLimit(requestCodeRequest, requestCodeLimiter),
      { allowed: true },
    );
  }
  await assert.rejects(
    enforceAccountAuthRateLimit(requestCodeRequest, requestCodeLimiter),
    (error) => {
      assert.ok(assertAuthError("please_wait", 429)(error));
      assert.equal(error.retryAfterSeconds, 60);
      return true;
    },
  );
  assert.deepEqual(
    await enforceAccountAuthRateLimit(new Request("https://worker.invalid/", {
      headers: { "CF-Connecting-IP": "203.0.113.11" },
    }), requestCodeLimiter),
    { allowed: true },
  );
  assert.equal(requestCodeLimiter.keys.includes(EMAIL), false);

  const verifyLimiter = createCountingLimiter(30);
  const verifyRequest = new Request("https://worker.invalid/", {
    headers: { "CF-Connecting-IP": "2001:db8::1" },
  });
  for (let count = 0; count < 30; count += 1) {
    await enforceAccountAuthRateLimit(verifyRequest, verifyLimiter);
  }
  await assert.rejects(
    enforceAccountAuthRateLimit(verifyRequest, verifyLimiter),
    assertAuthError("please_wait", 429),
  );

  const config = JSON.parse(readFileSync(
    new URL("../wrangler.jsonc", import.meta.url),
    "utf8",
  ));
  assert.equal(config.ratelimits.length, 2);
  assert.deepEqual(config.ratelimits.map((item) => ({
    name: item.name,
    limit: item.simple.limit,
    period: item.simple.period,
  })), [
    { name: "ACCOUNT_REQUEST_CODE_RATE_LIMITER", limit: 5, period: 60 },
    { name: "ACCOUNT_VERIFY_RATE_LIMITER", limit: 30, period: 60 },
  ]);
  assert.equal(new Set(config.ratelimits.map((item) => item.namespace_id)).size, 2);
  for (const item of config.ratelimits) {
    assert.match(item.namespace_id, /^[1-9]\d*$/u);
  }
  assert.equal(config.vars.ACCOUNT_AUTH_GLOBAL_MAX_SENDS_PER_24_HOURS, "80");
});

test("auth-route rate limiting runs before body, Turnstile, D1, and email work", async () => {
  const sequence = [];
  const service = {
    async requestCode() {
      sequence.push("service");
      return {
        ok: true,
        status: "code_sent",
        verificationGrant: VERIFICATION_GRANTS[0],
      };
    },
    async verifyCode() {
      sequence.push("service");
      return { ok: true, status: "verified" };
    },
  };
  const rateLimitedEnv = {
    ...ENABLED_ENV,
    ACCOUNT_REQUEST_CODE_RATE_LIMITER: {
      async limit({ key }) {
        sequence.push(`rate:${key}`);
        return { success: false };
      },
    },
  };
  const limited = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "CF-Connecting-IP": "203.0.113.20",
        "Content-Type": "application/json",
      },
      body: "not-json",
    },
  ), rateLimitedEnv, {
    service,
    async verifyTurnstile() {
      sequence.push("turnstile");
      return { verified: true };
    },
  });
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), { ok: false, error: "please_wait" });
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.deepEqual(sequence, ["rate:203.0.113.20"]);

  sequence.length = 0;
  const allowedEnv = {
    ...ENABLED_ENV,
    ACCOUNT_REQUEST_CODE_RATE_LIMITER: {
      async limit({ key }) {
        sequence.push(`rate:${key}`);
        return { success: true };
      },
    },
    ACCOUNT_VERIFY_RATE_LIMITER: {
      async limit({ key }) {
        sequence.push(`rate:${key}`);
        return { success: true };
      },
    },
  };
  const dependencies = {
    service,
    async verifyTurnstile() {
      sequence.push("turnstile");
      return { verified: true };
    },
  };
  const allowed = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "CF-Connecting-IP": "203.0.113.21",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...confirmedSelf(),
        turnstileToken: "turnstile-token",
      }),
    },
  ), allowedEnv, dependencies);
  assert.equal(allowed.status, 200);
  assert.deepEqual(sequence, ["rate:203.0.113.21", "turnstile", "service"]);

  sequence.length = 0;
  const verified = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/verify",
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "CF-Connecting-IP": "203.0.113.22",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: EMAIL,
        code: "123456",
        verificationGrant: VERIFICATION_GRANTS[0],
      }),
    },
  ), allowedEnv, dependencies);
  assert.equal(verified.status, 200);
  assert.deepEqual(sequence, ["rate:203.0.113.22", "service"]);
});

test("missing IP, invalid IP, missing limiter, and limiter error fail closed", async () => {
  const validRequest = new Request("https://worker.invalid/", {
    headers: { "CF-Connecting-IP": "203.0.113.30" },
  });
  await assert.rejects(
    enforceAccountAuthRateLimit(validRequest),
    assertAuthError("service_unavailable", 503),
  );
  await assert.rejects(
    enforceAccountAuthRateLimit(validRequest, {
      async limit() {
        throw new Error("private-rate-limit-detail");
      },
    }),
    (error) => {
      assert.ok(assertAuthError("service_unavailable", 503)(error));
      assert.doesNotMatch(String(error), /private-rate-limit-detail/u);
      return true;
    },
  );
  await assert.rejects(
    enforceAccountAuthRateLimit(validRequest, {
      async limit() {
        return {};
      },
    }),
    assertAuthError("service_unavailable", 503),
  );

  for (const value of [
    null,
    "",
    "999.0.0.1",
    "01.2.3.4",
    "203.0.113.30, 203.0.113.31",
    "[2001:db8::1]",
    "2001:db8::1%eth0",
  ]) {
    let bindingTouched = false;
    const headers = value === null ? {} : { "CF-Connecting-IP": value };
    await assert.rejects(
      enforceAccountAuthRateLimit(new Request("https://worker.invalid/", {
        headers,
      }), {
        async limit() {
          bindingTouched = true;
          return { success: true };
        },
      }),
      assertAuthError("service_unavailable", 503),
    );
    assert.equal(bindingTouched, false);
  }

  const rateLimitSource = readFileSync(
    new URL("../src/account-auth-rate-limit.js", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(rateLimitSource, /console\s*\.|PLUS_DB|\.prepare\s*\(/u);

  let serviceTouched = false;
  const routeRequest = new Request(
    "https://worker.invalid/v1/auth/request-code",
    {
      method: "POST",
      headers: {
        Origin: ORIGIN,
        "CF-Connecting-IP": "203.0.113.30",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...confirmedSelf(),
        turnstileToken: "turnstile-token",
      }),
    },
  );
  const routeResponse = await handleAccountAuthRequest(
    routeRequest,
    ENABLED_ENV,
    {
      service: {
        async requestCode() {
          serviceTouched = true;
          throw new Error("must not run");
        },
      },
    },
  );
  assert.equal(routeResponse.status, 503);
  assert.deepEqual(await routeResponse.json(), {
    ok: false,
    error: "service_unavailable",
  });
  assert.equal(serviceTouched, false);
});

test("disabled HTTP stays a no-CORS 503 before invoking the service", async () => {
  let touched = false;
  const disabledEnv = new Proxy({ PLUS_ACCOUNT_AUTH_HTTP_ENABLED: "false" }, {
    get(target, property, receiver) {
      if (
        property === "ACCOUNT_REQUEST_CODE_RATE_LIMITER"
        || property === "ACCOUNT_VERIFY_RATE_LIMITER"
      ) {
        touched = true;
        throw new Error("rate limiter must not run");
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const response = await handleAccountAuthRequest(new Request(
    "https://worker.invalid/v1/auth/request-code",
    { headers: { Origin: ORIGIN } },
  ), disabledEnv, {
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
    expectedHostname: "glucoscope.app",
    env: { TURNSTILE_SECRET_KEY: "turnstile-secret-for-local-tests" },
  };
  const success = await verifyAccountTurnstile(base, async () => new Response(JSON.stringify({
    success: true,
    action: "glucoscope-plus-delete-account",
    hostname: "glucoscope.app",
  }), { status: 200 }));
  assert.deepEqual(success, { verified: true });

  for (const result of [
    { success: true, action: "wrong-action", hostname: "glucoscope.app" },
    { success: true, action: "glucoscope-plus-delete-account", hostname: "evil.example" },
    { success: false, action: "glucoscope-plus-delete-account", hostname: "glucoscope.app" },
  ]) {
    await assert.rejects(
      verifyAccountTurnstile(base, async () => new Response(JSON.stringify(result), {
        status: 200,
      })),
      assertAuthError("turnstile_failed", 403),
    );
  }
});
