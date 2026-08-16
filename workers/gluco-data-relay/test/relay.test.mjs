import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildUpstreamUrl,
  consumeGlobalRelayLimit,
  fetchGlurooEntries,
  handleRelayRequest,
  normalizeEntry,
  readConfig,
  validateRelayPayload,
  validateDeviceSessionCreationPayload,
  validateSourceUrl,
  verifyTurnstileToken,
} from "../src/relay-core.js";
import { consumeCounterStorage, validateCounterInput } from "../src/rate-limit-core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ORIGIN = "https://glucoscope.app";
const TOKEN = "test-token-not-a-real-secret";
const TURNSTILE_TOKEN = "turnstile-test-token";
const DEVICE_SESSION_SECRET = "test-only-device-session-secret-with-at-least-32-characters";
const TURNSTILE_SECRET = "test-only-turnstile-secret";
const NOW_MS = Date.parse("2026-08-03T06:00:00.000Z");
const DEVICE_COOKIE = `__Host-glucoscope_relay_session=${"d".repeat(43)}`;

function env(overrides = {}) {
  return {
    RELAY_ENABLED: "true",
    RELAY_DEVICE_SESSIONS_ENABLED: "true",
    CORS_ALLOWED_ORIGINS: ORIGIN,
    CORS_ALLOW_REQUESTS_WITHOUT_ORIGIN: "false",
    GLUROO_HOST_SUFFIX: ".ns.gluroo.com",
    MAX_ENTRIES: "12000",
    MAX_RANGE_DAYS: "31",
    MAX_REQUEST_BYTES: "8192",
    MAX_UPSTREAM_BYTES: "6291456",
    UPSTREAM_TIMEOUT_MS: "100",
    TURNSTILE_EXPECTED_HOSTNAME: "glucoscope.app",
    TURNSTILE_EXPECTED_ACTION: "glucoscope-data-relay",
    TURNSTILE_TIMEOUT_MS: "100",
    RELAY_DEVICE_SESSION_IDLE_TTL_SECONDS: "15552000",
    RELAY_DEVICE_SESSION_DAILY_LIMIT: "3000",
    GLOBAL_WARNING_DAILY: "20000",
    GLOBAL_HARD_DAILY: "50000",
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    RELAY_DEVICE_SESSION_SECRET: DEVICE_SESSION_SECRET,
    ...overrides,
  };
}

function relayRequest(body, options = {}) {
  const method = options.method || "POST";
  return new Request(options.url || "https://relay.example/v1/entries", {
    method,
    headers: {
      Origin: options.origin === undefined ? ORIGIN : options.origin,
      "Content-Type": options.contentType || "application/json",
      Cookie: options.cookie === undefined ? DEVICE_COOKIE : options.cookie,
      ...(options.headers || {}),
    },
    body: method === "OPTIONS" ? undefined : JSON.stringify(body),
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

function bypassServices(overrides = {}) {
  return {
    now: () => NOW_MS,
    authorizeDeviceSession: async () => ({ tokenId: "e".repeat(43), result: { status: "active" } }),
    consumeGlobalLimit: async () => ({ globalCount: 1, warning: false }),
    ...overrides,
  };
}

function createCounterBinding() {
  const counters = new Map();
  return {
    counters,
    idFromName(name) {
      return name;
    },
    get(id) {
      return {
        async fetch(_url, init) {
          const { bucket, limit } = JSON.parse(init.body);
          const previous = counters.get(id);
          const count = previous?.bucket === bucket ? previous.count : 0;
          if (count >= limit) {
            return Response.json({ allowed: false, count, limit }, { status: 429 });
          }
          const next = count + 1;
          counters.set(id, { bucket, count: next });
          return Response.json({ allowed: true, count: next, limit });
        },
      };
    },
  };
}

function createMemoryStorage() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    async transaction(callback) {
      const transaction = {
        async get(key) {
          return values.get(key);
        },
        async put(entries) {
          writes.push({ ...entries });
          for (const [key, value] of Object.entries(entries)) values.set(key, value);
        },
      };
      return callback(transaction);
    },
  };
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
  assert.equal(upstream.toString().includes("relayTicket"), false);
});

