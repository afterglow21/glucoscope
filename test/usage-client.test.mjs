import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/usage-client.js", import.meta.url), "utf8");
const STORAGE_KEY = "glucoscope.usageProfile.v1";
const PROFILE_ID = "123e4567-e89b-42d3-a456-426614174000";
const PROFILE_TOKEN = "A".repeat(43);
const NEW_PROFILE_ID = "123e4567-e89b-42d3-a456-426614174999";
const NEW_PROFILE_TOKEN = "B".repeat(43);

function createStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    calls,
    getItem(key) {
      calls.get += 1;
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      calls.set += 1;
      values.set(key, String(value));
    },
    removeItem(key) {
      calls.remove += 1;
      values.delete(key);
    }
  };
}

function stored(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 1,
    profileId: PROFILE_ID,
    profileToken: PROFILE_TOKEN,
    lifecycleGeneration: 0,
    collectionEnabled: true,
    lastVisitDay: "",
    ordinaryMemoryCount: -1,
    pendingAiEvents: [],
    ...overrides
  });
}

function loadModule({
  storage = createStorage(),
  fetchImpl,
  cryptoImpl,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const calls = [];
  const context = {
    localStorage: storage,
    fetch: fetchImpl || (async (url, init) => {
      calls.push({ url, init });
      return Response.json({ ok: true, results: [] });
    }),
    crypto: cryptoImpl || { randomUUID: () => "123e4567-e89b-42d3-a456-426614174111" },
    AbortController,
    setTimeout: setTimeoutImpl,
    clearTimeout: clearTimeoutImpl,
    Date,
    Object,
    Array,
    String,
    Number,
    JSON,
    RegExp,
    Set,
    Promise
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "usage-client.js" });
  return { api: context.GlucoScopeUsage, context, storage, calls };
}

function configure(api, enabled = true) {
  api.configure({ enabled, endpoint: "https://usage.example" });
}

test("module import and disabled init create no identifier, storage write, or request", async () => {
  const { api, storage, calls } = loadModule();
  assert.equal(storage.calls.get, 0);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
  assert.equal(api.getState().registered, false);
  await api.init();
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
  assert.equal(calls.length, 0);
});

test("enabled init without an explicit start creates no profile, storage write, or request", async () => {
  const { api, storage, calls } = loadModule();
  configure(api, true);
  await api.init();
  assert.equal(api.getState().registered, false);
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal((await api.syncOrdinaryMemoryCount(0)).skipped, true);
  assert.equal(storage.calls.set, 0);
  assert.equal(storage.calls.remove, 0);
  assert.equal(calls.length, 0);
});

test("start is explicit and sends only the profile allowlist", async () => {
  const storage = createStorage();
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return Response.json({
        ok: true,
        profile: { id: PROFILE_ID, displayName: "グルコさん", collectionEnabled: true },
        profileToken: PROFILE_TOKEN
      }, { status: 201 });
    }
  });
  configure(api);

  const result = await api.start({
    displayName: "  グルコさん  ",
    turnstileToken: "turnstile-token",
    glucose: 123,
    connectionUrl: "https://secret.example",
    aiLetterText: "secret"
  });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "https://usage.example/v1/profiles");
  assert.deepEqual(Object.keys(JSON.parse(seen[0].init.body)), [
    "displayName",
    "turnstileToken"
  ]);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(Object.keys(persisted), [
    "schemaVersion",
    "profileId",
    "profileToken",
    "lifecycleGeneration",
    "collectionEnabled",
    "lastVisitDay",
    "ordinaryMemoryCount",
    "pendingAiEvents"
  ]);
  assert.equal("glucose" in persisted, false);
  assert.equal("connectionUrl" in persisted, false);
  assert.equal(api.getState().profileToken, undefined);
});

