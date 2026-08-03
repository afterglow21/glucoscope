import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildUpstreamUrl,
  fetchGlurooEntries,
  handleRelayRequest,
  normalizeEntry,
  readConfig,
  validateRelayPayload,
  validateSourceUrl,
} from "../src/relay-core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ORIGIN = "https://afterglow21.github.io";
const TOKEN = "test-token-not-a-real-secret";

function env(overrides = {}) {
  return {
    RELAY_ENABLED: "true",
    CORS_ALLOWED_ORIGINS: ORIGIN,
    CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN: "false",
    GLUROO_HOST_SUFFIX: ".ns.gluroo.com",
    MAX_ENTRIES: "12000",
    MAX_RANGE_DAYS: "31",
    MAX_REQUEST_BYTES: "8192",
    MAX_UPSTREAM_BYTES: "6291456",
    UPSTREAM_TIMEOUT_MS: "100",
    ...overrides,
  };
}

function relayRequest(body, options = {}) {
  return new Request(options.url || "https://relay.example/v1/entries", {
    method: options.method || "POST",
    headers: {
      Origin: options.origin === undefined ? ORIGIN : options.origin,
      "Content-Type": options.contentType || "application/json",
      ...(options.headers || {}),
    },
    body: options.method === "OPTIONS" ? undefined : JSON.stringify(body),
  });
}

function validPayload(overrides = {}) {
  return {
    sourceUrl: "https://example.ns.gluroo.com/ignored/path?old=query",
    credential: TOKEN,
    limit: 2,
    ...overrides,
  };
}

function jsonFetch(data, options = {}) {
  return async () =>
    new Response(JSON.stringify(data), {
      status: options.status || 200,
      headers: options.headers || { "Content-Type": "application/json" },
    });
}

test("accepts only a Gluroo HTTPS subdomain and strips user path/query", () => {
  assert.equal(
    validateSourceUrl("https://abc.ns.gluroo.com/user/path?token=old"),
    "https://abc.ns.gluroo.com",
  );
});

test("rejects HTTP, unrelated hosts, bare suffix host, URL credentials, ports, and fragments", () => {
  const rejected = [
    "http://abc.ns.gluroo.com",
    "https://example.com",
    "https://ns.gluroo.com",
    "https://user:pass@abc.ns.gluroo.com",
    "https://abc.ns.gluroo.com:8443",
    "https://abc.ns.gluroo.com/#secret",
    "https://abc.ns.gluroo.com.evil.example",
    "https://nested.abc.ns.gluroo.com",
  ];
  for (const value of rejected) {
    assert.throws(() => validateSourceUrl(value), /destination_not_allowed/);
  }
});

test("constructs only entries.json with count, date bounds, and token-query auth", () => {
  const { upstream } = buildUpstreamUrl(
    validPayload({
      limit: 100,
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-02T00:00:00.000Z",
    }),
    readConfig(env()),
  );
  assert.equal(upstream.origin, "https://example.ns.gluroo.com");
  assert.equal(upstream.pathname, "/api/v1/entries.json");
  assert.equal(upstream.searchParams.get("count"), "100");
  assert.equal(upstream.searchParams.get("find[dateString][$gte]"), "2026-07-01T00:00:00.000Z");
  assert.equal(upstream.searchParams.get("find[dateString][$lte]"), "2026-07-02T00:00:00.000Z");
  assert.equal(upstream.searchParams.get("token"), TOKEN);
  assert.equal(upstream.searchParams.has("old"), false);
});

test("rejects unknown payload fields, oversized entry limits, and ranges over 31 days", () => {
  const config = readConfig(env());
  assert.throws(() => validateRelayPayload(validPayload({ path: "/other" }), config), /invalid_request/);
  assert.throws(() => validateRelayPayload(validPayload({ limit: 12001 }), config), /invalid_request/);
  assert.throws(
    () =>
      validateRelayPayload(
        validPayload({ from: "2026-06-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" }),
        config,
      ),
    /invalid_request/,
  );
});

test("uses GET, manual redirects, no-store cache, and never sends token in headers", async () => {
  let seenUrl;
  let seenInit;
  const entries = await fetchGlurooEntries(validPayload(), readConfig(env()), async (url, init) => {
    seenUrl = new URL(url);
    seenInit = init;
    return new Response(JSON.stringify([{ sgv: 110, date: 1785000000000, direction: "Flat" }]));
  });
  assert.equal(seenInit.method, "GET");
  assert.equal(seenInit.redirect, "manual");
  assert.equal(seenInit.cache, "no-store");
  assert.equal(seenInit.headers.Authorization, undefined);
  assert.equal(seenInit.headers["api-secret"], undefined);
  assert.equal(seenUrl.searchParams.get("token"), TOKEN);
  assert.equal(entries.length, 1);
});

test("rejects upstream redirects without following them", async () => {
  await assert.rejects(
    fetchGlurooEntries(validPayload(), readConfig(env()), async () =>
      new Response(null, { status: 302, headers: { Location: "https://evil.example" } }),
    ),
    /destination_not_allowed/,
  );
});

