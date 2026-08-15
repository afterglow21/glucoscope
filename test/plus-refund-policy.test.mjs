import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const plusSpecUrl = new URL(
  "../docs/Feature_Specs/PLUS_30_DAY_PASS.md",
  import.meta.url,
);
const salesDraftUrl = new URL(
  "../docs/Feature_Specs/PLUS_SALES_DISCLOSURE_DRAFT.md",
  import.meta.url,
);
const projectBibleUrl = new URL(
  "../docs/Project_Bible/PROJECT_BIBLE_v1.0_DRAFT.md",
  import.meta.url,
);
const workerReadmeUrl = new URL(
  "../workers/gluco-plus-entitlement/README.md",
  import.meta.url,
);

test("Plus refund policy is short, conditional, and still blocked from sale", async () => {
  const [spec, salesDraft, bible, readme] = await Promise.all([
    readFile(plusSpecUrl, "utf8"),
    readFile(salesDraftUrl, "utf8"),
    readFile(projectBibleUrl, "utf8"),
    readFile(workerReadmeUrl, "utf8"),
  ]);
  const policySources = [spec, salesDraft, bible, readme].join("\n");

  assert.match(spec, /二重に支払われた時や、お支払い後もPlusを始められない時/);
  assert.match(spec, /GlucoScope側の大きな障害/);
  assert.match(spec, /Plusの主な機能をほとんど使えず/);
  assert.match(spec, /部分返金は行いません。返金したPlusは終了します/);
  assert.match(spec, /通常5〜10営業日ほどかかる場合があります/);
  assert.match(salesDraft, /Status: internal draft \/ non-public \/ not approved for sale/);
  assert.match(salesDraft, /公開問い合わせ先と返金受付手順が未定/);
  assert.match(bible, /返金方針は、細かな時間条件や長い除外一覧を作らず/);
  assert.match(bible, /公開問い合わせ先と実際の返金受付手順が[\s\S]*販売ブロッカー/);
  assert.match(readme, /public support contact and an executable refund-support procedure are[\s\S]*still unset sale blockers/);
  assert.match(spec, /`glucoscope\.app` を年間14\.20米ドルで取得し、自動更新をオフ/);
  assert.match(spec, /`auth\.glucoscope\.app` はResendで送信元認証済み/);
  assert.match(bible, /`glucoscope\.app` を年間14\.20米ドルで取得しました。自動更新はオフ/);
  assert.match(bible, /Resendでも送信ドメインが `verified`/);
  assert.match(readme, /purchased `glucoscope\.app` for USD 14\.20 per year and turned[\s\S]*automatic renewal off/);
  assert.match(readme, /send-only API key and the account-auth Secrets were used only by temporary non-public[\s\S]*closed-test Versions/);
  assert.match(readme, /official delivered test recipient; no[\s\S]*personal mailbox has been tested/);
  assert.match(readme, /restored stopped staging\s+Version[\s\S]*exposes none of the closed-test Secrets/);

  const oldImmediateWindow = new RegExp(`購入から${24}時間以内|${24}時間全額返金`, "u");
  const oldNoReasonPromise = new RegExp(
    `${["理由を", "問わず"].join("")}[^。\\n]{0,80}返金`,
    "u",
  );
  const oldThirtyDayPromise = new RegExp(
    `購入(?:した日)?から${30}日以内[^。\\n]{0,80}返金`,
    "u",
  );
  assert.doesNotMatch(policySources, oldImmediateWindow);
  assert.doesNotMatch(policySources, oldNoReasonPromise);
  assert.doesNotMatch(policySources, oldThirtyDayPromise);
});
