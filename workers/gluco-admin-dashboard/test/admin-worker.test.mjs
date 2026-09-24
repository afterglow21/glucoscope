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
    lastSeenAt: Date.parse("2026-08-13T15:01:02.000Z"),
  })]),
  truncated: false,
});

function acceptedServices(overrides = {}) {
  return {
    verifyAccess: async () => ({ authenticated: true }),
    readAdminUsage: async () => report,
    readAdminPlusSummary: async () => ({
      available: true,
      activePlusCount: 2,
    }),
    readInternalProfileDisplayNames: () => ["運営A", "運営B"],
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
  assert.match(html, /外部利用と内部テストを分けて表示します/u);
  assert.match(html, /取得: 2026\/08\/14 10:02:03 JST/u);
  assert.match(html, /href="\/">更新<\/a>/u);
  assert.match(html, /利用した日数<\/dt><dd>3日/u);
  assert.match(html, /最終利用日<\/dt><dd>2026年8月14日/u);
  assert.match(html, /新しいAI分析<\/dt><dd>2回/u);
  assert.match(html, /グルコの想い出<\/dt><dd>7 \/ 50/u);
  assert.match(html, /Plus利用中<\/span><strong>2<\/strong>/u);
  assert.match(html, /有効な30日パス（内外の紐付けなし）/u);
  assert.match(html, /購入者ごとの情報、メールアドレス、Stripe ID、購入履歴は表示しません/u);
  assert.match(html, /最終利用日は時刻を表示せず、日本時間の日付だけ/u);
  assert.match(html, /\.refresh\{display:inline-flex;min-height:44px/u);
  assert.match(html, /外部の表示名/u);
  assert.match(html, /外部の端末プロフィール/u);
  assert.match(html, /class="groups"/u);
  assert.match(html, /class="profile-group external-group"/u);
  assert.doesNotMatch(html, /<table/iu);
  assert.doesNotMatch(html, /<script/iu);
});

test("separates internal use and collapses repeated names without summing profile counts", async () => {
  const duplicateNameReport = Object.freeze({
    profiles: Object.freeze([
      Object.freeze({
        displayName: "運営A",
        collectionEnabled: true,
        activeDays: 2,
        aiGenerationSuccessTotal: 1,
        ordinaryGlucoMemoryCount: 4,
      }),
      Object.freeze({
        displayName: "運営B",
        collectionEnabled: true,
        activeDays: 3,
        aiGenerationSuccessTotal: 2,
        ordinaryGlucoMemoryCount: 5,
      }),
      Object.freeze({
        displayName: "運営A",
        collectionEnabled: false,
        activeDays: 5,
        aiGenerationSuccessTotal: 6,
        ordinaryGlucoMemoryCount: 7,
      }),
      Object.freeze({
        displayName: "利用者A",
        collectionEnabled: true,
        activeDays: 9,
        aiGenerationSuccessTotal: 10,
        ordinaryGlucoMemoryCount: 11,
      }),
      Object.freeze({
        displayName: "利用者B",
        collectionEnabled: true,
        activeDays: 1,
        aiGenerationSuccessTotal: 0,
        ordinaryGlucoMemoryCount: 1,
      }),
    ]),
    truncated: false,
  });
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({ readAdminUsage: async () => duplicateNameReport }),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.equal((html.match(/class="profile-group /gu) || []).length, 4);
  assert.equal((html.match(/class="internal-label"/gu) || []).length, 2);
  assert.match(html, /外部の表示名<\/span><strong>2<\/strong>/u);
  assert.match(html, /外部の端末プロフィール<\/span><strong>2<\/strong>/u);
  assert.match(html, /内部・テスト<\/span><strong>2<\/strong><small class="metric-note">端末 3件/u);
  assert.match(html, /<h4>運営A<\/h4>[\s\S]*?2件の端末プロフィールの内訳/u);
  assert.match(html, /端末プロフィール 1 \/ 2/u);
  assert.match(html, /端末プロフィール 2 \/ 2/u);
  assert.match(html, /<h4>利用者A<\/h4>/u);
  assert.match(html, /<h4>利用者B<\/h4>/u);
  assert.match(html, /利用した日数<\/dt><dd>2日<\/dd>[\s\S]*?利用した日数<\/dt><dd>5日<\/dd>/u);
  assert.doesNotMatch(html, /利用した日数<\/dt><dd>7日<\/dd>/u);
  assert.match(html, /人数だとは断定せず、回数も合算しません/u);
});

test("fails closed before reading data when internal-name configuration is invalid", async () => {
  let databaseRead = false;
  let plusRead = false;
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({
      readInternalProfileDisplayNames: () => { throw new TypeError("invalid configuration"); },
      readAdminUsage: async () => { databaseRead = true; },
      readAdminPlusSummary: async () => { plusRead = true; },
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(databaseRead, false);
  assert.equal(plusRead, false);
  assert.match(await response.text(), /利用状況を読み込めません/u);
});

test("authentication failure is fail-closed and never reads D1", async () => {
  let databaseRead = false;
  let plusRead = false;
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({
      verifyAccess: async () => { throw new AdminAccessError(); },
      readAdminUsage: async () => { databaseRead = true; },
      readAdminPlusSummary: async () => { plusRead = true; },
    }),
  );
  assert.equal(response.status, 403);
  assert.equal(databaseRead, false);
  assert.equal(plusRead, false);
  assert.match(response.headers.get("cache-control"), /no-store/u);
});

test("shows Plus as unavailable instead of fabricating a zero", async () => {
  const withoutBinding = acceptedServices();
  delete withoutBinding.readAdminPlusSummary;
  const response = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    withoutBinding,
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Plus利用中<\/span><strong>--<\/strong>/u);
  assert.match(html, /確認できません/u);
  assert.doesNotMatch(html, /Plus利用中<\/span><strong>0<\/strong>/u);

  const failedResponse = await handleAdminRequest(
    new Request("https://admin.example.test/"),
    {},
    acceptedServices({
      readAdminPlusSummary: async () => { throw new Error("service unavailable"); },
    }),
  );
  const failedHtml = await failedResponse.text();
  assert.equal(failedResponse.status, 200);
  assert.match(failedHtml, /Plus利用中<\/span><strong>--<\/strong>/u);
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
  assert.match(html, /まだ外部利用の端末プロフィールはありません。/u);
  assert.match(html, /内部・テスト利用として登録された端末プロフィールはありません。/u);
});

test("supports HEAD without reading D1 and rejects query strings and write methods", async () => {
  let queryPlusRead = false;
  const queryResponse = await handleAdminRequest(
    new Request("https://admin.example.test/?profile=anything"),
    {},
    acceptedServices({ readAdminPlusSummary: async () => { queryPlusRead = true; } }),
  );
  assert.equal(queryResponse.status, 404);
  assert.equal(queryPlusRead, false);

  let headRead = false;
  let headPlusRead = false;
  const headResponse = await handleAdminRequest(
    new Request("https://admin.example.test/", { method: "HEAD" }),
    {},
    acceptedServices({
      readAdminUsage: async () => { headRead = true; },
      readAdminPlusSummary: async () => { headPlusRead = true; },
    }),
  );
  assert.equal(headResponse.status, 200);
  assert.equal(headRead, false);
  assert.equal(headPlusRead, false);
  assert.equal(await headResponse.text(), "");
  assert.match(headResponse.headers.get("cache-control"), /no-store/u);

  let postPlusRead = false;
  const postResponse = await handleAdminRequest(
    new Request("https://admin.example.test/", { method: "POST" }),
    {},
    acceptedServices({ readAdminPlusSummary: async () => { postPlusRead = true; } }),
  );
  assert.equal(postResponse.status, 405);
  assert.equal(postPlusRead, false);
  assert.equal(postResponse.headers.get("allow"), "GET, HEAD");
});

test("source contains no application logging or write SQL", async () => {
  const [workerSource, storeSource, profileGroupsSource, plusSource] = await Promise.all([
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin-store.js", import.meta.url), "utf8"),
    readFile(new URL("../src/profile-groups.js", import.meta.url), "utf8"),
    readFile(new URL("../src/plus-summary.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(workerSource, /\bconsole\s*\./u);
  assert.doesNotMatch(storeSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/u);
  assert.doesNotMatch(profileGroupsSource, /\bconsole\s*\./u);
  assert.doesNotMatch(profileGroupsSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/u);
  assert.doesNotMatch(plusSource, /\bconsole\s*\./u);
  assert.doesNotMatch(plusSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/u);
  assert.doesNotMatch(storeSource, /\.run\s*\(|\.batch\s*\(/u);
  assert.equal((storeSource.match(/\.prepare\s*\(/gu) || []).length, 1);
});