test("start aborts an unresponsive profile request and never writes late credentials or events", async () => {
  const storage = createStorage();
  const seen = [];
  let lateResolve;
  let aborted = false;
  const { api } = loadModule({
    storage,
    setTimeoutImpl(callback, delay) {
      assert.equal(delay, 10_000);
      queueMicrotask(callback);
      return 1;
    },
    clearTimeoutImpl() {},
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Promise((resolve, reject) => {
        lateResolve = resolve;
        init.signal.addEventListener("abort", () => {
          aborted = true;
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  });
  configure(api);

  const result = await api.start({
    displayName: "Gluco",
    turnstileToken: "turnstile-token"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "request_timeout");
  assert.equal(aborted, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.signal.aborted, true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(api.getState().registered, false);

  lateResolve(Response.json({
    ok: true,
    profile: { id: PROFILE_ID, displayName: "Gluco", collectionEnabled: true },
    profileToken: PROFILE_TOKEN
  }, { status: 201 }));
  await Promise.resolve();
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal(seen.length, 1);
});

test("start forwards a caller abort and clears its timeout without storing a profile", async () => {
  const storage = createStorage();
  const controller = new AbortController();
  let clearCalls = 0;
  let requestSignal;
  const { api } = loadModule({
    storage,
    setTimeoutImpl() { return 19; },
    clearTimeoutImpl(id) {
      assert.equal(id, 19);
      clearCalls += 1;
    },
    fetchImpl: async (url, init) => {
      requestSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      });
    }
  });
  configure(api);

  const starting = api.start({
    displayName: "Gluco",
    turnstileToken: "turnstile-token",
    signal: controller.signal
  });
  controller.abort();
  const result = await starting;

  assert.equal(result.ok, false);
  assert.equal(result.error, "request_aborted");
  assert.equal(requestSignal.aborted, true);
  assert.equal(clearCalls, 1);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(api.getState().registered, false);
});

test("start rejects an empty normalized display name before storage writes or network", async () => {
  const emptyNames = [undefined, "", "   ", "\u0000\u200e\u2066\t"];

  for (const displayName of emptyNames) {
    const storage = createStorage();
    const { api, calls } = loadModule({ storage });
    configure(api);

    const result = await api.start({
      displayName,
      turnstileToken: "turnstile-token"
    });

    assert.equal(result.ok, false);
    assert.equal(result.error, "display_name_required");
    assert.equal(storage.calls.set, 0);
    assert.equal(storage.calls.remove, 0);
    assert.equal(calls.length, 0);
  }
});

test("start verifies writable storage before creating a server profile", async () => {
  let requests = 0;
  const storage = {
    getItem() { return null; },
    setItem() { throw new Error("blocked"); },
    removeItem() {}
  };
  const { api } = loadModule({
    storage,
    fetchImpl: async () => {
      requests += 1;
      return Response.json({ ok: true });
    }
  });
  configure(api);

  const result = await api.start({
    displayName: "Gluco",
    turnstileToken: "turnstile-token"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "storage_write_failed");
  assert.equal(requests, 0);
});

test("a post-create persistence failure deletes the unreachable server profile", async () => {
  const values = new Map();
  const seen = [];
  const storage = {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) {
      if (String(value).includes(`\"profileToken\"`)) throw new Error("quota");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (url.endsWith("/v1/profiles")) {
        return Response.json({
          ok: true,
          profile: { id: PROFILE_ID, displayName: "nickname", collectionEnabled: true },
          profileToken: PROFILE_TOKEN
        }, { status: 201 });
      }
      return Response.json({ ok: true, deleted: true });
    }
  });
  configure(api);

  const result = await api.start({
    displayName: "Gluco",
    turnstileToken: "turnstile-token"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "storage_write_failed");
  assert.equal(result.serverCleanupPending, false);
  assert.equal(seen.length, 2);
  assert.equal(seen[1].url, "https://usage.example/v1/me");
  assert.equal(seen[1].init.method, "DELETE");
  assert.equal(seen[1].init.headers.Authorization, `Bearer ${PROFILE_TOKEN}`);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("a visit is sent once per local day and contains no metadata", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return Response.json({ ok: true, results: [{ accepted: true }] });
    }
  });
  configure(api);

  assert.equal((await api.recordVisit()).ok, true);
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal(seen.length, 1);
  const body = JSON.parse(seen[0].init.body);
  assert.deepEqual(Object.keys(body), ["events"]);
  assert.deepEqual(Object.keys(body.events[0]), ["type", "eventId"]);
  assert.equal(body.events[0].type, "visit_day");
  assert.equal(body.events[0].eventId, "123e4567-e89b-42d3-a456-426614174111");
  assert.equal(seen[0].init.headers.Authorization, `Bearer ${PROFILE_TOKEN}`);
});

test("AI success uses an opaque id, drops caller metadata, and queues a failed request", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let attempt = 0;
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      attempt += 1;
      seen.push({ url, init });
      if (attempt === 1) throw new Error("offline");
      return Response.json({ ok: true, results: [{ accepted: true }] });
    }
  });
  configure(api);

  const first = await api.recordAiGeneration({ glucose: 140, mode: "deep", text: "secret" });
  assert.equal(first.ok, false);
  assert.equal(first.queued, true);
  let persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.pendingAiEvents.length, 1);
  assert.deepEqual(Object.keys(persisted.pendingAiEvents[0]), ["type", "eventId"]);

  await api.init();
  persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.deepEqual(persisted.pendingAiEvents, []);
  const retried = JSON.parse(seen[1].init.body).events[0];
  assert.deepEqual(Object.keys(retried), ["type", "eventId"]);
  assert.equal(retried.type, "ai_generation_success");
});

