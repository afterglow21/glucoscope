import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/data-relay-client.js", import.meta.url), "utf8");

function createStorage(initial = []) {
  const values = new Map(initial);
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    snapshot() {
      return new Map(values);
    }
  };
}

function createBaseManager() {
  const directCalls = [];
  const clearCalls = [];
  return {
    directCalls,
    clearCalls,
    manager: Object.freeze({
      sanitizeConfig(input = {}) {
        return {
          schemaVersion: 1,
          mode: input.mode || "user",
          provider: input.provider === "gluroo" ? "gluroo" : "nightscout",
          baseUrl: String(input.baseUrl || "").replace(/\/+$/u, ""),
          credential: String(input.credential || ""),
          persist: input.persist !== false,
          authStrategy: input.authStrategy || "auto"
        };
      },
      createAdapter(config) {
        directCalls.push(config);
        return { kind: "direct", config };
      },
      clearUserConfig() {
        clearCalls.push(true);
      },
      _testing: Object.freeze({
        normalizeGlucoseEntries(entries) {
          return Array.isArray(entries) ? entries.map((entry) => ({
            ...entry,
            sgv: Number(entry.sgv),
            date: Number(entry.date)
          })) : [];
        }
      })
    })
  };
}

function loadModule({
  hostname = "glucoscope.app",
  search = "",
  endpoint = "https://relay.glucoscope.app",
  fetchImpl = globalThis.fetch,
  turnstile = null,
  localStorage = createStorage(),
  sessionStorage = createStorage()
} = {}) {
  const { manager, directCalls, clearCalls } = createBaseManager();
  const meta = endpoint === null ? null : { content: endpoint };
  const elements = new Map();
  const document = {
    head: { appendChild() {} },
    querySelector(selector) {
      if (selector === 'meta[name="glucoscope-data-relay-endpoint"]') return meta;
      return null;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
    createElement() {
      return { dataset: {}, classList: { add() {}, remove() {} } };
    }
  };
  const context = {
    URL,
    URLSearchParams,
    AbortController,
    TextEncoder,
    TextDecoder,
    Response,
    Request,
    Headers,
    fetch: fetchImpl,
    setTimeout,
    clearTimeout,
    location: { hostname, search },
    localStorage,
    sessionStorage,
    document,
    GlucoScopeDataSource: manager,
    crypto: globalThis.crypto
  };
  if (turnstile) context.turnstile = turnstile;
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "data-relay-client.js" });
  return {
    context,
    localStorage,
    sessionStorage,
    directCalls,
    clearCalls,
    elements
  };
}

function glurooConfig(overrides = {}) {
  return {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "private-token",
    ...overrides
  };
}

function parseBody(options) {
  return typeof options?.body === "string" ? JSON.parse(options.body) : undefined;
}

function activeSessionResponse(status = 200) {
  return Response.json({
    ok: true,
    session: { status: "active" },
    entries: [{ sgv: 124, date: 1_785_000_000_000, direction: "Flat" }]
  }, { status });
}

function entriesResponse(entries = [{ sgv: 124, date: 1_785_000_000_000, direction: "Flat" }]) {
  return Response.json({ ok: true, entries });
}

function createRelayTurnstileElement() {
  return {
    hidden: true,
    classList: { add() {}, remove() {} }
  };
}

test("Nightscout keeps the existing direct adapter", () => {
  const { context, directCalls } = loadModule();
  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "nightscout",
    baseUrl: "https://nightscout.example",
    credential: "reader"
  });
  assert.equal(adapter.kind, "direct");
  assert.equal(directCalls.length, 1);
});

test("an explicit Gluroo connection creates an HttpOnly device session and sends no bearer ticket", async () => {
  const requests = [];
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: parseBody(options) });
      if (url.endsWith("/v1/device-session")) return activeSessionResponse(201);
      if (url.endsWith("/v1/entries")) return entriesResponse();
      throw new Error(`Unexpected request: ${url}`);
    }
  });

  const config = glurooConfig();
  const session = await context.GlucoScopeDataRelay.prepareConnection(config, {
    turnstileToken: "turnstile-test-token"
  });
  const result = await context.GlucoScopeDataSource.createAdapter(config).testConnection();

  assert.equal(session.authentication, "http-only-cookie");
  assert.equal(session.status, "active");
  assert.equal(result.latest.glucose, 124);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://relay.glucoscope.app/v1/device-session");
  assert.deepEqual(requests[0].body, {
    turnstileToken: "turnstile-test-token",
    sourceUrl: "https://sample.ns.gluroo.com",
    credential: "private-token"
  });
  assert.equal("relayTicket" in requests[0].body, false);
});

