import assert from "node:assert/strict";
import test from "node:test";

import {
  authorizeDeviceSessionStorage,
  cleanupDeviceSessionStorage,
  cleanupDeviceSessionStorageWithRetry,
  createDeviceSessionStorage,
  DEVICE_SESSION_STORAGE_KEY,
  revokeDeviceSessionStorage,
} from "../src/device-session-core.js";
import {
  buildDeviceSessionClearCookie,
  buildDeviceSessionCookie,
  deriveDeviceSessionId,
  deriveSourceCredentialFingerprint,
  generateDeviceSessionToken,
  handleRelayRequest,
  readConfig,
  readDeviceSessionCookie,
} from "../src/relay-core.js";

const ORIGIN = "https://glucoscope.app";
const SECRET = "test-only-device-session-secret-with-at-least-32-characters";
const NOW_MS = Date.parse("2026-08-16T06:00:00.000Z");
const SOURCE_URL = "https://example.ns.gluroo.com/private/path?ignored=yes";
const CREDENTIAL = "test-credential-never-store-this";
const TOKEN_ID = "a".repeat(43);
const SOURCE_FINGERPRINT = "b".repeat(43);

function createMemoryStorage() {
  const values = new Map();
  let tail = Promise.resolve();
  let alarmAt = null;
  let failNextSetAlarm = false;
  const transactionView = {
    async get(key) {
      return values.get(key);
    },
    async put(key, value) {
      if (typeof key === "object") {
        for (const [entryKey, entryValue] of Object.entries(key)) values.set(entryKey, entryValue);
      } else {
        values.set(key, value);
      }
    },
    async delete(key) {
      values.delete(key);
    },
    async setAlarm(value) {
      if (failNextSetAlarm) {
        failNextSetAlarm = false;
        throw new Error("test alarm write failure");
      }
      alarmAt = Number(value);
    },
    async deleteAlarm() {
      alarmAt = null;
    },
  };
  return {
    values,
    get alarmAt() {
      return alarmAt;
    },
    failNextAlarmWrite() {
      failNextSetAlarm = true;
    },
    async get(key) {
      return values.get(key);
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
    async setAlarm(value) {
      if (failNextSetAlarm) {
        failNextSetAlarm = false;
        throw new Error("test alarm write failure");
      }
      alarmAt = Number(value);
    },
    async transaction(callback) {
      const previous = tail;
      let release;
      tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const valuesBefore = new Map(values);
      const alarmBefore = alarmAt;
      try {
        return await callback(transactionView);
      } catch (error) {
        values.clear();
        for (const [key, value] of valuesBefore) values.set(key, value);
        alarmAt = alarmBefore;
        throw error;
      } finally {
        release();
      }
    },
  };
}

function createDeviceSessionBinding() {
  const storages = new Map();
  function storageFor(id) {
    if (!storages.has(id)) storages.set(id, createMemoryStorage());
    return storages.get(id);
  }
  return {
    storages,
    getByName(id) {
      const storage = storageFor(id);
      return {
        create: (input) => createDeviceSessionStorage(storage, input),
        authorize: (input) => authorizeDeviceSessionStorage(storage, input),
        revoke: (input) => revokeDeviceSessionStorage(storage, input),
      };
    },
  };
}

function createCounterBinding() {
  const counters = new Map();
  return {
    get(id) {
      return {
        async fetch(_url, init) {
          const payload = JSON.parse(init.body);
          const previous = counters.get(id);
          const count = previous?.bucket === payload.bucket ? previous.count : 0;
          if (count >= payload.limit) {
            return Response.json({ allowed: false, count, limit: payload.limit }, { status: 429 });
          }
          const next = count + 1;
          counters.set(id, { bucket: payload.bucket, count: next });
          return Response.json({ allowed: true, count: next, limit: payload.limit });
        },
      };
    },
    idFromName(name) {
      return name;
    },
  };
}

function deviceEnv(overrides = {}) {
  return {
    RELAY_ENABLED: "true",
    RELAY_DEVICE_SESSIONS_ENABLED: "true",
    CORS_ALLOWED_ORIGINS: ORIGIN,
    CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN: "false",
    GLUROO_HOST_SUFFIX: ".ns.gluroo.com",
    TURNSTILE_EXPECTED_HOSTNAME: "glucoscope.app",
    TURNSTILE_EXPECTED_ACTION: "glucoscope-data-relay",
    RELAY_DEVICE_SESSION_IDLE_TTL_SECONDS: "15552000",
    RELAY_DEVICE_SESSION_DAILY_LIMIT: "3000",
    GLOBAL_WARNING_DAILY: "20000",
    GLOBAL_HARD_DAILY: "50000",
    RELAY_DEVICE_SESSION_SECRET: SECRET,
    RELAY_DEVICE_SESSION: createDeviceSessionBinding(),
    RELAY_USAGE_COUNTER: createCounterBinding(),
    ...overrides,
  };
}

function apiRequest(pathname, body, options = {}) {
  const method = options.method || "POST";
  const headers = new Headers({ Origin: options.origin === undefined ? ORIGIN : options.origin });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (options.cookie) headers.set("Cookie", options.cookie);
  return new Request(`https://relay.glucoscope.app${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function entryPayload(overrides = {}) {
  return {
    sourceUrl: SOURCE_URL,
    credential: CREDENTIAL,
    limit: 2,
    ...overrides,
  };
}

function tokenFromSetCookie(value) {
  const match = /^__Host-glucoscope_relay_session=([^;]+);/u.exec(String(value));
  assert.ok(match);
  return match[1];
}

async function createSession(env, fillByte = 7, options = {}) {
  const response = await handleRelayRequest(
    apiRequest(
      "/v1/device-session",
      {
        turnstileToken: "test-turnstile-token",
        sourceUrl: SOURCE_URL,
        credential: CREDENTIAL,
      },
      { cookie: options.cookie },
    ),
    env,
    {
      now: () => options.nowMs ?? NOW_MS,
      verifyTurnstile: async () => true,
      randomBytes: (bytes) => {
        bytes.fill(fillByte);
        return bytes;
      },
      upstreamFetch: options.upstreamFetch || (async () => Response.json([
        { sgv: 110, date: 1785000000000 },
      ])),
    },
  );
  return { response, cookie: response.headers.get("set-cookie") };
}

test("issues a 256-bit opaque __Host cookie with strict browser-only attributes", async () => {
  const token = generateDeviceSessionToken((bytes) => {
    bytes.fill(9);
    return bytes;
  });
  assert.equal(token.length, 43);
  const cookie = buildDeviceSessionCookie(token, readConfig(deviceEnv()));
  assert.match(cookie, /^__Host-glucoscope_relay_session=[A-Za-z0-9_-]{43}; Path=\//u);
  assert.match(cookie, /; Max-Age=15552000;/u);
  assert.match(cookie, /; Secure;/u);
  assert.match(cookie, /; HttpOnly;/u);
  assert.match(cookie, /; SameSite=Strict$/u);
  assert.doesNotMatch(cookie, /Domain=/iu);
  assert.equal(
    buildDeviceSessionClearCookie(),
    "__Host-glucoscope_relay_session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict",
  );
});

test("cookie parser rejects forged shapes and duplicate device cookies", () => {
  assert.equal(readDeviceSessionCookie(apiRequest("/v1/device-session/status", {})), null);
  assert.throws(
    () => readDeviceSessionCookie(apiRequest("/v1/device-session/status", {}, {
      cookie: "__Host-glucoscope_relay_session=short",
    })),
    /device_session_invalid/,
  );
  assert.throws(
    () => readDeviceSessionCookie(apiRequest("/v1/device-session/status", {}, {
      cookie: `__Host-glucoscope_relay_session=${"a".repeat(43)}; __Host-glucoscope_relay_session=${"b".repeat(43)}`,
    })),
    /device_session_invalid/,
  );
});

test("stores only anonymous hashes, lifecycle timestamps, and the UTC counter", async () => {
  const storage = createMemoryStorage();
  const token = generateDeviceSessionToken((bytes) => {
    bytes.fill(3);
    return bytes;
  });
  const tokenId = await deriveDeviceSessionId(token, SECRET);
  const fingerprint = await deriveSourceCredentialFingerprint(
    SOURCE_URL,
    CREDENTIAL,
    tokenId,
    SECRET,
    readConfig(deviceEnv()),
  );
  await createDeviceSessionStorage(storage, { tokenId, nowMs: NOW_MS, idleTtlMs: 86_400_000 });
  const result = await authorizeDeviceSessionStorage(storage, {
    tokenId,
    sourceFingerprint: fingerprint,
    consume: true,
    dailyLimit: 3_000,
    nowMs: NOW_MS + 1_000,
    idleTtlMs: 86_400_000,
  });
  assert.equal(result.status, "active");
  const record = storage.values.get(DEVICE_SESSION_STORAGE_KEY);
  assert.deepEqual(Object.keys(record).sort(), [
    "createdAt",
    "dayBucket",
    "dayCount",
    "idleExpiresAt",
    "lastSeenAt",
    "revoked",
    "sourceFingerprint",
    "tokenId",
  ]);
  const serialized = JSON.stringify(record);
  for (const sensitive of [
    SOURCE_URL,
    CREDENTIAL,
    "110",
    "127.0.0.1",
    "Mozilla",
    "display name",
    "person@example.com",
    token,
  ]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("source fingerprints are stable only inside one device session", async () => {
  const config = readConfig(deviceEnv());
  const firstTokenId = await deriveDeviceSessionId("d".repeat(43), SECRET);
  const secondTokenId = await deriveDeviceSessionId("e".repeat(43), SECRET);
  const first = await deriveSourceCredentialFingerprint(
    SOURCE_URL,
    CREDENTIAL,
    firstTokenId,
    SECRET,
    config,
  );
  const firstAgain = await deriveSourceCredentialFingerprint(
    SOURCE_URL,
    CREDENTIAL,
    firstTokenId,
    SECRET,
    config,
  );
  const second = await deriveSourceCredentialFingerprint(
    SOURCE_URL,
    CREDENTIAL,
    secondTokenId,
    SECRET,
    config,
  );
  assert.equal(first, firstAgain);
  assert.notEqual(first, second);
});

test("binds the first source fingerprint and rejects a different source without consuming count", async () => {
  const storage = createMemoryStorage();
  await createDeviceSessionStorage(storage, { tokenId: TOKEN_ID, nowMs: NOW_MS, idleTtlMs: 86_400_000 });
  const first = await authorizeDeviceSessionStorage(storage, {
    tokenId: TOKEN_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    consume: true,
    dailyLimit: 10,
    nowMs: NOW_MS + 1,
    idleTtlMs: 86_400_000,
  });
  const mismatch = await authorizeDeviceSessionStorage(storage, {
    tokenId: TOKEN_ID,
    sourceFingerprint: "c".repeat(43),
    consume: true,
    dailyLimit: 10,
    nowMs: NOW_MS + 2,
    idleTtlMs: 86_400_000,
  });
  assert.equal(first.status, "active");
  assert.equal(mismatch.status, "source_mismatch");
  assert.equal(storage.values.get(DEVICE_SESSION_STORAGE_KEY).dayCount, 1);
});

test("enforces the exact daily boundary atomically under parallel requests and resets in UTC", async () => {
  const storage = createMemoryStorage();
  await createDeviceSessionStorage(storage, { tokenId: TOKEN_ID, nowMs: NOW_MS, idleTtlMs: 172_800_000 });
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
    authorizeDeviceSessionStorage(storage, {
      tokenId: TOKEN_ID,
      sourceFingerprint: SOURCE_FINGERPRINT,
      consume: true,
      dailyLimit: 10,
      nowMs: NOW_MS + index + 1,
      idleTtlMs: 172_800_000,
    })));
  assert.equal(results.filter((result) => result.status === "active").length, 10);
  assert.equal(results.filter((result) => result.status === "rate_limited").length, 10);
  assert.equal(storage.values.get(DEVICE_SESSION_STORAGE_KEY).dayCount, 10);

  const nextDay = await authorizeDeviceSessionStorage(storage, {
    tokenId: TOKEN_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    consume: true,
    dailyLimit: 10,
    nowMs: NOW_MS + 24 * 60 * 60 * 1000,
    idleTtlMs: 172_800_000,
  });
  assert.equal(nextDay.status, "active");
  assert.equal(nextDay.dayCount, 1);
});

test("revocation and alarm cleanup make the same token unusable", async () => {
  const revokedStorage = createMemoryStorage();
  await createDeviceSessionStorage(revokedStorage, { tokenId: TOKEN_ID, nowMs: NOW_MS, idleTtlMs: 60_000 });
  assert.equal((await revokeDeviceSessionStorage(revokedStorage, { tokenId: TOKEN_ID })).status, "revoked");
  assert.equal((await authorizeDeviceSessionStorage(revokedStorage, {
    tokenId: TOKEN_ID,
    sourceFingerprint: null,
    consume: false,
    nowMs: NOW_MS + 1,
    idleTtlMs: 60_000,
  })).status, "invalid");

  const expiredStorage = createMemoryStorage();
  await createDeviceSessionStorage(expiredStorage, { tokenId: TOKEN_ID, nowMs: NOW_MS, idleTtlMs: 60_000 });
  const pending = await cleanupDeviceSessionStorage(expiredStorage, { nowMs: NOW_MS + 59_999 });
  assert.deepEqual(pending, { status: "active", nextAlarmAt: NOW_MS + 60_000 });
  assert.equal((await cleanupDeviceSessionStorage(expiredStorage, { nowMs: NOW_MS + 60_000 })).status, "deleted");
  assert.equal(expiredStorage.values.has(DEVICE_SESSION_STORAGE_KEY), false);

  const corruptStorage = createMemoryStorage();
  corruptStorage.values.set(DEVICE_SESSION_STORAGE_KEY, { credential: CREDENTIAL });
  assert.equal((await cleanupDeviceSessionStorage(corruptStorage, { nowMs: NOW_MS })).status, "deleted");
  assert.equal(corruptStorage.values.has(DEVICE_SESSION_STORAGE_KEY), false);
});

test("alarm write failures roll back session creation and authorization atomically", async () => {
  const createStorage = createMemoryStorage();
  createStorage.failNextAlarmWrite();
  await assert.rejects(
    createDeviceSessionStorage(createStorage, {
      tokenId: TOKEN_ID,
      nowMs: NOW_MS,
      idleTtlMs: 60_000,
    }),
    /test alarm write failure/,
  );
  assert.equal(createStorage.values.has(DEVICE_SESSION_STORAGE_KEY), false);
  assert.equal(createStorage.alarmAt, null);

  const authorizeStorage = createMemoryStorage();
  await createDeviceSessionStorage(authorizeStorage, {
    tokenId: TOKEN_ID,
    nowMs: NOW_MS,
    idleTtlMs: 60_000,
  });
  const recordBefore = authorizeStorage.values.get(DEVICE_SESSION_STORAGE_KEY);
  const alarmBefore = authorizeStorage.alarmAt;
  authorizeStorage.failNextAlarmWrite();
  await assert.rejects(
    authorizeDeviceSessionStorage(authorizeStorage, {
      tokenId: TOKEN_ID,
      sourceFingerprint: SOURCE_FINGERPRINT,
      consume: true,
      dailyLimit: 10,
      nowMs: NOW_MS + 1,
      idleTtlMs: 60_000,
    }),
    /test alarm write failure/,
  );
  assert.deepEqual(authorizeStorage.values.get(DEVICE_SESSION_STORAGE_KEY), recordBefore);
  assert.equal(authorizeStorage.alarmAt, alarmBefore);

  const retry = await authorizeDeviceSessionStorage(authorizeStorage, {
    tokenId: TOKEN_ID,
    sourceFingerprint: SOURCE_FINGERPRINT,
    consume: true,
    dailyLimit: 10,
    nowMs: NOW_MS + 2,
    idleTtlMs: 60_000,
  });
  assert.equal(retry.status, "active");
  assert.equal(retry.dayCount, 1);
});

test("cleanup failures schedule another alarm beyond the platform retry window", async () => {
  const retryAt = NOW_MS + 60 * 60 * 1000;
  let transactionCalls = 0;
  const retryStorage = {
    alarmAt: null,
    async transaction() {
      transactionCalls += 1;
      throw new Error("test cleanup storage failure");
    },
    async setAlarm(value) {
      this.alarmAt = value;
    },
  };

  const scheduled = await cleanupDeviceSessionStorageWithRetry(retryStorage, { nowMs: NOW_MS });
  assert.deepEqual(scheduled, { status: "retry_scheduled", nextAlarmAt: retryAt });
  assert.equal(retryStorage.alarmAt, retryAt);
  assert.equal(transactionCalls, 1);

  const unavailableStorage = {
    async transaction() {
      throw new Error("original cleanup failure");
    },
    async setAlarm() {
      throw new Error("retry alarm failure");
    },
  };
  await assert.rejects(
    cleanupDeviceSessionStorageWithRetry(unavailableStorage, { nowMs: NOW_MS }),
    /original cleanup failure/,
  );
});

test("device session HTTP flow creates, probes, binds, rotates, and deletes", async () => {
  const localEnv = deviceEnv();
  const first = await createSession(localEnv, 4);
  assert.equal(first.response.status, 201);
  assert.deepEqual(await first.response.json(), {
    ok: true,
    session: { status: "active" },
    entries: [{
      sgv: 110,
      date: 1785000000000,
      dateString: "2026-07-25T17:20:00.000Z",
    }],
  });
  assert.equal(first.response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(first.response.headers.get("access-control-allow-credentials"), "true");
  assert.ok(first.cookie.includes("HttpOnly"));
  const firstToken = tokenFromSetCookie(first.cookie);
  assert.equal(JSON.stringify(await (async () => ({ ok: true }))()).includes(firstToken), false);

  const status = await handleRelayRequest(
    apiRequest("/v1/device-session/status", {}, { cookie: `${first.cookie.split(";")[0]}` }),
    localEnv,
    { now: () => NOW_MS + 1_000 },
  );
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { ok: true, session: { status: "active" } });
  assert.equal(tokenFromSetCookie(status.headers.get("set-cookie")), firstToken);

  const entries = await handleRelayRequest(
    apiRequest("/v1/entries", entryPayload(), { cookie: first.cookie.split(";")[0] }),
    localEnv,
    {
      now: () => NOW_MS + 2_000,
      upstreamFetch: async () => Response.json([{ sgv: 110, date: 1785000000000 }]),
    },
  );
  assert.equal(entries.status, 200);
  assert.equal((await entries.json()).entries[0].sgv, 110);

  const rotated = await createSession(localEnv, 5, { cookie: first.cookie.split(";")[0], nowMs: NOW_MS + 3_000 });
  assert.equal(rotated.response.status, 201);
  const rotatedToken = tokenFromSetCookie(rotated.cookie);
  assert.notEqual(rotatedToken, firstToken);

  const oldStatus = await handleRelayRequest(
    apiRequest("/v1/device-session/status", {}, {
      cookie: `__Host-glucoscope_relay_session=${firstToken}`,
    }),
    localEnv,
    { now: () => NOW_MS + 4_000 },
  );
  assert.equal(oldStatus.status, 401);
  assert.deepEqual(await oldStatus.json(), { ok: false, error: "device_session_invalid" });

  const deleted = await handleRelayRequest(
    apiRequest("/v1/device-session", undefined, {
      method: "DELETE",
      cookie: `__Host-glucoscope_relay_session=${rotatedToken}`,
    }),
    localEnv,
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { ok: true });
  assert.equal(deleted.headers.get("set-cookie"), buildDeviceSessionClearCookie());

  const deletedStatus = await handleRelayRequest(
    apiRequest("/v1/device-session/status", {}, {
      cookie: `__Host-glucoscope_relay_session=${rotatedToken}`,
    }),
    localEnv,
  );
  assert.equal(deletedStatus.status, 401);
});

test("a failed replacement keeps the previous working device session", async () => {
  const localEnv = deviceEnv();
  const created = await createSession(localEnv, 6);
  const oldCookie = created.cookie.split(";")[0];
  const oldToken = tokenFromSetCookie(created.cookie);
  const storageCountBefore = localEnv.RELAY_DEVICE_SESSION.storages.size;

  for (const upstreamResponse of [
    new Response("denied", { status: 401 }),
    Response.json([]),
  ]) {
    const failed = await handleRelayRequest(
      apiRequest("/v1/device-session", {
        turnstileToken: "replacement-turnstile-token",
        sourceUrl: "https://replacement.ns.gluroo.com",
        credential: "replacement-credential",
      }, { cookie: oldCookie }),
      localEnv,
      {
        now: () => NOW_MS + 5_000,
        verifyTurnstile: async () => true,
        upstreamFetch: async () => upstreamResponse.clone(),
      },
    );
    assert.notEqual(failed.status, 201);
    assert.equal(failed.headers.get("set-cookie"), null);

    const oldStatus = await handleRelayRequest(
      apiRequest("/v1/device-session/status", {}, { cookie: oldCookie }),
      localEnv,
      { now: () => NOW_MS + 6_000 },
    );
    assert.equal(oldStatus.status, 200);
    assert.equal(tokenFromSetCookie(oldStatus.headers.get("set-cookie")), oldToken);
    assert.equal(localEnv.RELAY_DEVICE_SESSION.storages.size, storageCountBefore);
  }
});

test("HTTP source mismatch is a 401 and never reaches the upstream", async () => {
  const localEnv = deviceEnv();
  const created = await createSession(localEnv, 8);
  const cookie = created.cookie.split(";")[0];
  const first = await handleRelayRequest(
    apiRequest("/v1/entries", entryPayload(), { cookie }),
    localEnv,
    {
      now: () => NOW_MS + 1_000,
      upstreamFetch: async () => Response.json([{ sgv: 100, date: 1785000000000 }]),
    },
  );
  assert.equal(first.status, 200);

  let upstreamCalled = false;
  const mismatch = await handleRelayRequest(
    apiRequest("/v1/entries", entryPayload({
      sourceUrl: "https://different.ns.gluroo.com",
      credential: "different-test-credential",
    }), { cookie }),
    localEnv,
    {
      now: () => NOW_MS + 2_000,
      upstreamFetch: async () => {
        upstreamCalled = true;
        return Response.json([]);
      },
    },
  );
  assert.equal(mismatch.status, 401);
  assert.deepEqual(await mismatch.json(), { ok: false, error: "device_session_source_mismatch" });
  assert.equal(upstreamCalled, false);
});

test("forged and expired cookies fail closed and are cleared", async () => {
  const localEnv = deviceEnv({ RELAY_DEVICE_SESSION_IDLE_TTL_SECONDS: "60" });
  const forged = await handleRelayRequest(
    apiRequest("/v1/device-session/status", {}, {
      cookie: `__Host-glucoscope_relay_session=${"z".repeat(43)}`,
    }),
    localEnv,
  );
  assert.equal(forged.status, 401);
  assert.equal(forged.headers.get("set-cookie"), buildDeviceSessionClearCookie());

  const created = await createSession(localEnv, 2);
  const expired = await handleRelayRequest(
    apiRequest("/v1/device-session/status", {}, { cookie: created.cookie.split(";")[0] }),
    localEnv,
    { now: () => NOW_MS + 60_000 },
  );
  assert.equal(expired.status, 401);
  assert.deepEqual(await expired.json(), { ok: false, error: "device_session_invalid" });
});

test("a received deletion clears the browser cookie even when server revocation fails", async () => {
  const response = await handleRelayRequest(
    apiRequest("/v1/device-session", undefined, {
      method: "DELETE",
      cookie: `__Host-glucoscope_relay_session=${"d".repeat(43)}`,
    }),
    deviceEnv(),
    {
      revokeDeviceSession: async () => {
        throw new Error("synthetic storage failure");
      },
    },
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "upstream_unavailable" });
  assert.equal(response.headers.get("set-cookie"), buildDeviceSessionClearCookie());
});

test("wrong origins, disabled flags, absent secrets, and the removed session route fail closed", async () => {
  const localEnv = deviceEnv();
  const wrongOrigin = await handleRelayRequest(
    apiRequest("/v1/device-session/status", {}, { origin: "https://evil.example" }),
    localEnv,
  );
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get("access-control-allow-origin"), null);

  const disabled = await handleRelayRequest(
    apiRequest("/v1/device-session", { turnstileToken: "test" }),
    deviceEnv({ RELAY_DEVICE_SESSIONS_ENABLED: "false" }),
  );
  assert.equal(disabled.status, 503);
  assert.deepEqual(await disabled.json(), { ok: false, error: "relay_temporarily_paused" });

  const secretMissing = await handleRelayRequest(
    apiRequest("/v1/device-session", {
      turnstileToken: "test",
      sourceUrl: SOURCE_URL,
      credential: CREDENTIAL,
    }),
    deviceEnv({ RELAY_DEVICE_SESSION_SECRET: undefined }),
    {
      verifyTurnstile: async () => true,
      randomBytes: (bytes) => {
        bytes.fill(1);
        return bytes;
      },
    },
  );
  assert.equal(secretMissing.status, 503);

  const flags = readConfig(deviceEnv({
    RELAY_DEVICE_SESSIONS_ENABLED: "false",
  }));
  assert.equal(flags.deviceSessionsEnabled, false);

  let verified = false;
  const removedSessionRoute = await handleRelayRequest(
    apiRequest("/v1/session", { turnstileToken: "test" }),
    deviceEnv(),
    { verifyTurnstile: async () => { verified = true; } },
  );
  assert.equal(removedSessionRoute.status, 404);
  assert.equal(verified, false);
});

test("device counter is consumed before the global counter and both precede upstream", async () => {
  const calls = [];
  const response = await handleRelayRequest(
    apiRequest("/v1/entries", entryPayload(), {
      cookie: `__Host-glucoscope_relay_session=${"d".repeat(43)}`,
    }),
    deviceEnv(),
    {
      authorizeDeviceSession: async () => {
        calls.push("device");
        return { tokenId: "e".repeat(43), result: { status: "active" } };
      },
      consumeGlobalLimit: async () => {
        calls.push("global");
        return { globalCount: 1, warning: false };
      },
      upstreamFetch: async () => {
        calls.push("upstream");
        return Response.json([{ sgv: 100, date: 1785000000000 }]);
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["device", "global", "upstream"]);
});

test("device-session CORS preflight advertises credentials and DELETE only on its resource", async () => {
  const response = await handleRelayRequest(
    apiRequest("/v1/device-session", undefined, { method: "OPTIONS" }),
    deviceEnv(),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, DELETE, OPTIONS");
});

test("rejects query strings on every public route before authentication, storage, or upstream work", async () => {
  let called = false;
  const services = {
    verifyTurnstile: async () => { called = true; },
    issueDeviceSession: async () => { called = true; },
    authorizeDeviceSession: async () => { called = true; },
    revokeDeviceSession: async () => { called = true; },
    consumeGlobalLimit: async () => { called = true; },
    upstreamFetch: async () => {
      called = true;
      return Response.json([]);
    },
  };
  for (const pathname of [
    "/v1/device-session?unexpected=1",
    "/v1/device-session/status?unexpected=1",
    "/v1/entries?unexpected=1",
  ]) {
    const response = await handleRelayRequest(apiRequest(pathname, {}), deviceEnv(), services);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_request" });
  }
  assert.equal(called, false);
});