test("AI quota request context returns one ephemeral credential without exposing or persisting it", () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const { api, calls } = loadModule({ storage });
  configure(api);
  const writesBefore = storage.calls.set;

  assert.deepEqual({ ...api.createAiQuotaRequestContext() }, {
    ok: true,
    requestId: "123e4567-e89b-42d3-a456-426614174111",
    quotaCredentialKind: "device_profile",
    authorization: `Bearer ${PROFILE_TOKEN}`
  });
  assert.equal(api.getState().profileToken, undefined);
  assert.equal(storage.calls.set, writesBefore);
  assert.equal(calls.length, 0);
  assert.equal(storage.getItem(STORAGE_KEY).includes("123e4567-e89b-42d3-a456-426614174111"), false);
});

test("stopping optional usage recording keeps quota authentication but sends no analytics event", async () => {
  const storage = createStorage({
    [STORAGE_KEY]: stored({ collectionEnabled: false })
  });
  const { api, calls } = loadModule({ storage });
  configure(api);

  assert.equal(api.createAiQuotaRequestContext().ok, true);
  assert.equal((await api.recordAiGeneration()).skipped, true);
  assert.equal(calls.length, 0);
});

test("missing, deleted, malformed, or insecure profile state cannot create quota authentication", async () => {
  const empty = loadModule();
  configure(empty.api);
  assert.equal(empty.api.createAiQuotaRequestContext().error, "profile_not_found");

  const malformed = loadModule({
    storage: createStorage({ [STORAGE_KEY]: "not-json" })
  });
  configure(malformed.api);
  assert.equal(malformed.api.createAiQuotaRequestContext().error, "invalid_profile");

  const insecure = loadModule({
    storage: createStorage({ [STORAGE_KEY]: stored() }),
    cryptoImpl: { randomUUID: () => "predictable" }
  });
  configure(insecure.api);
  assert.equal(insecure.api.createAiQuotaRequestContext().error, "secure_id_unavailable");

  const deleted = loadModule({
    storage: createStorage({ [STORAGE_KEY]: stored() }),
    fetchImpl: async () => Response.json({ ok: true, deleted: true })
  });
  configure(deleted.api);
  assert.equal((await deleted.api.deleteData()).ok, true);
  assert.equal(deleted.api.createAiQuotaRequestContext().error, "profile_not_found");
});