test("rejects the removed relayTicket field", () => {
  const config = readConfig(env());
  assert.throws(
    () => validateRelayPayload(validPayload({ relayTicket: "removed" }), config),
    /invalid_request/,
  );
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

test("device-session creation validates only Turnstile and one fixed source credential pair", () => {
  const input = {
    turnstileToken: TURNSTILE_TOKEN,
    sourceUrl: "https://sample.ns.gluroo.com/ignored",
    credential: TOKEN,
  };
  assert.deepEqual(validateDeviceSessionCreationPayload(input, readConfig(env())), {
    turnstileToken: TURNSTILE_TOKEN,
    sourceUrl: "https://sample.ns.gluroo.com",
    credential: TOKEN,
  });
  assert.throws(
    () => validateDeviceSessionCreationPayload({ ...input, unexpected: true }, readConfig(env())),
    /invalid_request/,
  );
  assert.throws(
    () => validateDeviceSessionCreationPayload({ ...input, turnstileToken: "" }, readConfig(env())),
    /turnstile_failed/,
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
    bypassServices({
      upstreamFetch: async () => new Response(`bad credential ${TOKEN}`, { status: 401 }),
    }),
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
    bypassServices({
      upstreamFetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    }),
  );
  assert.equal(response.status, 504);
  assert.deepEqual(await response.json(), { ok: false, error: "upstream_timeout" });
});

test("rejects an oversized upstream response from content-length", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env({ MAX_UPSTREAM_BYTES: "10" }),
    bypassServices({
      upstreamFetch: async () => new Response("[]", { headers: { "Content-Length": "11" } }),
    }),
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
    bypassServices({ upstreamFetch: async () => new Response(stream) }),
  );
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, error: "upstream_response_too_large" });
});

test("rejects invalid JSON and unsupported entry formats", async () => {
  const invalidJson = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    bypassServices({ upstreamFetch: async () => new Response("not-json") }),
  );
  assert.deepEqual(await invalidJson.json(), { ok: false, error: "unsupported_data_format" });

  const unsupported = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    bypassServices({ upstreamFetch: jsonFetch([{ glucose: 100, timestamp: 123 }]) }),
  );
  assert.deepEqual(await unsupported.json(), { ok: false, error: "unsupported_data_format" });
});

