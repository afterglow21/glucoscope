import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/data-relay-client.js", import.meta.url), "utf8");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function createBaseManager() {
  const directCalls = [];
  return {
    directCalls,
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
      clearUserConfig() {},
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
  hostname = "afterglow21.github.io",
  search = "",
  endpoint = "https://relay.example",
  fetchImpl = globalThis.fetch,
  turnstile = null
} = {}) {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const { manager, directCalls } = createBaseManager();
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
  return { context, localStorage, sessionStorage, directCalls, elements };
}

function futureIso(minutes = 30) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function createRelayTurnstileElement() {
  return {
    hidden: true,
    classList: { add() {}, remove() {} }
  };
}

function createSuccessfulSessionFetch(requests = []) {
  return async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({
      ok: true,
      relayTicket: "s".repeat(40),
      expiresAt: futureIso(60),
      expiresInSeconds: 3600
    });
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

test("Gluroo uses the limited relay and keeps the credential out of the request URL", async () => {
  const requests = [];
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      return Response.json({
        ok: true,
        entries: [{ sgv: 124, date: 1_785_000_000_000, direction: "Flat" }]
      });
    }
  });

  context.GlucoScopeDataRelay._testing.saveRelaySession({
    ticket: "a".repeat(40),
    expiresAt: futureIso()
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "private-token"
  });
  const result = await adapter.testConnection();

  assert.equal(result.strategy, "limited-relay");
  assert.equal(result.latest.glucose, 124);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://relay.example/v1/entries");
  assert.equal(requests[0].url.includes("private-token"), false);
  assert.equal(requests[0].body.credential, "private-token");
  assert.equal(requests[0].body.sourceUrl, "https://sample.ns.gluroo.com");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(requests[0].options.cache, "no-store");
});

test("relay tickets are saved only in sessionStorage and expire early by a safety margin", () => {
  const { context, localStorage, sessionStorage } = loadModule();
  context.GlucoScopeDataRelay._testing.saveRelaySession({
    ticket: "b".repeat(40),
    expiresAt: futureIso(5)
  });

  assert.equal(localStorage.getItem(context.GlucoScopeDataRelay.SESSION_KEY), null);
  assert.ok(sessionStorage.getItem(context.GlucoScopeDataRelay.SESSION_KEY));
  assert.ok(context.GlucoScopeDataRelay.readRelaySession());

  const raw = JSON.stringify({
    version: 1,
    endpoint: "https://relay.example",
    ticket: "c".repeat(40),
    expiresAt: new Date(Date.now() + 10_000).toISOString()
  });
  sessionStorage.setItem(context.GlucoScopeDataRelay.SESSION_KEY, raw);
  assert.equal(context.GlucoScopeDataRelay.readRelaySession(), null);
});

test("session creation sends only the Turnstile token and stores the returned relay ticket", async () => {
  const requests = [];
  const { context } = loadModule({
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return Response.json({
        ok: true,
        relayTicket: "d".repeat(40),
        expiresAt: futureIso(60),
        expiresInSeconds: 3600
      });
    }
  });

  const session = await context.GlucoScopeDataRelay._testing.issueRelaySession("turnstile-test-token");
  assert.equal(requests[0].url, "https://relay.example/v1/session");
  assert.deepEqual(Object.keys(requests[0].body), ["turnstileToken"]);
  assert.equal(requests[0].body.turnstileToken, "turnstile-test-token");
  assert.equal(session.ticket, "d".repeat(40));
});

test("session creation retains only a validated six-digit server diagnostic", async () => {
  for (const [serverValue, expected] of [
    ["710102", "710102"],
    ["710102;test-credential", undefined],
  ]) {
    const { context } = loadModule({
      fetchImpl: async () => Response.json(
        {
          ok: false,
          error: "turnstile_failed",
          turnstileErrorCode: serverValue,
        },
        { status: 403 }
      )
    });

    await assert.rejects(
      context.GlucoScopeDataRelay._testing.issueRelaySession("turnstile-test-token"),
      (error) => {
        assert.equal(error.code, "turnstile_failed");
        assert.equal(error.turnstileErrorCode, expected);
        return true;
      }
    );
  }
});