test("ordinary memory snapshots are monotonic and bounded to 0 through 50", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return Response.json({ ok: true, results: [{ accepted: true }] });
    }
  });
  configure(api);

  assert.equal((await api.syncOrdinaryMemoryCount(4)).ok, true);
  assert.equal((await api.syncOrdinaryMemoryCount(4)).skipped, true);
  assert.equal((await api.syncOrdinaryMemoryCount(51)).error, "invalid_memory_count");
  assert.equal(seen.length, 1);
  const event = JSON.parse(seen[0].init.body).events[0];
  assert.deepEqual(Object.keys(event), ["type", "eventId", "count"]);
  assert.equal(event.type, "ordinary_gluco_memory_count");
  assert.equal(event.count, 4);
});

test("an in-flight visit cannot restore collection after a failed stop", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let releaseVisit;
  const visitResponse = new Promise((resolve) => { releaseVisit = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "PATCH") {
        return Response.json({ ok: false, error: "temporary" }, { status: 503 });
      }
      return visitResponse;
    }
  });
  configure(api);

  const inFlightVisit = api.recordVisit();
  const stopped = await api.updateProfile({ collectionEnabled: false });
  assert.equal(stopped.ok, false);
  releaseVisit(Response.json({ ok: true, results: [{ accepted: true }] }));
  assert.equal((await inFlightVisit).ok, true);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, false);
  assert.equal(api.getState().collectionEnabled, false);
});

test("a profile PATCH times out without accepting a late resume response", async () => {
  const storage = createStorage({
    [STORAGE_KEY]: stored({ collectionEnabled: false })
  });
  let requestSignal;
  let sawTimeoutDelay = false;
  const { api } = loadModule({
    storage,
    setTimeoutImpl(callback, delay) {
      assert.equal(delay, 10_000);
      sawTimeoutDelay = true;
      queueMicrotask(callback);
      return 29;
    },
    clearTimeoutImpl(id) {
      assert.equal(id, 29);
    },
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise((resolve) => {
        init.signal.addEventListener("abort", () => {
          // Model a response that becomes available after cancellation. The
          // request layer must still report the timeout and ignore its state.
          resolve(Response.json({
            ok: true,
            profile: { collectionEnabled: true }
          }));
        }, { once: true });
      });
    }
  });
  configure(api);

  const result = await api.updateProfile({ collectionEnabled: true });
  assert.equal(sawTimeoutDelay, true);
  assert.equal(requestSignal.aborted, true);
  assert.equal(result.ok, false);
  assert.equal(result.error, "request_timeout");
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, false);
  assert.equal(api.getState().collectionEnabled, false);
});

test("an authentication-required profile PATCH forgets only its stale local credential", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return Response.json(
        { ok: false, error: "authentication_required" },
        { status: 401 }
      );
    }
  });
  configure(api);

  const result = await api.updateProfile({ displayName: "Gluco" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "authentication_required");
  assert.equal(result.staleProfileForgotten, true);
  assert.equal(result.staleProfileCleanupError, undefined);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(api.getState().registered, false);
  assert.equal(api.getState().collectionEnabled, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, "PATCH");
});

test("a stale profile PATCH never removes a newer profile written while it is in flight", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let releasePatch;
  const patchResponse = new Promise((resolve) => { releasePatch = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async () => patchResponse
  });
  configure(api);

  const stalePatch = api.updateProfile({ displayName: "old" });
  storage.setItem(STORAGE_KEY, stored({
    profileId: NEW_PROFILE_ID,
    profileToken: NEW_PROFILE_TOKEN,
    lifecycleGeneration: 1
  }));
  releasePatch(Response.json(
    { ok: false, error: "authentication_required" },
    { status: 401 }
  ));

  const result = await stalePatch;
  assert.equal(result.ok, false);
  assert.equal(result.error, "authentication_required");
  assert.equal(result.staleProfileForgotten, false);
  assert.equal(result.staleProfileCleanupError, undefined);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.profileId, NEW_PROFILE_ID);
  assert.equal(persisted.profileToken, NEW_PROFILE_TOKEN);
  assert.equal(api.getState().registered, true);
  assert.equal(api.getState().profileId, NEW_PROFILE_ID);
  assert.equal(storage.calls.remove, 0);
});