test("classifies authentication failure without exposing token or upstream body", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    async () => new Response(`bad credential ${TOKEN}`, { status: 401 }),
  );
  const text = await response.text();
  assert.equal(response.status, 401);
  assert.match(text, /authentication_failed/);
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes("bad credential"), false);
});

test("classifies an aborted upstream request as timeout", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env({ UPSTREAM_TIMEOUT_MS: "5" }),
    async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { ok: false, error: "upstream_timeout" });
});

test("rejects an oversized upstream response from content-length", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env({ MAX_UPSTREAM_BYTES: "10" }),
    async () => new Response("[]", { headers: { "Content-Length": "11" } }),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "upstream_response_too_large" });
});

test("rejects an oversized streamed upstream response", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("123456"));
      controller.enqueue(new TextEncoder().encode("789012"));
      controller.close();
    },
  });
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env({ MAX_UPSTREAM_BYTES: "10" }),
    async () => new Response(stream),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "upstream_response_too_large" });
});

test("rejects invalid JSON and unsupported entry formats", async () => {
  const invalidJson = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    async () => new Response("not-json"),
  );
  assert.deepEqual(await invalidJson.json(), { ok: false, error: "unsupported_data_format" });

  const unsupported = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    jsonFetch([{ glucose: 100, timestamp: 123 }]),
  );
  assert.deepEqual(await unsupported.json(), { ok: false, error: "unsupported_data_format" });
});

test("whitelists returned fields and normalizes second-based timestamps", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    jsonFetch([
      {
        _id: "private-id",
        sgv: 124.4,
        date: 1785000000,
        dateString: "untrusted",
        direction: "Flat",
        device: "private-device",
        extra: TOKEN,
      },
    ]),
  );
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.deepEqual(Object.keys(body.entries[0]), ["sgv", "date", "dateString", "direction"]);
  assert.equal(body.entries[0].sgv, 124);
  assert.equal(body.entries[0].date, 1785000000000);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("drops unknown direction values", () => {
  const entry = normalizeEntry({ sgv: 100, date: 1785000000000, direction: "<script>" });
  assert.equal("direction" in entry, false);
});

test("returns no-store security headers and exact allowed origin", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    jsonFetch([{ sgv: 100, date: 1785000000000 }]),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});

test("rejects requests from an unapproved origin", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload(), { origin: "https://evil.example" }),
    env(),
    jsonFetch([]),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("handles an allowed CORS preflight without touching upstream", async () => {
  let called = false;
  const response = await handleRelayRequest(
    relayRequest({}, { method: "OPTIONS" }),
    env(),
    async () => {
      called = true;
      return new Response();
    },
  );
  assert.equal(response.status, 204);
  assert.equal(called, false);
  assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
});

test("honors the checked-in kill switch", async () => {
  const response = await handleRelayRequest(relayRequest(validPayload()), env({ RELAY_ENABLED: "false" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "relay_temporarily_paused" });
});

test("rejects oversized request bodies before upstream access", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload(), { headers: { "Content-Length": "9000" } }),
    env({ MAX_REQUEST_BYTES: "8192" }),
  );
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_request" });
});


test("rejects chunked request bodies after the configured byte limit", async () => {
  const oversized = "x".repeat(9000);
  const request = new Request("https://relay.example/v1/entries", {
    method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    }),
    duplex: "half",
  });
  const response = await handleRelayRequest(request, env({ MAX_REQUEST_BYTES: "8192" }));
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { ok: false, error: "invalid_request" });
});

test("rejects compressed request bodies", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload(), { headers: { "Content-Encoding": "gzip" } }),
    env(),
  );
  assert.equal(response.status, 415);
});

test("rejects missing origins, wrong methods, and unknown paths", async () => {
  const missingOriginRequest = new Request("https://relay.example/v1/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(validPayload()),
  });
  const missingOrigin = await handleRelayRequest(missingOriginRequest, env());
  assert.equal(missingOrigin.status, 403);

  const wrongMethod = await handleRelayRequest(
    relayRequest(validPayload(), { method: "PUT" }),
    env(),
  );
  assert.equal(wrongMethod.status, 405);

  const wrongPath = await handleRelayRequest(
    relayRequest(validPayload(), { url: "https://relay.example/v1/other" }),
    env(),
  );
  assert.equal(wrongPath.status, 404);
});

test("checked-in Wrangler config disables observability and starts paused", () => {
  const configText = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  assert.match(configText, /"observability"\s*:\s*\{\s*"enabled"\s*:\s*false/s);
  assert.match(configText, /"RELAY_ENABLED"\s*:\s*"false"/);
  assert.equal(/kv_namespaces|durable_objects|d1_databases|r2_buckets/i.test(configText), false);
});

test("relay source contains no console logging or shared cache access", () => {
  const source = fs.readFileSync(path.join(ROOT, "src", "relay-core.js"), "utf8");
  assert.equal(/console\.(log|info|warn|error)/.test(source), false);
  assert.equal(/caches\.default|\.put\(|AI_LETTER_CACHE|KV|D1|R2/.test(source), false);
});