test("every relay fetch includes cookies but JavaScript sets no Cookie or Authorization header", async () => {
  const requests = [];
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/v1/device-session")) return activeSessionResponse(201);
      if (url.endsWith("/v1/entries")) return entriesResponse();
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const config = glurooConfig();
  await context.GlucoScopeDataRelay.prepareConnection(config, { turnstileToken: "test-token" });
  await context.GlucoScopeDataSource.createAdapter(config).fetchLatest();

  for (const { options } of requests) {
    assert.equal(options.credentials, "include");
    assert.equal(options.cache, "no-store");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers?.Cookie, undefined);
    assert.equal(options.headers?.cookie, undefined);
    assert.equal(options.headers?.Authorization, undefined);
    assert.equal(options.headers?.authorization, undefined);
  }
});

test("legacy tickets are removed without ever being read or migrated", () => {
  const legacyKey = "glucoscope.dataRelay.session.v1";
  const secretLikeValue = JSON.stringify({ ticket: "retired-bearer-secret" });
  const localStorage = createStorage([[legacyKey, secretLikeValue]]);
  const sessionStorage = createStorage([[legacyKey, secretLikeValue]]);
  const { context } = loadModule({ localStorage, sessionStorage });

  assert.equal(context.GlucoScopeDataRelay.LEGACY_SESSION_KEY, legacyKey);
  assert.equal(localStorage.getItem(legacyKey), null);
  assert.equal(sessionStorage.getItem(legacyKey), null);
  assert.equal(context.GlucoScopeDataRelay.readRelaySession().authentication, "http-only-cookie");
  assert.deepEqual([...localStorage.snapshot().values()], []);
  assert.deepEqual([...sessionStorage.snapshot().values()], []);
  assert.doesNotMatch(source, /getItem\(LEGACY_SESSION_KEY\)/u);
});

test("a fresh PWA JavaScript context probes the server cookie and continues without setup or Turnstile", async () => {
  const calls = [];
  const cookieJar = { active: true };
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/v1/device-session/status")) {
      return cookieJar.active
        ? activeSessionResponse()
        : Response.json({ ok: false, error: "device_session_invalid" }, { status: 401 });
    }
    if (url.endsWith("/v1/entries")) return entriesResponse();
    throw new Error(`Unexpected request: ${url}`);
  };

  const firstLaunch = loadModule({ fetchImpl });
  assert.equal(firstLaunch.context.GlucoScopeDataRelay.readRelaySession().status, "unknown");
  await firstLaunch.context.GlucoScopeDataSource.createAdapter(glurooConfig()).fetchLatest();

  // Home-screen relaunch: both JavaScript state and sessionStorage are new.
  const relaunched = loadModule({ fetchImpl, localStorage: createStorage(), sessionStorage: createStorage() });
  assert.equal(relaunched.context.GlucoScopeDataRelay.readRelaySession().status, "unknown");
  const result = await relaunched.context.GlucoScopeDataSource.createAdapter(glurooConfig()).fetchLatest();

  assert.equal(result.data[0].sgv, 124);
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/device-session/status")).length, 2);
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/device-session")).length, 0);
  assert.ok(calls.every(({ options }) => options.credentials === "include"));
});

test("the client has no one-hour expiry and accepts an active server session after a long relaunch", async () => {
  const calls = [];
  const { context } = loadModule({
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/v1/device-session/status")) return activeSessionResponse();
      if (url.endsWith("/v1/entries")) return entriesResponse();
      throw new Error(`Unexpected request: ${url}`);
    }
  });

  assert.equal(context.GlucoScopeDataRelay.readRelaySession().status, "unknown");
  await context.GlucoScopeDataSource.createAdapter(glurooConfig()).fetchLatest();
  assert.equal(calls.length, 2);
  assert.equal(source.includes("expiresAt"), false);
  assert.equal(source.includes("TICKET_EXPIRY"), false);
});