test("a stale profile PATCH never removes a newer lifecycle of the same profile", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let releasePatch;
  const patchResponse = new Promise((resolve) => { releasePatch = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async () => patchResponse
  });
  configure(api);

  const stalePatch = api.updateProfile({ displayName: "old" });
  storage.setItem(STORAGE_KEY, stored({
    lifecycleGeneration: 1,
    collectionEnabled: false
  }));
  releasePatch(Response.json(
    { ok: false, error: "authentication_required" },
    { status: 401 }
  ));

  const result = await stalePatch;
  assert.equal(result.ok, false);
  assert.equal(result.error, "authentication_required");
  assert.equal(result.staleProfileForgotten, false);
  assert.equal(result.staleProfileCleanupError, undefined);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.profileId, PROFILE_ID);
  assert.equal(persisted.profileToken, PROFILE_TOKEN);
  assert.equal(persisted.lifecycleGeneration, 1);
  assert.equal(persisted.collectionEnabled, false);
  assert.equal(storage.calls.remove, 0);
});

test("no usage event is sent after stale-profile cleanup", async () => {
  const storage = createStorage({
    [STORAGE_KEY]: stored({
      pendingAiEvents: [{
        type: "ai_generation_success",
        eventId: "123e4567-e89b-42d3-a456-426614174222"
      }]
    })
  });
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return Response.json(
        { ok: false, error: "authentication_required" },
        { status: 401 }
      );
    }
  });
  configure(api);

  assert.equal((await api.updateProfile({ displayName: "Gluco" })).staleProfileForgotten, true);
  await api.init();
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal((await api.recordAiGeneration()).skipped, true);
  assert.equal((await api.syncOrdinaryMemoryCount(1)).skipped, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, "PATCH");
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("an in-flight AI failure cannot recreate a profile after deletion", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let rejectAi;
  const aiResponse = new Promise((resolve, reject) => { rejectAi = reject; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "DELETE") return Response.json({ ok: true, deleted: true });
      return aiResponse;
    }
  });
  configure(api);

  const inFlightAi = api.recordAiGeneration();
  assert.equal((await api.deleteData()).ok, true);
  rejectAi(new Error("offline"));
  const aiResult = await inFlightAi;
  assert.equal(aiResult.ok, false);
  assert.equal(aiResult.queued, false);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(api.getState().registered, false);
});

test("an in-flight memory update cannot override a successful stop", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let releaseMemory;
  const memoryResponse = new Promise((resolve) => { releaseMemory = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "PATCH") {
        return Response.json({ ok: true, profile: { collectionEnabled: true } });
      }
      return memoryResponse;
    }
  });
  configure(api);

  const inFlightMemory = api.syncOrdinaryMemoryCount(4);
  assert.equal((await api.updateProfile({ collectionEnabled: false })).ok, true);
  releaseMemory(Response.json({ ok: true, results: [{ accepted: true }] }));
  assert.equal((await inFlightMemory).ok, true);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.collectionEnabled, false);
  assert.equal(persisted.ordinaryMemoryCount, -1);
  assert.equal(api.getState().collectionEnabled, false);
});

test("a pre-stop failed AI event stays discarded after stop and resume", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let rejectAi;
  const aiResponse = new Promise((resolve, reject) => { rejectAi = reject; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "PATCH") {
        const patch = JSON.parse(init.body);
        return Response.json({
          ok: true,
          profile: { collectionEnabled: patch.collectionEnabled }
        });
      }
      return aiResponse;
    }
  });
  configure(api);

  const inFlightAi = api.recordAiGeneration();
  assert.equal((await api.updateProfile({ collectionEnabled: false })).ok, true);
  assert.equal((await api.updateProfile({ collectionEnabled: true })).ok, true);
  rejectAi(new Error("offline"));
  const aiResult = await inFlightAi;
  assert.equal(aiResult.queued, false);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.collectionEnabled, true);
  assert.deepEqual(persisted.pendingAiEvents, []);
});

