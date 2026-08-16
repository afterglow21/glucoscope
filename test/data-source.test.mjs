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

function loadModule({
  search = "",
  pathname = "/index.html",
  fetchImpl = null,
  localStorage = createStorage(),
  sessionStorage = createStorage()
} = {}) {
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
    localStorage,
    sessionStorage,
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

test("launch mode keeps the public demo separate from personal user mode", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const userPage = loadModule({ search: "?mode=user", localStorage, sessionStorage });
  userPage.GlucoScopeDataSource.saveUserConfig({
    provider: "nightscout",
    baseUrl: "https://example.test",
    credential: "reader-token",
    persist: true
  });

  const publicPage = loadModule({ localStorage, sessionStorage });
  assert.equal(publicPage.GlucoScopeDataSource.getLaunchMode(), "public-demo");
  assert.equal(publicPage.GlucoScopeDataSource.getActiveConfig().mode, "public-demo");
  assert.equal(loadModule({ search: "?mode=user" }).GlucoScopeDataSource.getLaunchMode(), "user");
  assert.equal(loadModule({ pathname: "/user.html" }).GlucoScopeDataSource.getLaunchMode(), "user");
});

test("a persistent connection survives a fresh page module load", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const firstPage = loadModule({ search: "?mode=user", localStorage, sessionStorage });

  firstPage.GlucoScopeDataSource.saveUserConfig({
    provider: "gluroo",
    baseUrl: "https://persistent-reload.example.test",
    credential: "persistent-reload-secret",
    persist: true
  }, { persist: true });

  const reloadedPage = loadModule({ search: "?mode=user", localStorage, sessionStorage });
  const restored = reloadedPage.GlucoScopeDataSource.getActiveConfig();
  assert.equal(restored?.provider, "gluroo");
  assert.equal(restored?.baseUrl, "https://persistent-reload.example.test");
  assert.equal(restored?.credential, "persistent-reload-secret");
  assert.equal(restored?.persist, true);
});

test("a session connection survives a fresh page module load in the same tab", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const firstPage = loadModule({ search: "?mode=user", localStorage, sessionStorage });

  firstPage.GlucoScopeDataSource.saveUserConfig({
    provider: "nightscout",
    baseUrl: "https://session-reload.example.test",
    credential: "session-reload-secret",
    persist: false
  }, { persist: false });

  const reloadedPage = loadModule({ search: "?mode=user", localStorage, sessionStorage });
  const restored = reloadedPage.GlucoScopeDataSource.getActiveConfig();
  assert.equal(restored?.provider, "nightscout");
  assert.equal(restored?.baseUrl, "https://session-reload.example.test");
  assert.equal(restored?.credential, "session-reload-secret");
  assert.equal(restored?.persist, false);
});

test("keeps the previous session connection when a new persistent write fails", () => {
  const localStorage = createStorage();
  const originalSetItem = localStorage.setItem.bind(localStorage);
  let rejectPersistentWrite = false;
  localStorage.setItem = (key, value) => {
    if (rejectPersistentWrite) throw new Error("storage write rejected");
    originalSetItem(key, value);
  };
  const context = loadModule({ search: "?mode=user", localStorage });
  const api = context.GlucoScopeDataSource;

  api.saveUserConfig({
    provider: "nightscout",
    baseUrl: "https://previous.example.test",
    credential: "previous-secret",
    persist: false
  }, { persist: false });

  rejectPersistentWrite = true;
  assert.throws(() => api.saveUserConfig({
    provider: "gluroo",
    baseUrl: "https://new.example.test",
    credential: "new-secret",
    persist: true
  }, { persist: true }), /storage write rejected/);

  assert.ok(context.sessionStorage.getItem(api.SESSION_STORAGE_KEY));
  assert.equal(api.getActiveConfig().baseUrl, "https://previous.example.test");
  assert.equal(context.localStorage.getItem(api.STORAGE_KEY), null);
});