test("four parallel startup reads share exactly one device-session status probe", async () => {
  const calls = [];
  let releaseStatus;
  const statusGate = new Promise((resolve) => {
    releaseStatus = resolve;
  });
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith("/v1/device-session/status")) {
        await statusGate;
        return activeSessionResponse();
      }
      if (url.endsWith("/v1/entries")) return entriesResponse();
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const adapter = context.GlucoScopeDataSource.createAdapter(glurooConfig());
  const reads = [1, 2, 3, 4].map(() => adapter.fetchLatest());
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/device-session/status")).length, 1);
  releaseStatus();
  await Promise.all(reads);

  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/device-session/status")).length, 1);
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/entries")).length, 4);
});

test("concurrent explicit preparation shares one Turnstile challenge and one session creation", async () => {
  const rendered = [];
  const requests = [];
  const turnstile = {
    render(_container, options) {
      rendered.push(options);
      return "relay-widget";
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: parseBody(options) });
      return activeSessionResponse(201);
    }
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = glurooConfig();

  const first = context.GlucoScopeDataRelay.prepareConnection(config);
  const second = context.GlucoScopeDataRelay.prepareConnection(config);
  const third = context.GlucoScopeDataRelay.prepareConnection(config);
  const fourth = context.GlucoScopeDataRelay.prepareConnection(config);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].callback("single-use-token"), true);
  const results = await Promise.all([first, second, third, fourth]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url.endsWith("/v1/device-session"), true);
  assert.deepEqual(requests[0].body, {
    turnstileToken: "single-use-token",
    sourceUrl: "https://sample.ns.gluroo.com",
    credential: "private-token"
  });
  assert.ok(results.every((result) => result.status === "active"));
});

test("an invalid cookie never starts Turnstile or automatically creates a session", async () => {
  let renderCount = 0;
  const calls = [];
  const turnstile = {
    render() {
      renderCount += 1;
      return "unexpected-widget";
    }
  };
  const { context } = loadModule({
    turnstile,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json({ ok: false, error: "device_session_invalid" }, { status: 401 });
    }
  });
  const adapter = context.GlucoScopeDataSource.createAdapter(glurooConfig());

  await assert.rejects(adapter.fetchLatest(), (error) => {
    assert.equal(error.code, "device_session_invalid");
    assert.equal(error.status, 401);
    return true;
  });
  await assert.rejects(adapter.fetchLatest(), (error) => error.code === "device_session_invalid");

  assert.equal(renderCount, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith("/v1/device-session/status"), true);
  assert.equal(context.GlucoScopeDataRelay.readRelaySession(), null);
});

test("offline startup preserves the non-secret launch hint and does not create a session", async () => {
  const calls = [];
  const localStorage = createStorage([["saved-config-marker", "kept"]]);
  const { context } = loadModule({
    localStorage,
    fetchImpl: async (url) => {
      calls.push(url);
      throw new TypeError("offline");
    }
  });

  await assert.rejects(
    context.GlucoScopeDataSource.createAdapter(glurooConfig()).fetchLatest(),
    (error) => error.code === "relay_unavailable"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endsWith("/v1/device-session/status"), true);
  assert.equal(localStorage.getItem("saved-config-marker"), "kept");
  assert.equal(context.GlucoScopeDataRelay.readRelaySession().status, "unknown");
});

test("a source mismatch requires one explicit preparation before the new connection can bind", async () => {
  const calls = [];
  let rotated = false;
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: parseBody(options) });
      if (url.endsWith("/v1/device-session/status")) return activeSessionResponse();
      if (url.endsWith("/v1/device-session")) {
        rotated = true;
        return activeSessionResponse(201);
      }
      if (url.endsWith("/v1/entries") && !rotated) {
        return Response.json(
          { ok: false, error: "device_session_source_mismatch" },
          { status: 401 }
        );
      }
      if (url.endsWith("/v1/entries")) return entriesResponse();
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const config = glurooConfig({
    baseUrl: "https://changed.ns.gluroo.com",
    credential: "new-private-token"
  });
  const adapter = context.GlucoScopeDataSource.createAdapter(config);

  await assert.rejects(
    adapter.fetchLatest(),
    (error) => error.code === "device_session_source_mismatch" && error.status === 401
  );
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/device-session")).length, 0);
  assert.equal(context.GlucoScopeDataRelay.readRelaySession(), null);

  await context.GlucoScopeDataRelay.prepareConnection(config, { turnstileToken: "explicit-token" });
  const result = await adapter.fetchLatest();
  assert.equal(result.data[0].sgv, 124);
  assert.equal(calls.filter(({ url }) => url.endsWith("/v1/device-session")).length, 1);
});

