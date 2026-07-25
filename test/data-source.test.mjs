import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import fs from "node:fs";
import { webcrypto } from "node:crypto";

const source = fs.readFileSync(new URL("../js/data-source.js", import.meta.url), "utf8");

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

function loadModule({ search = "", pathname = "/index.html", fetchImpl = null } = {}) {
  const context = {
    URL,
    URLSearchParams,
    Headers,
    TextEncoder,
    Uint8Array,
    AbortController,
    crypto: webcrypto,
    fetch: fetchImpl || globalThis.fetch,
    location: { search, pathname },
    localStorage: createStorage(),
    sessionStorage: createStorage(),
    setTimeout,
    clearTimeout,
    console
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "data-source.js" });
  return context;
}

test("normalizes a Nightscout API URL and extracts a token", () => {
  const { GlucoScopeDataSource } = loadModule();
  const normalized = GlucoScopeDataSource.normalizeConnectionInput(
    "https://example.test/prefix/api/v1?token=reader-123"
  );

  assert.equal(normalized.baseUrl, "https://example.test/prefix");
  assert.equal(normalized.credential, "reader-123");
  assert.equal(normalized.credentialType, "token");
});

test("rejects non-local HTTP data sources", () => {
  const { GlucoScopeDataSource } = loadModule();
  assert.throws(
    () => GlucoScopeDataSource.normalizeConnectionInput("http://example.test"),
    (error) => error.code === "https_required"
  );
});

test("allows localhost HTTP for development", () => {
  const { GlucoScopeDataSource } = loadModule();
  const normalized = GlucoScopeDataSource.normalizeConnectionInput("http://127.0.0.1:1337/api/v1");
  assert.equal(normalized.baseUrl, "http://127.0.0.1:1337");
});

test("persists user configuration only in the selected browser storage", () => {
  const context = loadModule({ search: "?mode=user" });
  const api = context.GlucoScopeDataSource;

  api.saveUserConfig({
    provider: "gluroo",
    baseUrl: "https://example.test",
    credential: "secret-value",
    persist: false
  }, { persist: false });

  assert.equal(context.localStorage.getItem(api.STORAGE_KEY), null);
  assert.ok(context.sessionStorage.getItem(api.SESSION_STORAGE_KEY));
  assert.equal(api.getActiveConfig().provider, "gluroo");
});

test("uses a SHA-1 api-secret header for a regular Nightscout source", async () => {
  const requests = [];
  const context = loadModule({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify([{ sgv: 100, date: 1_700_000_000_000 }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "nightscout",
    baseUrl: "https://example.test",
    credential: "abcdefghijkl",
    credentialType: "api-secret",
    authStrategy: "sha1-header",
    persist: false
  });

  const result = await adapter.testConnection();
  assert.equal(result.ok, true);
  assert.equal(result.strategy, "sha1-header");
  assert.match(requests[0].options.headers.get("api-secret"), /^[a-f0-9]{40}$/);
});

test("can authenticate with a token query for a Nightscout-compatible source", async () => {
  const requests = [];
  const context = loadModule({
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify([{ sgv: 108, date: 1_700_000_000_000 }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://example.test/nightscout",
    credential: "reader-token",
    credentialType: "token",
    authStrategy: "token-query",
    persist: false
  });

  await adapter.testConnection();
  const requestUrl = new URL(requests[0]);
  assert.equal(requestUrl.pathname, "/nightscout/api/v1/entries.json");
  assert.equal(requestUrl.searchParams.get("token"), "reader-token");
});

test("normalizes compatible glucose and second-based timestamp fields", () => {
  const { GlucoScopeDataSource } = loadModule();
  const entry = GlucoScopeDataSource._testing.normalizeGlucoseEntry({
    glucose: "121",
    timestamp: 1_700_000_000,
    trendArrow: "Flat"
  });

  assert.equal(entry.sgv, 121);
  assert.equal(entry.date, 1_700_000_000_000);
  assert.equal(entry.direction, "Flat");
});

test("falls back from a raw Gluroo header to a token query after authorization failure", async () => {
  const requests = [];
  const context = loadModule({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const parsed = new URL(url);
      if (!parsed.searchParams.get("token")) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "content-type": "application/json" }
        });
      }
      return new Response(JSON.stringify([{ sgv: 99, date: 1_700_000_000_000 }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://example.test",
    credential: "ready-to-use-secret",
    persist: false
  });

  const result = await adapter.testConnection();
  assert.equal(result.strategy, "token-query");
  assert.ok(requests.length >= 2);
  assert.equal(new URL(requests.at(-1).url).searchParams.get("token"), "ready-to-use-secret");
});

test("falls back to entries.json when entries/sgv.json is unavailable", async () => {
  const requests = [];
  const context = loadModule({
    fetchImpl: async (url) => {
      requests.push(url);
      if (new URL(url).pathname.endsWith("/entries/sgv.json")) {
        return new Response("not found", { status: 404 });
      }
      return new Response(JSON.stringify([{ sgv: 104, date: 1_700_000_000_000 }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://example.test",
    persist: false
  });

  const result = await adapter.fetchEntries(1_699_999_000_000, 1_700_001_000_000, 10);
  assert.equal(result.data[0].sgv, 104);
  assert.ok(requests.some((url) => new URL(url).pathname.endsWith("/entries.json")));
});

test("credential-bearing requests do not follow redirects", async () => {
  let seenRedirect = null;
  const context = loadModule({
    fetchImpl: async (_url, options) => {
      seenRedirect = options.redirect;
      return new Response(JSON.stringify([{ sgv: 111, date: Date.now() }]), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const manager = context.GlucoScopeDataSource;
  const config = manager.sanitizeConfig({
    provider: "nightscout",
    baseUrl: "https://example.com",
    credential: "test-secret-value",
    credentialType: "api-secret"
  });

  await manager.requestJson(config, "/api/v1/entries.json", { count: 1 });
  assert.equal(seenRedirect, "error");
});

test("reports an incompatible glucose format separately from an empty source", async () => {
  const context = loadModule({
    fetchImpl: async () => new Response(JSON.stringify([{ unexpected: true }]), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });

  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "gluroo",
    baseUrl: "https://example.test",
    persist: false
  });

  await assert.rejects(
    adapter.testConnection(),
    (error) => error.code === "incompatible_entry_format"
  );
});

test("request timeout still applies when an external signal is supplied", async () => {
  const externalController = new AbortController();
  const context = loadModule({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  const manager = context.GlucoScopeDataSource;
  const config = manager.sanitizeConfig({
    provider: "nightscout",
    baseUrl: "https://example.test",
    persist: false
  });

  await assert.rejects(
    manager.requestJson(config, "/api/v1/entries.json", {}, {
      signal: externalController.signal,
      timeoutMs: 10,
      authStrategy: "none"
    }),
    (error) => error.code === "request_timeout"
  );
});

test("external request cancellation is kept separate from a timeout", async () => {
  const externalController = new AbortController();
  const context = loadModule({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  const manager = context.GlucoScopeDataSource;
  const config = manager.sanitizeConfig({
    provider: "nightscout",
    baseUrl: "https://example.test",
    persist: false
  });

  setTimeout(() => externalController.abort(), 5);
  await assert.rejects(
    manager.requestJson(config, "/api/v1/entries.json", {}, {
      signal: externalController.signal,
      timeoutMs: 1000,
      authStrategy: "none"
    }),
    (error) => error.code === "request_aborted"
  );
});
