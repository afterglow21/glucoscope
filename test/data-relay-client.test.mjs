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
  fetchImpl = globalThis.fetch
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
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "data-relay-client.js" });
  return { context, localStorage, sessionStorage, directCalls, elements };
}

function futureIso(minutes = 30) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
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
