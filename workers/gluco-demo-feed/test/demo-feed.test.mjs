import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildUpstreamUrl,
  fetchGlurooEntries,
  handleDemoFeedRequest,
  normalizeEntries,
  readConfig,
  refreshDemoFeed,
  validateSnapshot,
  validateSourceUrl,
} from "../src/demo-feed-core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ORIGIN = "https://afterglow21.github.io";
const SOURCE_URL = "https://demo.ns.gluroo.com";
const SECRET = "test-only-demo-secret";
const NOW_MS = Date.parse("2026-08-06T06:00:00.000Z");

function createMemoryKv(initialValue = null) {
  const values = new Map();
  const writes = [];
  if (initialValue) values.set("public:libre-2:v1", JSON.stringify(initialValue));
  return {
    values,
    writes,
    async get(key, options = {}) {
      const stored = values.get(key);
      if (stored === undefined) return null;
      return options.type === "json" ? JSON.parse(stored) : stored;
    },
    async put(key, value, options) {
      values.set(key, value);
      writes.push({ key, value, options });
    },
  };
}

function env(overrides = {}) {
  return {
    DEMO_FEED_ENABLED: "true",
    CORS_ALLOWED_ORIGIN: ORIGIN,
    DEMO_FEED_CACHE_KEY: "public:libre-2:v1",
    CACHE_TTL_SECONDS: "129600",
    GLUROO_HOST_SUFFIX: ".ns.gluroo.com",
    MAX_ENTRIES: "1000",
    MAX_FUTURE_SKEW_MS: "300000",
    MAX_UPSTREAM_BYTES: "1048576",
    PUBLIC_CACHE_MAX_AGE_SECONDS: "60",
    PUBLIC_WINDOW_HOURS: "24",
    STALE_AFTER_SECONDS: "900",
    UPSTREAM_TIMEOUT_MS: "1000",
    GLUROO_DEMO_SOURCE_URL: SOURCE_URL,
    GLUROO_DEMO_API_SECRET: SECRET,
    DEMO_FEED_CACHE: createMemoryKv(),
    ...overrides,
  };
}

function request(options = {}) {
  return new Request(options.url || "https://feed.example/v1/libre", {
    method: options.method || "GET",
    headers: options.origin === null ? {} : { Origin: options.origin || ORIGIN },
  });
}

function snapshot(overrides = {}) {
  return {
    schemaVersion: 1,
    sourceId: "libre-2",
    generatedAt: NOW_MS,
    entries: [
      { sgv: 104, date: NOW_MS - 300_000, direction: "Flat" },
      { sgv: 109, date: NOW_MS },
    ],
    ...overrides,
  };
}

test("checked-in configuration defaults to disabled", () => {
  assert.equal(readConfig({}).enabled, false);
  assert.equal(readConfig({}).allowedOrigin, ORIGIN);
});

test("accepts one Gluroo HTTPS instance and rejects unsafe destinations", () => {
  assert.equal(validateSourceUrl(`${SOURCE_URL}/ignored?token=old`), SOURCE_URL);
  for (const value of [
    "http://demo.ns.gluroo.com",
    "https://ns.gluroo.com",
    "https://nested.demo.ns.gluroo.com",
    "https://demo.ns.gluroo.com.evil.example",
    "https://user:pass@demo.ns.gluroo.com",
    "https://demo.ns.gluroo.com:8443",
    "https://demo.ns.gluroo.com/#secret",
  ]) {
    assert.throws(() => validateSourceUrl(value), /destination_not_allowed/);
  }
});

test("constructs only the Gluroo entries path and token query", () => {
  const upstream = buildUpstreamUrl(env(), readConfig(env()), NOW_MS);
  assert.equal(upstream.origin, SOURCE_URL);
  assert.equal(upstream.pathname, "/api/v1/entries.json");
  assert.equal(upstream.searchParams.get("count"), "1000");
  assert.equal(upstream.searchParams.get("token"), SECRET);
  assert.equal(upstream.searchParams.has("find[dateString][$gte]"), true);
  assert.equal(upstream.searchParams.has("find[dateString][$lte]"), true);
});