test("a delayed display-name PATCH cannot replace a profile created after deletion", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let releaseDisplayPatch;
  const displayPatchResponse = new Promise((resolve) => { releaseDisplayPatch = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "PATCH") return displayPatchResponse;
      if (init.method === "DELETE") return Response.json({ ok: true, deleted: true });
      if (init.method === "POST" && url.endsWith("/v1/profiles")) {
        return Response.json({
          ok: true,
          profile: { id: NEW_PROFILE_ID, displayName: "new", collectionEnabled: true },
          profileToken: NEW_PROFILE_TOKEN
        }, { status: 201 });
      }
      return Response.json({ ok: true, results: [] });
    }
  });
  configure(api);

  const delayedPatch = api.updateProfile({ displayName: "old" });
  assert.equal((await api.deleteData()).ok, true);
  assert.equal((await api.start({ displayName: "new", turnstileToken: "token" })).ok, true);
  releaseDisplayPatch(Response.json({
    ok: true,
    profile: { displayName: "old", collectionEnabled: true }
  }));
  assert.equal((await delayedPatch).skipped, true);
  const persisted = JSON.parse(storage.getItem(STORAGE_KEY));
  assert.equal(persisted.profileId, NEW_PROFILE_ID);
  assert.equal(persisted.profileToken, NEW_PROFILE_TOKEN);
  assert.equal(persisted.collectionEnabled, true);
});

test("a delayed resume PATCH cannot recreate credentials after deletion", async () => {
  const storage = createStorage({
    [STORAGE_KEY]: stored({ collectionEnabled: false, lifecycleGeneration: 4 })
  });
  let releaseResume;
  const resumeResponse = new Promise((resolve) => { releaseResume = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "PATCH") return resumeResponse;
      if (init.method === "DELETE") return Response.json({ ok: true, deleted: true });
      return Response.json({ ok: true });
    }
  });
  configure(api);

  const delayedResume = api.updateProfile({ collectionEnabled: true });
  assert.equal((await api.deleteData()).ok, true);
  releaseResume(Response.json({ ok: true, profile: { collectionEnabled: true } }));
  assert.equal((await delayedResume).skipped, true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(api.getState().registered, false);
});

test("a display-name PATCH finishing during resume never rewrites collection state", async () => {
  const storage = createStorage({
    [STORAGE_KEY]: stored({ collectionEnabled: false, lifecycleGeneration: 7 })
  });
  let releaseResume;
  let releaseDisplay;
  const resumeResponse = new Promise((resolve) => { releaseResume = resolve; });
  const displayResponse = new Promise((resolve) => { releaseDisplay = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      return Object.prototype.hasOwnProperty.call(body, "collectionEnabled")
        ? resumeResponse
        : displayResponse;
    }
  });
  configure(api);

  const resume = api.updateProfile({ collectionEnabled: true });
  const display = api.updateProfile({ displayName: "new name" });
  releaseResume(Response.json({ ok: true, profile: { collectionEnabled: true } }));
  assert.equal((await resume).ok, true);
  const writesAfterResume = storage.calls.set;
  releaseDisplay(Response.json({
    ok: true,
    profile: { displayName: "new name", collectionEnabled: true }
  }));
  assert.equal((await display).ok, true);
  assert.equal(storage.calls.set, writesAfterResume);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, true);
});

test("a successful delete removes its credentials even if resume advanced the generation", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  let releaseDelete;
  const deleteResponse = new Promise((resolve) => { releaseDelete = resolve; });
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      if (init.method === "DELETE") return deleteResponse;
      if (init.method === "PATCH") {
        return Response.json({ ok: true, profile: { collectionEnabled: true } });
      }
      return Response.json({ ok: true });
    }
  });
  configure(api);

  const deleting = api.deleteData();
  assert.equal((await api.updateProfile({ collectionEnabled: true })).ok, true);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, true);
  releaseDelete(Response.json({ ok: true, deleted: true }));
  assert.equal((await deleting).ok, true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(api.getState().registered, false);
});