async function captureTurnstileFailure(errorCode) {
  let widgetOptions = null;
  const turnstile = {
    render(_container, options) {
      widgetOptions = options;
      return "relay-widget";
    },
    reset() {}
  };
  const { context, elements } = loadModule({ turnstile });
  elements.set("dataSourceRelayTurnstile", {
    hidden: true,
    classList: { add() {}, remove() {} }
  });

  const pending = context.GlucoScopeDataRelay.prepareConnection({
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(widgetOptions);
  assert.equal(widgetOptions["error-callback"](errorCode), true);

  try {
    await pending;
    assert.fail("The Turnstile failure should reject the connection attempt.");
  } catch (error) {
    return error;
  }
}

test("Turnstile failures retain only a six-digit Cloudflare confirmation code", async () => {
  const validError = await captureTurnstileFailure("110200");
  assert.equal(validError.code, "turnstile_failed");
  assert.equal(validError.turnstileErrorCode, "110200");

  const invalidError = await captureTurnstileFailure("110200;test-credential");
  assert.equal(invalidError.code, "turnstile_failed");
  assert.equal(invalidError.turnstileErrorCode, undefined);
});

test("Turnstile confirmation-code normalization rejects unexpected values", () => {
  const normalize = loadModule().context.GlucoScopeDataRelay._testing.normalizeTurnstileErrorCode;
  assert.equal(normalize(110200), "110200");
  assert.equal(normalize(" 110600 "), "110600");
  assert.equal(normalize("11020"), "");
  assert.equal(normalize("error 110200"), "");
  assert.equal(normalize(null), "");
});

test("a Turnstile render failure is cleaned up so the next attempt can succeed", async () => {
  const requests = [];
  const rendered = [];
  let renderCount = 0;
  const turnstile = {
    render(_container, options) {
      renderCount += 1;
      if (renderCount === 1) throw new Error("render failed");
      rendered.push(options);
      return `relay-widget-${renderCount}`;
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: createSuccessfulSessionFetch(requests)
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  };

  await assert.rejects(
    context.GlucoScopeDataRelay.prepareConnection(config),
    (error) => error.code === "turnstile_failed"
  );

  const retry = context.GlucoScopeDataRelay.prepareConnection(config);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].callback("fresh-token"), true);
  const session = await retry;

  assert.equal(session.ticket, "s".repeat(40));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.turnstileToken, "fresh-token");
});

test("a Turnstile challenge timeout leaves the next attempt usable", async () => {
  const requests = [];
  const rendered = [];
  const turnstile = {
    render(_container, options) {
      rendered.push(options);
      return `relay-widget-${rendered.length}`;
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: createSuccessfulSessionFetch(requests)
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  };

  await assert.rejects(
    context.GlucoScopeDataRelay.prepareConnection(config, { challengeTimeoutMs: 5 }),
    (error) => error.code === "turnstile_failed"
  );

  const retry = context.GlucoScopeDataRelay.prepareConnection(config);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered.length, 2);
  assert.equal(rendered[1].callback("retry-token"), true);
  await retry;
  assert.equal(requests.length, 1);
});

test("a stale Turnstile callback cannot complete a newer challenge", async () => {
  const requests = [];
  const rendered = [];
  const turnstile = {
    render(_container, options) {
      rendered.push(options);
      return `relay-widget-${rendered.length}`;
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: createSuccessfulSessionFetch(requests)
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  };

  await assert.rejects(
    context.GlucoScopeDataRelay.prepareConnection(config, { challengeTimeoutMs: 5 }),
    (error) => error.code === "turnstile_failed"
  );
  const staleCallback = rendered[0].callback;

  let retrySettled = false;
  const retry = context.GlucoScopeDataRelay.prepareConnection(config);
  const observedRetry = retry.then(
    (value) => {
      retrySettled = true;
      return value;
    },
    (error) => {
      retrySettled = true;
      throw error;
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleCallback("stale-token"), false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(retrySettled, false);
  assert.equal(requests.length, 0);

  assert.equal(rendered[1].callback("fresh-token"), true);
  await observedRetry;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.turnstileToken, "fresh-token");
});

test("aborting a Turnstile challenge prevents a late callback from creating a session", async () => {
  const requests = [];
  const rendered = [];
  const turnstile = {
    render(_container, options) {
      rendered.push(options);
      return `relay-widget-${rendered.length}`;
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: createSuccessfulSessionFetch(requests)
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  };

  const controller = new AbortController();
  const first = context.GlucoScopeDataRelay.prepareConnection(config, {
    signal: controller.signal
  });
  await new Promise((resolve) => setImmediate(resolve));
  const staleCallback = rendered[0].callback;
  controller.abort();
  await assert.rejects(first, (error) => error.code === "request_aborted");
  assert.equal(staleCallback("late-token"), false);
  assert.equal(requests.length, 0);

  const retry = context.GlucoScopeDataRelay.prepareConnection(config);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered[1].callback("fresh-token"), true);
  await retry;
  assert.equal(requests.length, 1);
});

test("aborting session creation stops the relay request and stores no ticket", async () => {
  const controller = new AbortController();
  const { context, sessionStorage } = loadModule({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });

  const pending = context.GlucoScopeDataRelay.prepareConnection({
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  }, {
    signal: controller.signal,
    turnstileToken: "direct-test-token",
    timeoutMs: 1000
  });
  controller.abort();

  await assert.rejects(pending, (error) => error.code === "request_aborted");
  assert.equal(sessionStorage.getItem(context.GlucoScopeDataRelay.SESSION_KEY), null);
});

test("concurrent preparation rejects the later caller and creates only one session", async () => {
  const requests = [];
  const rendered = [];
  const turnstile = {
    render(_container, options) {
      rendered.push(options);
      return `relay-widget-${rendered.length}`;
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: createSuccessfulSessionFetch(requests)
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  };

  const first = context.GlucoScopeDataRelay.prepareConnection(config);
  const concurrent = context.GlucoScopeDataRelay.prepareConnection(config);
  await assert.rejects(concurrent, (error) => error.code === "relay_busy");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered.length, 1);
  assert.equal(rendered[0].callback("single-flight-token"), true);
  await first;

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.turnstileToken, "single-flight-token");
});

test("an older session response cannot clean up a later relay challenge", async () => {
  const rendered = [];
  const requests = [];
  let releaseFirstResponse = null;
  const turnstile = {
    render(_container, options) {
      rendered.push(options);
      return `relay-widget-${rendered.length}`;
    },
    remove() {}
  };
  const { context, elements } = loadModule({
    turnstile,
    fetchImpl: async (url, options) => {
      requests.push({ url, options, body: JSON.parse(options.body) });
      if (requests.length === 1) {
        return new Promise((resolve) => {
          releaseFirstResponse = () => resolve(Response.json({
            ok: true,
            relayTicket: "a".repeat(40),
            expiresAt: futureIso(60),
            expiresInSeconds: 3600
          }));
        });
      }
      return Response.json({
        ok: true,
        relayTicket: "b".repeat(40),
        expiresAt: futureIso(60),
        expiresInSeconds: 3600
      });
    }
  });
  elements.set("dataSourceRelayTurnstile", createRelayTurnstileElement());
  const config = {
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "test-credential"
  };

  const first = context.GlucoScopeDataRelay.prepareConnection(config);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered[0].callback("first-token"), true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(typeof releaseFirstResponse, "function");

  await assert.rejects(
    context.GlucoScopeDataRelay.prepareConnection(config),
    (error) => error.code === "relay_busy"
  );
  releaseFirstResponse();
  await first;

  context.GlucoScopeDataRelay.clearRelaySession();
  const retry = context.GlucoScopeDataRelay.prepareConnection(config);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(rendered.length, 2);
  assert.equal(rendered[1].callback("second-token"), true);
  const retrySession = await retry;

  assert.equal(retrySession.ticket, "b".repeat(40));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].body.turnstileToken, "second-token");
});

