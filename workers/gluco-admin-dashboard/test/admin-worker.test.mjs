import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { AdminAccessError } from "../src/access-auth.js";
import { handleAdminRequest } from "../src/index.js";

const report = Object.freeze({
  profiles: Object.freeze([Object.freeze({
    displayName: "<グルコ & ともだち>",
    collectionEnabled: true,
    activeDays: 3,
    aiGenerationSuccessTotal: 2,
    ordinaryGlucoMemoryCount: 7,
  })]),
  truncated: false,
});

function acceptedServices(overrides = {}) {
  return {
    verifyAccess: async () => ({ authenticated: true }),
    readAdminUsage: async () => report,
    ...overrides,
  };
}

test("server-renders the allowlisted dashboard with no-store security headers", async () => {
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({ now: () => Date.UTC(2026, 7, 14, 1, 2, 3) }),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/u);
  assert.match(response.headers.get("content-security-policy"), /script-src 'none'/u);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
  assert.match(html, /利用者の利用状況/u);
  assert.match(html, /&lt;グルコ &amp; ともだち&gt;/u);
  assert.match(html, /1行は「1人」ではなく「1つの端末プロフィール」です/u);
  assert.match(html, /取得: 2026\/08\/14 10:02:03 JST/u);
  assert.match(html, /href="\/">更新<\/a>/u);
  assert.match(html, /利用した日数<\/dt><dd>3日/u);
  assert.match(html, /新しいAI分析<\/dt><dd>2回/u);
  assert.match(html, /グルコの想い出<\/dt><dd>7 \/ 50/u);
  assert.match(html, /\.refresh\{display:inline-flex;min-height:44px/u);
  assert.match(html, /class="profiles"/u);
  assert.doesNotMatch(html, /<table/iu);
  assert.doesNotMatch(html, /<script/iu);
});

test("authentication failure is fail-closed and never reads D1", async () => {
  let databaseRead = false;
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({
      verifyAccess: async () => { throw new AdminAccessError(); },
      readAdminUsage: async () => { databaseRead = true; },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(databaseRead, false);
  assert.match(response.headers.get("cache-control"), /no-store/u);
});

test("shows the approved empty-state wording", async () => {
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({
      readAdminUsage: async () => ({ profiles: [], truncated: false }),
    }),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /まだ端末プロフィールはありません。登録が完了するとここに表示されます。/u);
});

test("supports HEAD without reading D1 and rejects query strings and write methods", async () => {
  const queryResponse = await handleAdminRequest(
    new Request("https://admin.example.test/?profile=anything"),
    {},
    acceptedServices(),
  );
  assert.equal(queryResponse.status, 404);

  let headRead = false;
  const headResponse = await handleAdminRequest(
    new Request("https://admin.example.test/", { method: "HEAD" }),
    {},
    acceptedServices({ readAdminUsage: async () => { headRead = true; } }),
  );
  assert.equal(headResponse.status, 200);
  assert.equal(headRead, false);
  assert.equal(await headResponse.text(), "");
  assert.match(headResponse.headers.get("cache-control"), /no-store/u);

  const postResponse = await handleAdminRequest(
    new Request("https://admin.example.test/", { method: "POST" }),
    {},
    acceptedServices(),
  );
  assert.equal(postResponse.status, 405);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
});

test("source contains no application logging or write SQL", async () => {
  const [workerSource, storeSource] = await Promise.all([
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin-store.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(workerSource, /\bconsole\s*\./u);
  assert.doesNotMatch(storeSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/u);
  assert.doesNotMatch(storeSource, /\.run\s*\(|\.batch\s*\(/u);
  assert.equal((storeSource.match(/\.prepare\s*\(/gu) || []).length, 1);
});
