import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildUpstreamUrl,
  consumeRelayLimits,
  fetchGlurooEntries,
  handleRelayRequest,
  issueRelayTicket,
  normalizeEntry,
  readConfig,
  validateRelayPayload,
  validateSessionPayload,
  validateSourceUrl,
  verifyRelayTicket,
  verifyTurnstileToken,
} from "../src/relay-core.js";
import { consumeCounterStorage, validateCounterInput } from "../src/rate-limit-core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ORIGIN = "https://afterglow21.github.io";
const TOKEN = "test-token-not-a-real-secret";
const TURNSTILE_TOKEN = "turnstile-test-token";
const TICKET_SECRET = "test-only-ticket-secret-with-at-least-32-characters";
const TURNSTILE_SECRET = "test-only-turnstile-secret";
const NOW_MS = Date.parse("2026-08-03T06:00:00.000Z");
const TEST_SID = "123e4567-e89b-42d3-a456-426614174000";

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
    TURNSTILE_EXPECTED_HOSTNAME: "afterglow21.github.io",
    TURNSTILE_EXPECTED_ACTION: "glucoscope-data-relay",
    TURNSTILE_TIMEOUT_MS: "100",
    RELAY_TICKET_TTL_SECONDS: "3600",
    SESSION_DAILY_LIMIT: "250",
    GLOBAL_WARNING_DAILY: "20000",
    GLOBAL_HARD_DAILY: "50000",
    TURNSTILE_SECRET_KEY: TURNSTILE_SECRET,
    RELAY_TICKET_SECRET: TICKET_SECRET,
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
    relayTicket: "fake-ticket-value-that-is-long-enough.for-tests",
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
    verifyTicket: async () => ({ sid: TEST_SID, origin: ORIGIN, scope: "entries" }),
    consumeLimits: async () => ({ globalCount: 1, sessionCount: 1, warning: false }),
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

