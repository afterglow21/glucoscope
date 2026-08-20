import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNBOOK_PATH = "docs/Operations/PLUS_REFUND_SUPPORT_RUNBOOK.md";

function read(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("refund support runbook keeps intake minimal and never asks for sensitive data", () => {
  const runbook = read(RUNBOOK_PATH);

  assert.match(runbook, /support@glucoscope\.app/u);
  assert.match(runbook, /平日/u);
  assert.match(runbook, /5営業日以内/u);
  assert.match(runbook, /購入に使ったメールアドレスから送る/u);
  assert.match(runbook, /販売者情報の開示請求/u);
  assert.match(runbook, /購入の申込み前に十分確認できるよう優先して遅滞なく対応/u);
  assert.match(runbook, /購入メール、購入日、本人確認書類、カード情報は求めない/u);
  assert.match(runbook, /おおよその購入日/u);
  assert.match(runbook, /一般的なエラー文/u);
  assert.match(runbook, /次の情報は送らないよう明記する。/u);
  for (const forbidden of [
    "カード番号",
    "セキュリティコード",
    "パスワード",
    "Nightscout・GlurooのURL",
    "血糖値の一覧",
    "インスリン量",
    "子どもの氏名",
  ]) assert.match(runbook, new RegExp(forbidden, "u"));
  assert.match(runbook, /カード情報や本人確認書類を求めない/u);
});

test("refund support runbook defines correction, full refund, dispute, and status boundaries", () => {
  const runbook = read(RUNBOOK_PATH);

  assert.match(runbook, /まず訂正する/u);
  assert.match(runbook, /全額返金する/u);
  assert.match(runbook, /部分返金は行わない/u);
  assert.match(runbook, /異議申立てがopenの場合は、通常の返金を同時に行わず/u);
  assert.match(runbook, /必ず全額を選ぶ/u);
  assert.match(runbook, /`pending`や`failed`を`成功`と案内しない/u);
  assert.match(runbook, /通常5〜10営業日/u);
  assert.match(runbook, /D1を直接編集/u);
});

test("refund runbook requires verified webhooks and keeps the sale stopped", () => {
  const runbook = read(RUNBOOK_PATH);
  const config = JSON.parse(read("workers/gluco-plus-entitlement/wrangler.jsonc"));

  for (const event of ["refund.created", "refund.updated", "charge.refunded"]) {
    assert.match(runbook, new RegExp(event.replace(".", "\\."), "u"));
  }
  assert.match(runbook, /Stripe署名を検証したWebhookだけ/u);
  assert.match(runbook, /Stripe test mode/u);
  assert.match(runbook, /取引または最終返金から7年保持する/u);
  assert.match(runbook, /解決後180日を目安に削除する/u);

  for (const vars of [config.vars, config.env.staging.vars]) {
    assert.equal(vars.PLUS_PURCHASES_ENABLED, "false");
    assert.equal(vars.PLUS_CHECKOUT_HTTP_ENABLED, "false");
    assert.equal(vars.PLUS_STRIPE_WEBHOOK_ENABLED, "false");
    assert.equal(vars.PLUS_SALES_READINESS_CONFIRMED, "false");
    assert.equal(vars.PLUS_TAX_TREATMENT_CONFIRMED, "false");
    assert.equal(vars.PLUS_REFUND_POLICY_PATH, "/pages/trust/plus-terms.html");
    assert.equal(vars.PLUS_SUPPORT_PATH, "/pages/trust/plus-support.html");
  }
});

test("refund runbook links resolve locally", () => {
  const runbook = read(RUNBOOK_PATH);
  const directory = path.dirname(path.join(ROOT, RUNBOOK_PATH));

  for (const match of runbook.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
    const target = match[1];
    if (/^https:/u.test(target)) continue;
    assert.equal(existsSync(path.resolve(directory, target)), true, `missing ${target}`);
  }
});