test("whitelists returned fields and normalizes second-based timestamps", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    bypassServices({
      upstreamFetch: jsonFetch([
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
    }),
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

test("validates Turnstile server-side with exact hostname and action", async () => {
  let seenUrl;
  let seenInit;
  const result = await verifyTurnstileToken(
    TURNSTILE_TOKEN,
    env(),
    readConfig(env()),
    async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return Response.json({
        success: true,
        hostname: "glucoscope.app",
        action: "glucoscope-data-relay",
      });
    },
  );
  assert.equal(result, true);
  assert.equal(seenUrl, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(seenInit.method, "POST");
  assert.equal(seenInit.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.equal(seenInit.redirect, undefined);
  assert.equal(seenInit.cache, undefined);
  assert.equal(seenInit.signal instanceof AbortSignal, true);
  assert.equal(seenInit.body instanceof URLSearchParams, true);
  assert.equal(seenInit.body.get("secret"), TURNSTILE_SECRET);
  assert.equal(seenInit.body.get("response"), TURNSTILE_TOKEN);
});

test("maps Siteverify transport, HTTP, and response failures to safe diagnostics", async () => {
  const cases = [
    [async () => { throw new TypeError("network failed"); }, "710001"],
    [async () => new Response("unavailable", { status: 503 }), "710002"],
    [async () => new Response("not-json"), "710003"],
  ];

  for (const [fetchImpl, diagnosticCode] of cases) {
    await assert.rejects(
      verifyTurnstileToken(TURNSTILE_TOKEN, env(), readConfig(env()), fetchImpl),
      (error) => {
        assert.equal(error.code, "turnstile_failed");
        assert.equal(error.turnstileErrorCode, diagnosticCode);
        assert.equal(String(error).includes("network failed"), false);
        assert.equal(String(error).includes("unavailable"), false);
        assert.equal(String(error).includes("not-json"), false);
        return true;
      },
    );
  }
});

test("rejects Turnstile hostname, action, and success mismatches with safe diagnostics", async () => {
  const failures = [
    {
      result: { success: false, hostname: "glucoscope.app", action: "glucoscope-data-relay" },
      diagnosticCode: "710999",
    },
    {
      result: { success: true, hostname: "evil.example", action: "glucoscope-data-relay" },
      diagnosticCode: "710601",
    },
    {
      result: { success: true, hostname: "glucoscope.app", action: "other-action" },
      diagnosticCode: "710602",
    },
  ];
  for (const { result, diagnosticCode } of failures) {
    await assert.rejects(
      verifyTurnstileToken(TURNSTILE_TOKEN, env(), readConfig(env()), async () => Response.json(result)),
      (error) => {
        assert.equal(error.code, "turnstile_failed");
        assert.equal(error.turnstileErrorCode, diagnosticCode);
        return true;
      },
    );
  }
});

test("maps only known Siteverify failures to opaque six-digit diagnostics", async () => {
  const cases = [
    ["missing-input-secret", "710101"],
    ["invalid-input-secret", "710102"],
    ["missing-input-response", "710201"],
    ["invalid-input-response", "710202"],
    ["bad-request", "710301"],
    ["timeout-or-duplicate", "710401"],
    ["internal-error", "710501"],
    ["provider-detail-not-allowlisted", "710999"],
  ];

  for (const [siteverifyCode, diagnosticCode] of cases) {
    await assert.rejects(
      verifyTurnstileToken(
        TURNSTILE_TOKEN,
        env(),
        readConfig(env()),
        async () => Response.json({ success: false, "error-codes": [siteverifyCode] }),
      ),
      (error) => {
        assert.equal(error.code, "turnstile_failed");
        assert.equal(error.turnstileErrorCode, diagnosticCode);
        assert.equal(String(error).includes(siteverifyCode), false);
        return true;
      },
    );
  }
});

test("device-session endpoint returns only an opaque diagnostic for a Siteverify failure", async () => {
  const response = await handleRelayRequest(
    relayRequest(
      {
        turnstileToken: TURNSTILE_TOKEN,
        sourceUrl: "https://sample.ns.gluroo.com",
        credential: TOKEN,
      },
      { url: "https://relay.example/v1/device-session" },
    ),
    env(),
    {
      turnstileFetch: async () => Response.json({
        success: false,
        "error-codes": ["invalid-input-secret"],
      }),
    },
  );
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.deepEqual(body, {
    ok: false,
    error: "turnstile_failed",
    turnstileErrorCode: "710102",
  });
  assert.equal(JSON.stringify(body).includes(TURNSTILE_SECRET), false);
  assert.equal(JSON.stringify(body).includes(TURNSTILE_TOKEN), false);
  assert.equal(JSON.stringify(body).includes("invalid-input-secret"), false);
});

test("counter input accepts only a day bucket and positive limit", () => {
  assert.deepEqual(validateCounterInput({ bucket: "2026-08-03", limit: 250 }), {
    bucket: "2026-08-03",
    limit: 250,
  });
  assert.throws(() => validateCounterInput({ bucket: "2026/08/03", limit: 250 }));
  assert.throws(() => validateCounterInput({ bucket: "2026-08-03", limit: 0 }));
  assert.throws(() => validateCounterInput({ bucket: "2026-08-03", limit: 250, token: TOKEN }));
});

test("counter storage records only bucket and count and enforces the limit", async () => {
  const storage = createMemoryStorage();
  assert.deepEqual(await consumeCounterStorage(storage, { bucket: "2026-08-03", limit: 2 }), {
    allowed: true,
    count: 1,
    limit: 2,
  });
  assert.deepEqual(await consumeCounterStorage(storage, { bucket: "2026-08-03", limit: 2 }), {
    allowed: true,
    count: 2,
    limit: 2,
  });
  assert.deepEqual(await consumeCounterStorage(storage, { bucket: "2026-08-03", limit: 2 }), {
    allowed: false,
    count: 2,
    limit: 2,
  });
  assert.deepEqual([...storage.values.keys()].sort(), ["bucket", "count"]);
  assert.equal(JSON.stringify(storage.writes).includes(TOKEN), false);
});

test("counter resets when the UTC day bucket changes", async () => {
  const storage = createMemoryStorage();
  await consumeCounterStorage(storage, { bucket: "2026-08-03", limit: 2 });
  const nextDay = await consumeCounterStorage(storage, { bucket: "2026-08-04", limit: 2 });
  assert.deepEqual(nextDay, { allowed: true, count: 1, limit: 2 });
});

test("global relay limit uses only the Worker-wide UTC counter", async () => {
  const binding = createCounterBinding();
  const localEnv = env({ RELAY_USAGE_COUNTER: binding });
  const result = await consumeGlobalRelayLimit(localEnv, readConfig(localEnv), NOW_MS);
  assert.deepEqual(result, { globalCount: 1, warning: false });
  assert.deepEqual([...binding.counters.keys()], ["global"]);
});

test("global hard stop returns paused", async () => {
  const globalBinding = createCounterBinding();
  const globalEnv = env({
    RELAY_USAGE_COUNTER: globalBinding,
    GLOBAL_WARNING_DAILY: "1",
    GLOBAL_HARD_DAILY: "1",
  });
  await consumeGlobalRelayLimit(globalEnv, readConfig(globalEnv), NOW_MS);
  await assert.rejects(
    consumeGlobalRelayLimit(globalEnv, readConfig(globalEnv), NOW_MS),
    /relay_temporarily_paused/,
  );
});

test("missing Durable Object binding fails closed", async () => {
  await assert.rejects(
    consumeGlobalRelayLimit(env(), readConfig(env()), NOW_MS),
    /relay_temporarily_paused/,
  );
});

test("returns no-store security headers and exact allowed origin", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload()),
    env(),
    bypassServices({ upstreamFetch: jsonFetch([{ sgv: 100, date: 1785000000000 }]) }),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("cross-origin-resource-policy"), null);
});

test("rejects requests from an unapproved origin", async () => {
  const response = await handleRelayRequest(
    relayRequest(validPayload(), { origin: "https://evil.example" }),
    env(),
    bypassServices({ upstreamFetch: jsonFetch([]) }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("handles allowed CORS preflights without Turnstile, session, counter, or upstream calls", async () => {
  let called = false;
  for (const pathname of ["/v1/device-session/status", "/v1/entries"]) {
    const response = await handleRelayRequest(
      relayRequest({}, { method: "OPTIONS", url: `https://relay.example${pathname}` }),
      env(),
      {
        verifyTurnstile: async () => {
          called = true;
        },
        authorizeDeviceSession: async () => {
          called = true;
        },
        upstreamFetch: async () => {
          called = true;
          return new Response();
        },
      },
    );
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  }
  assert.equal(called, false);
});

test("honors the checked-in kill switch for device sessions and entries", async () => {
  for (const pathname of ["/v1/device-session", "/v1/entries"]) {
    const response = await handleRelayRequest(
      relayRequest(
        pathname === "/v1/device-session" ? { turnstileToken: TURNSTILE_TOKEN } : validPayload(),
        { url: `https://relay.example${pathname}` },
      ),
      env({ RELAY_ENABLED: "false" }),
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: "relay_temporarily_paused" });
  }
});

test("rejects oversized request bodies before authentication or upstream access", async () => {
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

test("checked-in Wrangler config remains paused on the reviewed custom domain with SQLite Durable Object exports", () => {
  const configText = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  const config = JSON.parse(configText);
  assert.match(configText, /"observability"\s*:\s*\{\s*"enabled"\s*:\s*false/s);
  assert.match(configText, /"RELAY_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"RELAY_DEVICE_SESSIONS_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"workers_dev"\s*:\s*false/);
  assert.match(configText, /"preview_urls"\s*:\s*false/);
  assert.deepEqual(config.routes, [{ pattern: "relay.glucoscope.app", custom_domain: true }]);
  assert.equal(config.vars.CORS_ALLOWED_ORIGINS, "https://glucoscope.app");
  assert.equal(config.vars.TURNSTILE_EXPECTED_HOSTNAME, "glucoscope.app");
  assert.match(configText, /"name"\s*:\s*"RELAY_USAGE_COUNTER"/);
  assert.match(configText, /"class_name"\s*:\s*"RelayUsageCounter"/);
  assert.match(configText, /"RelayUsageCounter"\s*:\s*\{\s*"type"\s*:\s*"durable-object"\s*,\s*"storage"\s*:\s*"sqlite"/s);
  assert.match(configText, /"name"\s*:\s*"RELAY_DEVICE_SESSION"/);
  assert.match(configText, /"class_name"\s*:\s*"RelayDeviceSession"/);
  assert.match(configText, /"RelayDeviceSession"\s*:\s*\{\s*"type"\s*:\s*"durable-object"\s*,\s*"storage"\s*:\s*"sqlite"/s);
  assert.deepEqual([...config.secrets.required].sort(), [
    "RELAY_DEVICE_SESSION_SECRET",
    "TURNSTILE_SECRET_KEY",
  ]);
  assert.equal(config.vars.TURNSTILE_TIMEOUT_MS, "10000");
  assert.equal(config.vars.RELAY_DEVICE_SESSION_DAILY_LIMIT, "3000");
  assert.equal(config.vars.RELAY_DEVICE_SESSION_IDLE_TTL_SECONDS, "15552000");
  assert.doesNotMatch(
    configText,
    /"(?:TURNSTILE_SECRET_KEY|RELAY_DEVICE_SESSION_SECRET)"\s*:\s*"/,
  );
  assert.doesNotMatch(configText, /RELAY_TICKET|LEGACY_TICKET|"SESSION_DAILY_LIMIT"/u);
  assert.equal(/kv_namespaces|d1_databases|r2_buckets/i.test(configText), false);
});

test("relay source contains no console logging, shared cache, or AI binding", () => {
  const sources = [
    "relay-core.js",
    "rate-limit-core.js",
    "rate-limit-counter.js",
    "device-session-core.js",
    "device-session.js",
  ].map((name) => fs.readFileSync(path.join(ROOT, "src", name), "utf8"));
  const source = sources.join("\n");
  assert.equal(/console\.(log|info|warn|error)/.test(source), false);
  assert.equal(/caches\.default|AI_LETTER_CACHE|OPENAI|gluco-letter-worker/.test(source), false);
});

test("package intentionally has no real deploy script", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal("deploy" in pkg.scripts, false);
  assert.equal(pkg.scripts["deploy:dry"], "wrangler deploy --dry-run");
});