test("fetch uses GET, manual redirects, no-store, timeout, and no credential header", async () => {
  let seenUrl;
  let seenInit;
  const entries = await fetchGlurooEntries(env(), readConfig(env()), {
    nowMs: NOW_MS,
    fetchImpl: async (url, init) => {
      seenUrl = new URL(url);
      seenInit = init;
      return Response.json([{ sgv: 109, date: NOW_MS, direction: "Flat" }]);
    },
  });
  assert.equal(entries.length, 1);
  assert.equal(seenInit.method, "GET");
  assert.equal(seenInit.redirect, "manual");
  assert.equal(seenInit.cache, "no-store");
  assert.equal(seenInit.signal instanceof AbortSignal, true);
  assert.equal(seenInit.headers.Authorization, undefined);
  assert.equal(seenInit.headers["api-secret"], undefined);
  assert.equal(seenUrl.searchParams.get("token"), SECRET);
});

test("upstream redirects and authentication failures expose no provider body or secret", async () => {
  await assert.rejects(
    fetchGlurooEntries(env(), readConfig(env()), {
      nowMs: NOW_MS,
      fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://evil.example" } }),
    }),
    /destination_not_allowed/,
  );
  await assert.rejects(
    fetchGlurooEntries(env(), readConfig(env()), {
      nowMs: NOW_MS,
      fetchImpl: async () => new Response(`bad ${SECRET}`, { status: 401 }),
    }),
    (error) => {
      assert.equal(error.code, "authentication_failed");
      assert.equal(String(error).includes(SECRET), false);
      return true;
    },
  );
});

test("upstream response size and JSON format are bounded", async () => {
  await assert.rejects(
    fetchGlurooEntries(env({ MAX_UPSTREAM_BYTES: "10" }), readConfig(env({ MAX_UPSTREAM_BYTES: "10" })), {
      nowMs: NOW_MS,
      fetchImpl: async () => new Response("[]", { headers: { "Content-Length": "11" } }),
    }),
    /upstream_response_too_large/,
  );
  await assert.rejects(
    fetchGlurooEntries(env(), readConfig(env()), {
      nowMs: NOW_MS,
      fetchImpl: async () => new Response("not-json"),
    }),
    /upstream_invalid_response/,
  );
});

test("normalization keeps only glucose, time, and known direction in the rolling window", () => {
  const entries = normalizeEntries([
    { sgv: 109, date: NOW_MS, direction: "Flat", device: "private", account: "private" },
    { sgv: 101, date: NOW_MS - 600_000, direction: "<script>" },
    { sgv: 120, date: NOW_MS - 25 * 60 * 60 * 1000 },
    { sgv: 109, date: NOW_MS, direction: "SingleUp" },
  ], readConfig(env()), NOW_MS);
  assert.deepEqual(entries, [
    { sgv: 101, date: NOW_MS - 600_000 },
    { sgv: 109, date: NOW_MS, direction: "SingleUp" },
  ]);
});

test("snapshot validation rejects private or unexpected fields", () => {
  assert.deepEqual(validateSnapshot(snapshot(), readConfig(env())).entries, snapshot().entries);
  assert.throws(
    () => validateSnapshot(snapshot({ entries: [{ sgv: 100, date: NOW_MS, device: "private" }] }), readConfig(env())),
    /demo_feed_unavailable/,
  );
});

test("disabled refresh does not read secrets, fetch upstream, or write KV", async () => {
  let fetched = false;
  const cache = createMemoryKv();
  const result = await refreshDemoFeed({
    DEMO_FEED_ENABLED: "false",
    DEMO_FEED_CACHE: cache,
  }, {
    fetchImpl: async () => {
      fetched = true;
      return Response.json([]);
    },
  });
  assert.deepEqual(result, { ok: false, skipped: "disabled" });
  assert.equal(fetched, false);
  assert.equal(cache.writes.length, 0);
});

