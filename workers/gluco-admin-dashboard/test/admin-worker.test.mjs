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
    readAdminPlusSummary: async () => ({
      available: true,
      activePlusCount: 2,
    }),
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
  assert.match(html, /1枚は「1人」ではなく「1つの端末プロフィール」です/u);
  assert.match(html, /取得: 2026\/08\/14 10:02:03 JST/u);
  assert.match(html, /href="\/">更新<\/a>/u);
  assert.match(html, /利用した日数<\/dt><dd>3日/u);
  assert.match(html, /新しいAI分析<\/dt><dd>2回/u);
  assert.match(html, /グルコの想い出<\/dt><dd>7 \/ 50/u);
  assert.match(html, /Plus利用中<\/span><strong>2<\/strong>/u);
  assert.match(html, /有効な30日パス/u);
  assert.match(html, /購入者ごとの情報、メールアドレス、Stripe ID、購入履歴は表示しません/u);
  assert.match(html, /\.refresh\{display:inline-flex;min-height:44px/u);
  assert.match(html, /class="profiles"/u);
  assert.doesNotMatch(html, /class="same-name"/u);
  assert.doesNotMatch(html, /<table/iu);
  assert.doesNotMatch(html, /<script/iu);
});

test("keeps repeated display names as separate device-profile cards and labels each occurrence", async () => {
  const duplicateNameReport = Object.freeze({
    profiles: Object.freeze([
      Object.freeze({
        displayName: "カズマ",
        collectionEnabled: true,
        activeDays: 2,
        aiGenerationSuccessTotal: 1,
        ordinaryGlucoMemoryCount: 4,
      }),
      Object.freeze({
        displayName: "あやか",
        collectionEnabled: true,
        activeDays: 3,
        aiGenerationSuccessTotal: 2,
        ordinaryGlucoMemoryCount: 5,
      }),
      Object.freeze({
        displayName: "カズマ",
        collectionEnabled: false,
        activeDays: 5,
        aiGenerationSuccessTotal: 6,
        ordinaryGlucoMemoryCount: 7,
      }),
      Object.freeze({
        displayName: "カズマ",
        collectionEnabled: true,
        activeDays: 9,
        aiGenerationSuccessTotal: 10,
        ordinaryGlucoMemoryCount: 11,
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
  assert.equal((html.match(/<article class="profile">/gu) || []).length, 4);
  assert.equal((html.match(/<h3>カズマ<\/h3>/gu) || []).length, 3);
  assert.match(html, /同じ表示名 1 \/ 3/u);
  assert.match(html, /同じ表示名 2 \/ 3/u);
  assert.match(html, /同じ表示名 3 \/ 3/u);
  assert.equal((html.match(/class="same-name"/gu) || []).length, 3);
  assert.doesNotMatch(html, /<h3>あやか<\/h3><p class="same-name">/u);
  assert.match(html, /同じ表示名が付いていても、同じ人だとは判断できません/u);
  assert.match(html, /プロフィールをまとめたり、回数を合算したりしません/u);
  assert.match(html, /接続先URLや合言葉は利用記録に保存していないため、同じ接続先かどうかもこの画面では比較できません/u);
  assert.match(html, /<h3>カズマ<\/h3><p class="same-name">同じ表示名 1 \/ 3<\/p><\/div>[\s\S]*?<dt>利用した日数<\/dt><dd>2日<\/dd>/u);
  assert.match(html, /<h3>カズマ<\/h3><p class="same-name">同じ表示名 2 \/ 3<\/p><\/div>[\s\S]*?<dt>利用した日数<\/dt><dd>5日<\/dd>/u);
  assert.match(html, /<h3>カズマ<\/h3><p class="same-name">同じ表示名 3 \/ 3<\/p><\/div>[\s\S]*?<dt>利用した日数<\/dt><dd>9日<\/dd>/u);
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
  assert.match(html, /まだ端末プロフィールはありません。登録が完了するとここに表示されます。/u);
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
  const [workerSource, storeSource, plusSource] = await Promise.all([
    readFile(new URL("../src/index.js", import.meta.url), "utf8"),
    readFile(new URL("../src/admin-store.js", import.meta.url), "utf8"),
    readFile(new URL("../src/plus-summary.js", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(workerSource, /\bconsole\s*\./u);
  assert.doesNotMatch(storeSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/u);
  assert.doesNotMatch(plusSource, /\bconsole\s*\./u);
  assert.doesNotMatch(plusSource, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|ATTACH|PRAGMA)\b/u);
  assert.doesNotMatch(storeSource, /\.run\s*\(|\.batch\s*\(/u);
  assert.equal((storeSource.match(/\.prepare\s*\(/gu) || []).length, 1);
});
