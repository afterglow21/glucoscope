import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAGE_PATHS = [
  "pages/trust/commercial-transactions.html",
  "pages/trust/plus-terms.html",
  "pages/trust/plus-support.html",
];

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Plus sale pages stay noindex and clearly unavailable before acceptance", () => {
  for (const relativePath of PAGE_PATHS) {
    const html = read(relativePath);
    assert.match(html, /<meta name="robots" content="noindex,nofollow">/u);
    assert.match(html, /現在、Plusは販売していません/u);
  }

  assert.match(read(PAGE_PATHS[0]), /href="mailto:support@glucoscope\.app"/u);
  assert.match(read(PAGE_PATHS[2]), /href="mailto:support@glucoscope\.app"/u);
  assert.doesNotMatch(read(PAGE_PATHS[1]), /href="mailto:/u);
  for (const relativePath of PAGE_PATHS) {
    for (const match of read(relativePath).matchAll(/href="mailto:([^"]+)"/gu)) {
      assert.equal(match[1], "support@glucoscope.app");
    }
  }

  const config = JSON.parse(read("workers/gluco-plus-entitlement/wrangler.jsonc"));
  for (const vars of [config.vars, config.env.staging.vars]) {
    assert.equal(vars.PLUS_PURCHASES_ENABLED, "false");
    assert.equal(vars.PLUS_CHECKOUT_HTTP_ENABLED, "false");
    assert.equal(vars.PLUS_STRIPE_WEBHOOK_ENABLED, "false");
    assert.equal(vars.PLUS_SALES_READINESS_CONFIRMED, "false");
    assert.equal(vars.PLUS_TAX_TREATMENT_CONFIRMED, "false");
    assert.equal(vars.PLUS_STRIPE_RECEIPT_EMAIL_CONFIRMED, "false");
    assert.equal(
      vars.PLUS_COMMERCIAL_DISCLOSURE_PATH,
      "/pages/trust/commercial-transactions.html",
    );
    assert.equal(vars.PLUS_REFUND_POLICY_PATH, "/pages/trust/plus-terms.html");
    assert.equal(vars.PLUS_SUPPORT_PATH, "/pages/trust/plus-support.html");
    assert.equal(vars.PLUS_FINAL_PRICE_DISPLAY, "total_400_confirmed");
    assert.equal(vars.PLUS_BUYER_POLICY, "adult_self_or_confirmed_guardian");
    assert.equal(vars.PLUS_TERMS_VERSION, "2026-08-18");
    assert.equal(vars.PLUS_BUYER_CONFIRMATION_VERSION, "2026-08-18");
  }
});

test("temporary Share Studio acceptance stays unlinked, noindex, synthetic, and purchase-free", () => {
  const html = read("plus-share-acceptance.html");
  assert.match(html, /name="robots" content="noindex,nofollow,noarchive"/u);
  assert.match(html, /固定の合成値/u);
  assert.match(html, /90日間残ります/u);
  assert.match(html, /glucose: "123"/u);
  assert.match(html, /reserveShareStudio/u);
  assert.match(html, /completeShareStudio/u);
  assert.match(html, /trial_already_used/u);
  assert.match(html, /hasStoredSession/u);
  assert.match(html, /メールを送り直さず/u);
  assert.match(html, /!elements\.deletePanel\.hidden && deleteWidgetId === null/u);
  assert.match(html, /plus-entitlement-client\.js\?v=20260820-share-studio-2/u);
  assert.doesNotMatch(html, /createCheckout|checkout\.stripe\.com|STRIPE_/u);
  assert.doesNotMatch(read("index.html"), /plus-share-acceptance\.html/u);
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gu)) {
    if (match[1].trim()) assert.doesNotThrow(() => new Function(match[1]));
  }
});

test("commercial disclosure contains every approved one-time sale boundary", () => {
  const html = read(PAGE_PATHS[0]);
  for (const expected of [
    "お支払い総額",
    "400円",
    "1回だけ",
    "自動更新や継続課金はありません",
    "連続30日間",
    "日本国内に居住する人",
    "18歳以上",
    "免税事業者",
    "適格請求書発行事業者ではありません",
    "請求があれば",
    "遅滞なく",
    "support@glucoscope.app",
    "5営業日以内",
    "全額返金",
    "部分返金は行わず",
    "支払確認・領収書",
    "適格請求書（インボイス）ではありません",
    "実環境で両方の自動メールが届くことを確認済みです",
  ]) assert.match(html, new RegExp(expected, "u"));

  assert.doesNotMatch(html, /400円（税込）/u);
  assert.match(html, /公開問い合わせ先の実受信は確認済み/u);
  assert.match(html, /本番の支払い・全額返金、自動メールの受信も確認済み/u);
  assert.match(html, /事業者の氏名・住所・電話番号の開示請求/u);
  assert.match(html, /優先して遅滞なく対応/u);
  assert.doesNotMatch(html, /問い合わせ受信、決済、返金/u);
  assert.doesNotMatch(html, /カード(?:決済)?だけ/u);
  assert.doesNotMatch(html, /自動更新あり|月額|サブスクリプション/u);
});

test("Plus support asks for no health, connection, password, or card secrets", () => {
  const html = read(PAGE_PATHS[2]);
  for (const forbiddenRequest of [
    "カード番号",
    "セキュリティコード",
    "パスワード",
    "合言葉",
    "API Secret",
    "血糖値の一覧",
    "インスリン量",
  ]) assert.match(html, new RegExp(forbiddenRequest, "u"));
  assert.match(html, /送らないでください/u);
  assert.match(html, /販売者情報の開示請求/u);
  assert.match(html, /この請求に購入日や購入情報は必要ありません/u);
  assert.match(html, /GlucoScopeから、これらの情報をメールで求めることはありません/u);
  assert.doesNotMatch(html, /@[A-Za-z0-9.-]+\.(?:com|net|jp|org)/u);
});

test("new Plus page local links and assets resolve", () => {
  for (const relativePath of PAGE_PATHS) {
    const html = read(relativePath);
    const directory = path.dirname(path.join(ROOT, relativePath));
    for (const match of html.matchAll(/(?:href|src)="([^"]+)"/gu)) {
      const target = match[1];
      if (/^(?:https?:|mailto:|#)/u.test(target)) continue;
      const cleanTarget = target.split(/[?#]/u)[0];
      assert.equal(
        existsSync(path.resolve(directory, cleanTarget)),
        true,
        `${relativePath} has a missing local target: ${target}`,
      );
    }
  }
});
