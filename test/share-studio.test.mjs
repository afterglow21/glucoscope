import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/share-studio.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const about = fs.readFileSync(new URL("../pages/about/share-studio.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

function loadModule() {
  const context = { Object, String, URL, Blob, File: class {}, setTimeout };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "share-studio.js" });
  return context.GlucoScopeShareStudio;
}

test("Share Studio normalizes only bounded display metrics", () => {
  const api = loadModule();
  assert.deepEqual({ ...api._testing.normalizeSnapshot({
    glucose: "154",
    arrow: "→",
    tir: "97.0%",
    tar: "3.0%",
    tbr: "0.0%",
    date: "2026/08/18 12:34 and too much text",
    language: "ja",
    connectionUrl: "must-not-pass"
  }) }, {
    glucose: "154",
    arrow: "→",
    tir: "97.0%",
    tar: "3.0%",
    tbr: "0.0%",
    date: "2026/08/18 12:34 and too",
    language: "ja"
  });
  assert.equal(api._testing.safeMetric("https://secret.example"), "--");
});

test("Share Studio is rollout-hidden and completes a trial only after local image creation", () => {
  assert.match(index, /id="mobileShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="mobileShareStudioButton"[\s\S]*Plus・1回体験あり/u);
  assert.match(index, /id="shareStudioAccessNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(index, /js\/share-studio\.js/u);
  assert.match(index, /接続URLや合言葉は画像にもサーバーにも送りません/u);
  assert.match(app, /reserveShareStudio[\s\S]*generateBlob[\s\S]*completeShareStudio/u);
  assert.match(app, /!completionStarted[\s\S]*releaseShareStudio/u);
  assert.match(app, /completionStarted[\s\S]*体験の完了を確認できなかったため/u);
  assert.match(app, /event\.key === "Escape"[\s\S]*closeShareStudio/u);
  assert.match(app, /shareStudioOpener\?\.focus/u);
  assert.match(app, /setInlinePlusNotice\(noticeId, messageKey, \{ focus: true \}\)/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(/u);
});

test("the free trial is separate from purchase and explains Share Studio before email verification", () => {
  assert.match(index, /id="shareStudioTrialDialog"[^>]*aria-modal="true"[^>]*hidden/u);
  assert.match(index, /この確認では料金はかかりません/u);
  assert.match(index, /クレジットカード情報は入力しません/u);
  assert.match(index, /Stripeで400円の支払いを完了した時だけ料金が発生します/u);
  assert.match(index, /id="shareStudioTrialVerifyButton"[^>]*>無料体験のためメールを確認する（課金なし）<\/button>/u);
  assert.match(index, /id="shareStudioTrialUsedContent"[^>]*hidden/u);
  assert.match(index, /id="shareStudioTrialPurchaseButton"[^>]*hidden>Plus 30日パスを見る<\/button>/u);
  assert.match(index, /href="pages\/about\/share-studio\.html"/u);
  assert.match(app, /openShareStudioTrialDialog\(event\?\.currentTarget \|\| document\.activeElement, \{ mode: "verify" \}\)/u);
  assert.match(app, /access\.reason === "plus_required"[\s\S]*openShareStudioTrialDialog\(opener, \{ mode: "used" \}\)/u);
  assert.doesNotMatch(app, /event\?\.currentTarget\?\.id === "mobileShareStudioButton"[\s\S]*openLocalProfileDialog/u);
  assert.match(app, /trialAlreadyUsed[\s\S]*plusEntitlementClient\?\.refresh[\s\S]*mode: "used"/u);
  assert.match(app, /entryContext: "share_trial"/u);
  assert.match(app, /shareStudioTrialSendCodeButton: "無料体験の確認コードを送る（課金なし）"/u);
  assert.match(app, /shareStudioTrialGuardianConfirmed: "私は保護者として、この無料体験のメール確認を管理します"/u);
  assert.match(index, /Share Studioとは？<\/span><span[^>]*>できることを見る<\/span>/u);
  assert.match(app, /shareStudioTrialProfileTitle: "Share Studioを1回無料で試す"/u);
  assert.match(app, /profileDialogCard\?\.classList\.toggle\("is-share-trial-entry", shareTrialEntry\)/u);
  for (const id of ["localProfileDisplayNameField", "usageProfileCard", "usageProfileStatus", "localProfileStatus", "localProfileActions"]) {
    assert.match(style, new RegExp(`\\.local-profile-dialog-card\\.is-share-trial-entry #${id}`, "u"), id);
  }

  const openStart = app.indexOf("const openShareStudio = (event) => {");
  const openEnd = app.indexOf('["mobileShareStudioButton", "plusAccountShareStudioButton"]', openStart);
  const openHandler = app.slice(openStart, openEnd);
  assert.doesNotMatch(openHandler, /setPlusFeatureNotice\(/u);

  assert.match(about, /今の血糖と今日のTIR・TAR・TBR/u);
  assert.match(about, /メール確認だけでは料金はかかりません/u);
  assert.match(about, /クレジットカード情報も入力しません/u);
  assert.match(about, /画像はこのブラウザの中で作ります/u);
  assert.match(about, /確認済みメールを見分ける印だけを保存します/u);
  assert.match(about, /メールアドレスそのものは、この記録に残しません/u);
  assert.doesNotMatch(about, /メールへ戻せない照合用の印/u);
  assert.match(about, /健康情報が含まれます/u);
  assert.match(about, /window\.navigator\.standalone === true[\s\S]*ios-home-screen-app/u);
  assert.match(style, /html\.ios-home-screen-app:not\(\.force-desktop-view\) \.about-detail-wrap/u);
  assert.match(about, /analytics-loader\.js/u);
});