test("enabled refresh writes one sanitized expiring snapshot", async () => {
  const cache = createMemoryKv();
  const localEnv = env({ DEMO_FEED_CACHE: cache });
  const result = await refreshDemoFeed(localEnv, {
    now: () => NOW_MS,
    fetchImpl: async () => Response.json([
      { sgv: 109, date: NOW_MS, direction: "Flat", device: "private", extra: SECRET },
    ]),
  });
  assert.deepEqual(result, { ok: true, entryCount: 1, generatedAt: NOW_MS });
  assert.equal(cache.writes.length, 1);
  assert.equal(cache.writes[0].key, "public:libre-2:v1");
  assert.equal(cache.writes[0].options.expirationTtl, 129_600);
  assert.equal(cache.writes[0].value.includes(SOURCE_URL), false);
  assert.equal(cache.writes[0].value.includes(SECRET), false);
  assert.deepEqual(Object.keys(JSON.parse(cache.writes[0].value).entries[0]), ["sgv", "date", "direction"]);
});

test("stopped public endpoint fails before reading KV", async () => {
  let read = false;
  const response = await handleDemoFeedRequest(request(), env({
    DEMO_FEED_ENABLED: "false",
    DEMO_FEED_CACHE: {
      async get() { read = true; },
      async put() {},
    },
  }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "demo_feed_paused" });
  assert.equal(read, false);
});

test("public endpoint returns only the reviewed snapshot with exact CORS", async () => {
  const cache = createMemoryKv(snapshot());
  const response = await handleDemoFeedRequest(request(), env({ DEMO_FEED_CACHE: cache }), {
    now: () => NOW_MS + 60_000,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "public, max-age=60");
  assert.equal(body.ok, true);
  assert.equal(body.sourceId, "libre-2");
  assert.equal(body.stale, false);
  assert.deepEqual(body.entries, snapshot().entries);
  assert.equal(JSON.stringify(body).includes(SOURCE_URL), false);
  assert.equal(JSON.stringify(body).includes(SECRET), false);
});

test("stale data remains visible with a stale flag", async () => {
  const response = await handleDemoFeedRequest(
    request(),
    env({ DEMO_FEED_CACHE: createMemoryKv(snapshot()) }),
    { now: () => NOW_MS + 901_000 },
  );
  assert.equal((await response.json()).stale, true);
});

test("preflight uses exact origin without cache access", async () => {
  let read = false;
  const response = await handleDemoFeedRequest(request({ method: "OPTIONS" }), env({
    DEMO_FEED_CACHE: {
      async get() { read = true; },
      async put() {},
    },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  assert.equal(read, false);
});

test("wrong browser origins, methods, and paths are rejected", async () => {
  const wrongOrigin = await handleDemoFeedRequest(request({ origin: "https://evil.example" }), env());
  assert.equal(wrongOrigin.status, 403);
  assert.equal(wrongOrigin.headers.get("access-control-allow-origin"), null);
  assert.equal((await handleDemoFeedRequest(request({ method: "POST" }), env())).status, 405);
  assert.equal((await handleDemoFeedRequest(request({ url: "https://feed.example/other" }), env())).status, 404);
});

test("checked-in Wrangler config is stopped and contains only secret names and the dedicated KV id", () => {
  const text = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(text);
  assert.equal(config.vars.DEMO_FEED_ENABLED, "false");
  assert.equal(config.workers_dev, true);
  assert.equal(config.preview_urls, false);
  assert.equal(config.observability.enabled, false);
  assert.deepEqual(config.triggers.crons, ["*/5 * * * *"]);
  assert.deepEqual([...config.secrets.required].sort(), [
    "GLUROO_DEMO_API_SECRET",
    "GLUROO_DEMO_SOURCE_URL",
  ]);
  assert.equal(config.kv_namespaces[0].binding, "DEMO_FEED_CACHE");
  assert.match(config.kv_namespaces[0].id, /^[a-f0-9]{32}$/u);
  assert.notEqual(config.kv_namespaces[0].id, "00000000000000000000000000000000");
  assert.doesNotMatch(text, /"(?:GLUROO_DEMO_API_SECRET|GLUROO_DEMO_SOURCE_URL)"\s*:\s*"/);
});

test("source has no console logging and package has no deploy script", () => {
  const sources = ["index.js", "demo-feed-core.js"]
    .map((name) => fs.readFileSync(path.join(ROOT, "src", name), "utf8"))
    .join("\n");
  assert.equal(/console\.(?:log|info|warn|error)/u.test(sources), false);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal("deploy" in pkg.scripts, false);
  assert.equal(pkg.scripts["deploy:dry"], "wrangler deploy --dry-run");
});