test("removes the previous storage copy only after the selected write succeeds", () => {
  const context = loadModule({ search: "?mode=user" });
  const api = context.GlucoScopeDataSource;

  api.saveUserConfig({
    provider: "nightscout",
    baseUrl: "https://persistent.example.test",
    credential: "persistent-secret",
    persist: true
  }, { persist: true });
  assert.ok(context.localStorage.getItem(api.STORAGE_KEY));

  api.saveUserConfig({
    provider: "gluroo",
    baseUrl: "https://session.example.test",
    credential: "session-secret",
    persist: false
  }, { persist: false });

  assert.equal(context.localStorage.getItem(api.STORAGE_KEY), null);
  assert.ok(context.sessionStorage.getItem(api.SESSION_STORAGE_KEY));
  assert.equal(api.getActiveConfig().baseUrl, "https://session.example.test");
});

test("keeps a successful persistent save when old session cleanup is rejected", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const context = loadModule({ search: "?mode=user", localStorage, sessionStorage });
  const api = context.GlucoScopeDataSource;
  sessionStorage.setItem(api.SESSION_STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    mode: "user",
    provider: "nightscout",
    baseUrl: "https://old-session.example.test",
    credential: "old-session-secret",
    persist: false,
    savedAt: "2000-01-01T00:00:00.000Z"
  }));
  sessionStorage.removeItem = () => {
    throw new Error("session cleanup rejected");
  };

  assert.doesNotThrow(() => api.saveUserConfig({
    provider: "gluroo",
    baseUrl: "https://new-persistent.example.test",
    credential: "new-persistent-secret",
    persist: true
  }, { persist: true }));

  assert.ok(localStorage.getItem(api.STORAGE_KEY));
  assert.ok(sessionStorage.getItem(api.SESSION_STORAGE_KEY));
  assert.equal(api.getActiveConfig().baseUrl, "https://new-persistent.example.test");
});

test("keeps a successful session save when old persistent cleanup is rejected", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const context = loadModule({ search: "?mode=user", localStorage, sessionStorage });
  const api = context.GlucoScopeDataSource;
  localStorage.setItem(api.STORAGE_KEY, JSON.stringify({
    schemaVersion: 1,
    mode: "user",
    provider: "nightscout",
    baseUrl: "https://old-persistent.example.test",
    credential: "old-persistent-secret",
    persist: true,
    savedAt: "2000-01-01T00:00:00.000Z"
  }));
  localStorage.removeItem = () => {
    throw new Error("persistent cleanup rejected");
  };

  assert.doesNotThrow(() => api.saveUserConfig({
    provider: "gluroo",
    baseUrl: "https://new-session.example.test",
    credential: "new-session-secret",
    persist: false
  }, { persist: false }));

  assert.ok(sessionStorage.getItem(api.SESSION_STORAGE_KEY));
  assert.ok(localStorage.getItem(api.STORAGE_KEY));
  assert.equal(api.getActiveConfig().baseUrl, "https://new-session.example.test");
});

test("connection deletion tries both browser storage areas before reporting a failure", () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const context = loadModule({ search: "?mode=user", localStorage, sessionStorage });
  const api = context.GlucoScopeDataSource;
  localStorage.setItem(api.STORAGE_KEY, "persistent-copy");
  sessionStorage.setItem(api.SESSION_STORAGE_KEY, "session-copy");
  localStorage.removeItem = () => {
    throw new Error("persistent deletion rejected");
  };

  assert.throws(() => api.clearUserConfig(), /persistent deletion rejected/);
  assert.equal(localStorage.getItem(api.STORAGE_KEY), "persistent-copy");
  assert.equal(sessionStorage.getItem(api.SESSION_STORAGE_KEY), null);
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

test("the connection-test adapter forwards external cancellation", async () => {
  const controller = new AbortController();
  const context = loadModule({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  const adapter = context.GlucoScopeDataSource.createAdapter({
    provider: "nightscout",
    baseUrl: "https://example.test",
    persist: false
  });

  const pending = adapter.testConnection({
    signal: controller.signal,
    timeoutMs: 1000
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === "request_aborted");
});