test("stopping collection prevents events while export and deletion remain available", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (init.method === "PATCH") {
        return Response.json({ ok: true, profile: { collectionEnabled: false } });
      }
      if (init.method === "DELETE") return Response.json({ ok: true });
      return Response.json({ ok: true, profile: {}, usageDaily: [] });
    }
  });
  configure(api);

  assert.equal((await api.updateProfile({ collectionEnabled: false, glucose: 123 })).ok, true);
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal((await api.exportData()).ok, true);
  assert.equal((await api.deleteData()).ok, true);
  assert.equal(storage.getItem(STORAGE_KEY), null);
  assert.equal(seen.length, 3);
  assert.deepEqual(JSON.parse(seen[0].init.body), { collectionEnabled: false });
});

test("a failed stop stays locally stopped and blocks every later event", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const seen = [];
  let stopFailed = false;
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      if (!stopFailed) {
        stopFailed = true;
        return Response.json({ ok: false, error: "temporary" }, { status: 503 });
      }
      return Response.json({
        ok: true,
        profile: { displayName: "新しい名前", collectionEnabled: true }
      });
    }
  });
  configure(api);

  const result = await api.updateProfile({ collectionEnabled: false });
  assert.equal(result.ok, false);
  assert.equal(result.localStopped, true);
  assert.equal(result.localStopPersisted, true);
  assert.equal(api.getState().collectionEnabled, false);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, false);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).pendingAiEvents, []);

  // A later display-name-only PATCH must not trust the server's older active state
  // and silently undo the local privacy stop.
  assert.equal((await api.updateProfile({ displayName: "新しい名前" })).ok, true);
  assert.equal(api.getState().collectionEnabled, false);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, false);

  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal((await api.recordAiGeneration()).skipped, true);
  assert.equal((await api.syncOrdinaryMemoryCount(4)).skipped, true);
  assert.equal(seen.length, 2);
});

test("delete keeps local credentials when the server delete fails", async () => {
  const storage = createStorage({ [STORAGE_KEY]: stored() });
  const seen = [];
  const { api } = loadModule({
    storage,
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return Response.json({ ok: false, error: "temporary" }, { status: 503 });
    }
  });
  configure(api);
  const result = await api.deleteData();
  assert.equal(result.ok, false);
  assert.equal(result.localStopped, true);
  assert.notEqual(storage.getItem(STORAGE_KEY), null);
  assert.equal(storage.calls.remove, 0);
  assert.equal(api.getState().collectionEnabled, false);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).collectionEnabled, false);
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal((await api.recordAiGeneration()).skipped, true);
  assert.equal((await api.syncOrdinaryMemoryCount(4)).skipped, true);
  assert.equal(seen.length, 1);
});

test("broken or unavailable storage fails closed without making a request", async () => {
  let requests = 0;
  const failingStorage = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
    removeItem() { throw new Error("blocked"); }
  };
  const { api } = loadModule({
    storage: failingStorage,
    fetchImpl: async () => {
      requests += 1;
      return Response.json({ ok: true });
    }
  });
  configure(api);
  assert.equal((await api.recordVisit()).skipped, true);
  assert.equal((await api.syncOrdinaryMemoryCount(1)).skipped, true);
  assert.equal(requests, 0);
});

test("client source never reads health, connection, URL, referrer, or visitor-seed data", () => {
  assert.doesNotMatch(source, /visitorSeed|dataSource|Nightscout|Gluroo|apiSecret|connectionUrl/iu);
  assert.doesNotMatch(source, /\b(?:glucose|sgv|tir|tar|tbr|gmi|glucoScore|userAgent)\b/iu);
  assert.doesNotMatch(source, /(?:document|root|window)\?*\.?referrer\b/iu);
  assert.doesNotMatch(source, /location\.(?:href|search|hash)|document\.cookie/iu);
  assert.doesNotMatch(source, /sendBeacon|XMLHttpRequest|WebSocket|EventSource/iu);
});