test("an invalid relay ticket clears the browser session", async () => {
  const { context, sessionStorage } = loadModule({
    fetchImpl: async () => Response.json(
      { ok: false, error: "relay_ticket_invalid" },
      { status: 403 }
    )
  });
  context.GlucoScopeDataRelay._testing.saveRelaySession({
    ticket: "e".repeat(40),
    expiresAt: futureIso()
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "private-token"
  });

  await assert.rejects(adapter.fetchLatest(), (error) => error.code === "relay_ticket_invalid");
  assert.equal(sessionStorage.getItem(context.GlucoScopeDataRelay.SESSION_KEY), null);
});

test("Gluroo treatment and device-status calls remain empty because the relay is entries-only", async () => {
  const { context } = loadModule();
  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://sample.ns.gluroo.com",
    credential: "private-token"
  });
  const treatments = await adapter.fetchTreatments();
  const deviceStatus = await adapter.fetchDeviceStatus();
  assert.equal(treatments.strategy, "limited-relay");
  assert.equal(treatments.status, 200);
  assert.equal(treatments.data.length, 0);
  assert.equal(deviceStatus.strategy, "limited-relay");
  assert.equal(deviceStatus.status, 200);
  assert.equal(deviceStatus.data.length, 0);
});

test("production fails closed when no relay endpoint is configured", async () => {
  const { context } = loadModule({ endpoint: null });
  await assert.rejects(
    context.GlucoScopeDataRelay.prepareConnection({
      provider: "gluroo",
      baseUrl: "https://sample.ns.gluroo.com",
      credential: "private-token"
    }, { turnstileToken: "test-token" }),
    (error) => error.code === "relay_unavailable"
  );
});

test("a local relayEndpoint query override is accepted only on a local hostname", () => {
  const local = loadModule({
    hostname: "127.0.0.1",
    search: "?relayEndpoint=http%3A%2F%2F127.0.0.1%3A8790",
    endpoint: null
  });
  assert.equal(local.context.GlucoScopeDataRelay.getRelayEndpoint(), "http://127.0.0.1:8790");

  const production = loadModule({
    hostname: "afterglow21.github.io",
    search: "?relayEndpoint=https%3A%2F%2Fevil.example",
    endpoint: null
  });
  assert.equal(production.context.GlucoScopeDataRelay.getRelayEndpoint(), "");
});

test("unsafe relay endpoints are rejected", () => {
  const { context } = loadModule();
  const normalize = context.GlucoScopeDataRelay._testing.normalizeRelayEndpoint;
  assert.throws(() => normalize("http://relay.example"), /Relay endpoint must use HTTPS/);
  assert.throws(() => normalize("https://user:pass@relay.example"), /not allowed/);
  assert.equal(normalize("https://relay.example/path/"), "https://relay.example/path");
});


test("clearing the saved connection also clears the relay ticket", () => {
  const { context, sessionStorage } = loadModule();
  context.GlucoScopeDataRelay._testing.saveRelaySession({
    ticket: "f".repeat(40),
    expiresAt: futureIso()
  });
  context.GlucoScopeDataSource.clearUserConfig();
  assert.equal(sessionStorage.getItem(context.GlucoScopeDataRelay.SESSION_KEY), null);
});