test("revocation aborts an older entries response and sends an idempotent credentialed DELETE", async () => {
  const calls = [];
  let releaseEntries;
  const entriesGate = new Promise((resolve) => {
    releaseEntries = resolve;
  });
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: parseBody(options) });
      if (url.endsWith("/v1/device-session") && options.method === "POST") {
        return activeSessionResponse(201);
      }
      if (url.endsWith("/v1/device-session") && options.method === "DELETE") {
        return Response.json({ ok: true });
      }
      if (url.endsWith("/v1/entries")) {
        // Deliberately ignore AbortSignal to prove the generation guard also works.
        await entriesGate;
        return entriesResponse();
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const config = glurooConfig();
  await context.GlucoScopeDataRelay.prepareConnection(config, { turnstileToken: "test-token" });
  const pendingEntries = context.GlucoScopeDataSource.createAdapter(config).fetchLatest();
  await new Promise((resolve) => setImmediate(resolve));

  const revoked = await context.GlucoScopeDataRelay.revokeDeviceSession();
  releaseEntries();
  await assert.rejects(pendingEntries, (error) => error.code === "request_aborted");

  const deleteRequest = calls.find(({ options }) => options.method === "DELETE");
  assert.equal(revoked.status, "revoked");
  assert.equal(deleteRequest.url, "https://relay.glucoscope.app/v1/device-session");
  assert.equal(deleteRequest.options.credentials, "include");
  assert.equal(deleteRequest.options.body, undefined);
  assert.equal(deleteRequest.options.headers, undefined);
  assert.equal(context.GlucoScopeDataRelay.readRelaySession(), null);
});

test("the relay revoke helper never mutates the separate local connection configuration", async () => {
  const localStorage = createStorage([["saved-config-marker", "kept-for-retry"]]);
  const { context, clearCalls } = loadModule({
    localStorage,
    fetchImpl: async () => {
      throw new TypeError("offline");
    }
  });

  await assert.rejects(
    context.GlucoScopeDataRelay.revokeDeviceSession(),
    (error) => error.code === "relay_unavailable"
  );
  assert.equal(clearCalls.length, 0);
  assert.equal(localStorage.getItem("saved-config-marker"), "kept-for-retry");
  assert.equal(context.GlucoScopeDataRelay.readRelaySession().status, "unknown");
});

test("local connection cleanup stays synchronous after server revocation succeeds", async () => {
  const { context, clearCalls } = loadModule({
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, "DELETE");
      return Response.json({ ok: true });
    }
  });

  await context.GlucoScopeDataRelay.revokeDeviceSession();
  const returned = context.GlucoScopeDataSource.clearUserConfig();
  assert.equal(returned, undefined);
  assert.equal(clearCalls.length, 1);
  assert.equal(context.GlucoScopeDataRelay.readRelaySession(), null);
});

test("changing connections aborts a delayed response from the previous connection", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const calls = [];
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      const body = parseBody(options);
      calls.push({ url, options, body });
      if (url.endsWith("/v1/device-session")) return activeSessionResponse(201);
      if (url.endsWith("/v1/entries") && body.sourceUrl.includes("first")) {
        await firstGate;
        return entriesResponse([{ sgv: 111, date: 1, direction: "Flat" }]);
      }
      if (url.endsWith("/v1/entries")) return entriesResponse([{ sgv: 222, date: 2, direction: "Flat" }]);
      throw new Error(`Unexpected request: ${url}`);
    }
  });
  const firstConfig = glurooConfig({ baseUrl: "https://first.ns.gluroo.com" });
  const secondConfig = glurooConfig({ baseUrl: "https://second.ns.gluroo.com" });
  await context.GlucoScopeDataRelay.prepareConnection(firstConfig, { turnstileToken: "first-token" });
  const staleRead = context.GlucoScopeDataSource.createAdapter(firstConfig).fetchLatest();
  await new Promise((resolve) => setImmediate(resolve));

  await context.GlucoScopeDataRelay.prepareConnection(secondConfig, { turnstileToken: "second-token" });
  releaseFirst();
  await assert.rejects(staleRead, (error) => error.code === "request_aborted");
  const current = await context.GlucoScopeDataSource.createAdapter(secondConfig).fetchLatest();
  assert.equal(current.data[0].sgv, 222);
});