test("requires a relay ticket at the HTTP boundary but not in the upstream builder", () => {
  const config = readConfig(env());
  const withoutTicket = { sourceUrl: "https://abc.ns.gluroo.com", credential: TOKEN, limit: 2 };
  assert.equal(validateRelayPayload(withoutTicket, config).relayTicket, undefined);
  assert.throws(
    () => validateRelayPayload(withoutTicket, config, { requireTicket: true }),
    /relay_ticket_invalid/,
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

test("validates only the Turnstile token field for a session request", () => {
  assert.deepEqual(validateSessionPayload({ turnstileToken: TURNSTILE_TOKEN }), {
    turnstileToken: TURNSTILE_TOKEN,
  });
  assert.throws(
    () => validateSessionPayload({ turnstileToken: TURNSTILE_TOKEN, credential: TOKEN }),
    /invalid_request/,
  );
  assert.throws(() => validateSessionPayload({ turnstileToken: "" }), /turnstile_failed/);
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

test("issues and verifies an origin-bound HMAC ticket", async () => {
  const config = readConfig(env());
  const issued = await issueRelayTicket({
    origin: ORIGIN,
    secret: TICKET_SECRET,
    config,
    nowMs: NOW_MS,
    randomUUID: () => TEST_SID,
  });
  const claims = await verifyRelayTicket({
    ticket: issued.ticket,
    origin: ORIGIN,
    secret: TICKET_SECRET,
    config,
    nowMs: NOW_MS + 10_000,
  });
  assert.equal(claims.sid, TEST_SID);
  assert.equal(claims.origin, ORIGIN);
  assert.equal(claims.scope, "entries");
  assert.equal(issued.expiresInSeconds, 3600);
  assert.equal(issued.ticket.includes(TICKET_SECRET), false);
});

test("rejects tampered, expired, wrong-origin, and wrong-secret tickets", async () => {
  const config = readConfig(env());
  const issued = await issueRelayTicket({
    origin: ORIGIN,
    secret: TICKET_SECRET,
    config,
    nowMs: NOW_MS,
    randomUUID: () => TEST_SID,
  });
  const tampered = `${issued.ticket.slice(0, -1)}${issued.ticket.endsWith("A") ? "B" : "A"}`;
  await assert.rejects(
    verifyRelayTicket({ ticket: tampered, origin: ORIGIN, secret: TICKET_SECRET, config, nowMs: NOW_MS }),
    /relay_ticket_invalid/,
  );
  await assert.rejects(
    verifyRelayTicket({
      ticket: issued.ticket,
      origin: ORIGIN,
      secret: TICKET_SECRET,
      config,
      nowMs: NOW_MS + 3_600_000,
    }),
    /relay_ticket_invalid/,
  );
  await assert.rejects(
    verifyRelayTicket({
      ticket: issued.ticket,
      origin: "https://evil.example",
      secret: TICKET_SECRET,
      config,
      nowMs: NOW_MS,
    }),
    /relay_ticket_invalid/,
  );
  await assert.rejects(
    verifyRelayTicket({
      ticket: issued.ticket,
      origin: ORIGIN,
      secret: "different-test-secret-that-is-at-least-32-characters",
      config,
      nowMs: NOW_MS,
    }),
    /relay_ticket_invalid/,
  );
});

test("fails closed when the ticket secret is absent or too short", async () => {
  await assert.rejects(
    issueRelayTicket({
      origin: ORIGIN,
      secret: "short",
      config: readConfig(env()),
      nowMs: NOW_MS,
      randomUUID: () => TEST_SID,
    }),
    /relay_temporarily_paused/,
  );
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
        hostname: "afterglow21.github.io",
        action: "glucoscope-data-relay",
      });
    },
  );
  assert.equal(result, true);
  assert.equal(seenUrl, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(seenInit.method, "POST");
  assert.equal(seenInit.redirect, "error");
  assert.equal(seenInit.cache, "no-store");
  const body = JSON.parse(seenInit.body);
  assert.equal(body.secret, TURNSTILE_SECRET);
  assert.equal(body.response, TURNSTILE_TOKEN);
});

test("rejects Turnstile hostname, action, and success mismatches", async () => {
  const failures = [
    { success: false, hostname: "afterglow21.github.io", action: "glucoscope-data-relay" },
    { success: true, hostname: "evil.example", action: "glucoscope-data-relay" },
    { success: true, hostname: "afterglow21.github.io", action: "other-action" },
  ];
  for (const result of failures) {
    await assert.rejects(
      verifyTurnstileToken(TURNSTILE_TOKEN, env(), readConfig(env()), async () => Response.json(result)),
      /turnstile_failed/,
    );
  }
});

test("session endpoint returns a signed ticket but no secret", async () => {
  const response = await handleRelayRequest(
    relayRequest(
      { turnstileToken: TURNSTILE_TOKEN },
      { url: "https://relay.example/v1/session" },
    ),
    env(),
    {
      now: () => NOW_MS,
      randomUUID: () => TEST_SID,
      turnstileFetch: async () =>
        Response.json({
          success: true,
          hostname: "afterglow21.github.io",
          action: "glucoscope-data-relay",
        }),
    },
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.relayTicket, "string");
  assert.equal(body.expiresInSeconds, 3600);
  assert.equal(JSON.stringify(body).includes(TICKET_SECRET), false);
  assert.equal(JSON.stringify(body).includes(TURNSTILE_SECRET), false);
});

test("entries endpoint accepts a real issued ticket and checks limits before upstream", async () => {
  const localEnv = env({ RELAY_USAGE_COUNTER: createCounterBinding() });
  const config = readConfig(localEnv);
  const issued = await issueRelayTicket({
    origin: ORIGIN,
    secret: TICKET_SECRET,
    config,
    nowMs: NOW_MS,
    randomUUID: () => TEST_SID,
  });
  const calls = [];
  const response = await handleRelayRequest(
    relayRequest(validPayload({ relayTicket: issued.ticket })),
    localEnv,
    {
      now: () => NOW_MS + 1_000,
      upstreamFetch: async () => {
        calls.push("upstream");
        return new Response(JSON.stringify([{ sgv: 110, date: 1785000000000 }]));
      },
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    entries: [{ sgv: 110, date: 1785000000000, dateString: "2026-07-25T17:20:00.000Z" }],
  });
  assert.deepEqual(calls, ["upstream"]);
});

test("invalid tickets are rejected before rate limits and upstream", async () => {
  let limitsCalled = false;
  let upstreamCalled = false;
  const response = await handleRelayRequest(
    relayRequest(validPayload({ relayTicket: "invalid-ticket-value-that-is-long-enough.x" })),
    env(),
    {
      now: () => NOW_MS,
      consumeLimits: async () => {
        limitsCalled = true;
      },
      upstreamFetch: async () => {
        upstreamCalled = true;
        return new Response("[]");
      },
    },
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "relay_ticket_invalid" });
  assert.equal(limitsCalled, false);
  assert.equal(upstreamCalled, false);
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

test("relay limits use anonymous session and global counters only", async () => {
  const binding = createCounterBinding();
  const localEnv = env({ RELAY_USAGE_COUNTER: binding });
  const result = await consumeRelayLimits(
    localEnv,
    { sid: TEST_SID },
    readConfig(localEnv),
    NOW_MS,
  );
  assert.deepEqual(result, { globalCount: 1, sessionCount: 1, warning: false });
  assert.deepEqual([...binding.counters.keys()].sort(), ["global", `session:${TEST_SID}`].sort());
});

test("per-session limit returns rate_limited and global hard stop returns paused", async () => {
  const sessionBinding = createCounterBinding();
  const sessionEnv = env({
    RELAY_USAGE_COUNTER: sessionBinding,
    SESSION_DAILY_LIMIT: "1",
  });
  await consumeRelayLimits(sessionEnv, { sid: TEST_SID }, readConfig(sessionEnv), NOW_MS);
  await assert.rejects(
    consumeRelayLimits(sessionEnv, { sid: TEST_SID }, readConfig(sessionEnv), NOW_MS),
    /rate_limited/,
  );

  const globalBinding = createCounterBinding();
  const globalEnv = env({
    RELAY_USAGE_COUNTER: globalBinding,
    GLOBAL_WARNING_DAILY: "1",
    GLOBAL_HARD_DAILY: "1",
  });
  await consumeRelayLimits(globalEnv, { sid: TEST_SID }, readConfig(globalEnv), NOW_MS);
  await assert.rejects(
    consumeRelayLimits(globalEnv, { sid: TEST_SID }, readConfig(globalEnv), NOW_MS),
    /relay_temporarily_paused/,
  );
});

test("missing Durable Object binding fails closed", async () => {
  await assert.rejects(
    consumeRelayLimits(env(), { sid: TEST_SID }, readConfig(env()), NOW_MS),
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

test("handles allowed CORS preflights without Turnstile, ticket, counter, or upstream calls", async () => {
  let called = false;
  for (const pathname of ["/v1/session", "/v1/entries"]) {
    const response = await handleRelayRequest(
      relayRequest({}, { method: "OPTIONS", url: `https://relay.example${pathname}` }),
      env(),
      {
        verifyTurnstile: async () => {
          called = true;
        },
        verifyTicket: async () => {
          called = true;
        },
        consumeLimits: async () => {
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

test("honors the checked-in kill switch for sessions and entries", async () => {
  for (const pathname of ["/v1/session", "/v1/entries"]) {
    const response = await handleRelayRequest(
      relayRequest(
        pathname === "/v1/session" ? { turnstileToken: TURNSTILE_TOKEN } : validPayload(),
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

test("checked-in Wrangler config remains paused with one workers.dev target and SQLite Durable Object export", () => {
  const configText = fs.readFileSync(path.join(ROOT, "wrangler.jsonc"), "utf8");
  assert.match(configText, /"observability"\s*:\s*\{\s*"enabled"\s*:\s*false/s);
  assert.match(configText, /"RELAY_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"workers_dev"\s*:\s*true/);
  assert.match(configText, /"preview_urls"\s*:\s*false/);
  assert.match(configText, /"name"\s*:\s*"RELAY_USAGE_COUNTER"/);
  assert.match(configText, /"class_name"\s*:\s*"RelayUsageCounter"/);
  assert.match(configText, /"RelayUsageCounter"\s*:\s*\{\s*"type"\s*:\s*"durable-object"\s*,\s*"storage"\s*:\s*"sqlite"/s);
  assert.equal(/TURNSTILE_SECRET_KEY|RELAY_TICKET_SECRET/.test(configText), false);
  assert.equal(/kv_namespaces|d1_databases|r2_buckets/i.test(configText), false);
});

test("relay source contains no console logging, shared cache, or AI binding", () => {
  const sources = [
    "relay-core.js",
    "rate-limit-core.js",
    "rate-limit-counter.js",
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