test("aborting session creation stores no browser token and leaves the session unconfirmed", async () => {
  const controller = new AbortController();
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  let releaseResponse;
  const responseGate = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  const { context } = loadModule({
    localStorage,
    sessionStorage,
    fetchImpl: async () => {
      // Deliberately ignore AbortSignal: the client-side obsolete-request
      // guard must still refuse this late successful response.
      await responseGate;
      return activeSessionResponse(201);
    }
  });
  const pending = context.GlucoScopeDataRelay.prepareConnection(glurooConfig(), {
    signal: controller.signal,
    turnstileToken: "single-use-token",
    timeoutMs: 1000
  });
  controller.abort();

  await assert.rejects(pending, (error) => error.code === "request_aborted");
  releaseResponse();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.GlucoScopeDataRelay._testing.getDeviceSessionState(), "unknown");
  assert.deepEqual([...localStorage.snapshot().values()], []);
  assert.deepEqual([...sessionStorage.snapshot().values()], []);
});

test("Turnstile failures retain only a validated six-digit diagnostic", async () => {
  for (const [serverValue, expected] of [
    ["710102", "710102"],
    ["710102;test-credential", undefined]
  ]) {
    const { context } = loadModule({
      fetchImpl: async () => Response.json(
        {
          ok: false,
          error: "turnstile_failed",
          turnstileErrorCode: serverValue
        },
        { status: 403 }
      )
    });

    await assert.rejects(
      context.GlucoScopeDataRelay.prepareConnection(glurooConfig(), {
        turnstileToken: "turnstile-test-token"
      }),
      (error) => {
        assert.equal(error.code, "turnstile_failed");
        assert.equal(error.turnstileErrorCode, expected);
        return true;
      }
    );
  }
});

test("Turnstile confirmation-code normalization rejects unexpected values", () => {
  const normalize = loadModule().context.GlucoScopeDataRelay._testing.normalizeTurnstileErrorCode;
  assert.equal(normalize(110200), "110200");
  assert.equal(normalize(" 110600 "), "110600");
  assert.equal(normalize("11020"), "");
  assert.equal(normalize("error 110200"), "");
  assert.equal(normalize(null), "");
});

test("production fails closed when no relay endpoint is configured", async () => {
  const { context } = loadModule({ endpoint: null });
  assert.equal(context.GlucoScopeDataRelay.readRelaySession(), null);
  await assert.rejects(
    context.GlucoScopeDataRelay.prepareConnection(glurooConfig(), { turnstileToken: "test-token" }),
    (error) => error.code === "relay_unavailable"
  );
});

test("a local relayEndpoint override is accepted only on a local hostname", () => {
  const local = loadModule({
    hostname: "127.0.0.1",
    search: "?relayEndpoint=http%3A%2F%2F127.0.0.1%3A8790",
    endpoint: null
  });
  assert.equal(local.context.GlucoScopeDataRelay.getRelayEndpoint(), "http://127.0.0.1:8790");

  const production = loadModule({
    hostname: "glucoscope.app",
    search: "?relayEndpoint=https%3A%2F%2Fevil.example",
    endpoint: null
  });
  assert.equal(production.context.GlucoScopeDataRelay.getRelayEndpoint(), "");
});

test("unsafe relay endpoints are rejected", () => {
  const normalize = loadModule().context.GlucoScopeDataRelay._testing.normalizeRelayEndpoint;
  assert.throws(() => normalize("http://relay.example"), /Relay endpoint must use HTTPS/);
  assert.throws(() => normalize("https://user:pass@relay.example"), /not allowed/);
  assert.equal(normalize("https://relay.example/path/"), "https://relay.example/path");
});

test("Gluroo treatment and device-status calls remain empty because the relay is entries-only", async () => {
  const { context } = loadModule();
  const adapter = context.GlucoScopeDataSource.createAdapter(glurooConfig());
  const treatments = await adapter.fetchTreatments();
  const deviceStatus = await adapter.fetchDeviceStatus();
  assert.deepEqual(Array.from(treatments.data), []);
  assert.equal(treatments.strategy, "limited-relay");
  assert.deepEqual(Array.from(deviceStatus.data), []);
  assert.equal(deviceStatus.strategy, "limited-relay");
});
