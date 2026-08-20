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

test("Share Studio creates and stores four slides before completing a trial", () => {
  assert.match(index, /id="mobileShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioButton"[^>]*hidden/u);
  assert.match(index, /id="mobileShareStudioButton"[\s\S]*Plus・1回体験あり/u);
  assert.match(index, /id="shareStudioAccessNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(index, /id="plusAccountShareStudioNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(index, /js\/share-studio\.js/u);
  assert.match(index, /今日出逢ったグルコ、血糖グラフ、やさしいふりかえり/u);
  assert.match(index, /id="shareStudioPreviewGrid"/u);
  assert.match(index, /id="shareStudioHealthConfirm"/u);
  assert.match(index, /接続URLや合言葉は画像にもサーバーにも送りません/u);
  assert.match(app, /reserveShareStudio[\s\S]*generateCarousel[\s\S]*saveCarousel[\s\S]*completeShareStudio/u);
  assert.match(app, /!completionStarted[\s\S]*releaseShareStudio/u);
  assert.match(app, /completionStarted[\s\S]*4枚はこの端末に保存済みです/u);
  assert.match(app, /loadCarousel[\s\S]*保存済みの4枚を再表示しました/u);
  assert.match(app, /deleteCarousel/u);
  assert.match(app, /getStoredTodayUnicornDecision[\s\S]*getStoredDailyGlucoDecision/u);
  assert.match(app, /event\.key === "Escape"[\s\S]*closeShareStudio/u);
  assert.match(app, /shareStudioOpener\?\.focus/u);
  assert.match(app, /setInlinePlusNotice\(noticeId, messageKey, \{ focus: true \}\)/u);
  assert.match(source, /generateCarousel/u);
  assert.match(source, /indexedDB/u);
  assert.match(source, /record\.blobs\.length === 4/u);
  assert.doesNotMatch(source, /localStorage|sessionStorage|fetch\(/u);
});

test("Share Studio keeps a verified four-slide carousel in device storage", async () => {
  const api = loadModule();
  let saved = null;
  const store = {
    put(record) {
      saved = record;
      return record;
    },
    get() {
      return saved;
    },
    delete() {
      saved = null;
      return undefined;
    }
  };
  const blobs = Array.from({ length: 4 }, () => new Blob(["png"], { type: "image/png" }));
  const record = await api.saveCarousel(blobs, { dateKey: "2026-08-21", glucoId: 7 }, { store });
  assert.equal(record.blobs.length, 4);
  assert.equal(record.dateKey, "2026-08-21");
  assert.equal(record.glucoId, 7);
  assert.equal((await api.loadCarousel({ store })).blobs.length, 4);
  await api.deleteCarousel({ store });
  assert.equal(await api.loadCarousel({ store }), null);
});

test("Share Studio accepts only an exact local Gluco asset and bounded glucose entries", () => {
  const api = loadModule();
  const model = api._testing.normalizeCarouselModel({
    dateKey: "2026-08-21",
    dateLabel: "2026年8月21日",
    language: "ja",
    metrics: { tir: 90, tar: 8, tbr: 2, glucoScore: 88 },
    entries: [{ date: 1, sgv: 100 }, { date: 2, sgv: 120 }],
    gluco: { id: 7, title: "おすわり", imagePath: "assets/gluco/live/gluco-live-07.png" },
    connectionUrl: "https://must-not-pass.example"
  });
  assert.equal(model.gluco.id, 7);
  assert.equal(model.gluco.imagePath, "assets/gluco/live/gluco-live-07.png");
  assert.equal(model.entries.length, 2);
  assert.throws(() => api._testing.normalizeCarouselModel({
    entries: [{ date: 1, sgv: 100 }],
    gluco: { imagePath: "https://secret.example/gluco.png" }
  }), /daily_gluco_unavailable/u);
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
  assert.match(app, /const opener = event\?\.currentTarget \|\| document\.activeElement[\s\S]*openShareStudioTrialDialog\(opener, \{ mode: "verify" \}\)/u);
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

  const openStart = app.indexOf("const openShareStudio = async (event) => {");
  const openEnd = app.indexOf('["mobileShareStudioButton", "plusAccountShareStudioButton"]', openStart);
  const openHandler = app.slice(openStart, openEnd);
  assert.doesNotMatch(openHandler, /setPlusFeatureNotice\(/u);

  assert.match(about, /4枚のカルーセル/u);
  assert.match(about, /その日にGlucoScopeで実際に出逢ったグルコ/u);
  assert.match(about, /画面を閉じても、保存済みの4枚/u);
  assert.match(about, /メール確認だけでは料金はかかりません/u);
  assert.match(about, /クレジットカード情報も入力しません/u);
  assert.match(about, /4枚はこのブラウザの中で作り/u);
  assert.match(about, /確認済みメールを見分ける印だけを保存します/u);
  assert.match(about, /メールアドレスそのものは、この記録に残しません/u);
  assert.doesNotMatch(about, /メールへ戻せない照合用の印/u);
  assert.match(about, /健康情報が含まれます/u);
  assert.match(about, /window\.navigator\.standalone === true[\s\S]*ios-home-screen-app/u);
  assert.match(style, /html\.ios-home-screen-app:not\(\.force-desktop-view\) \.about-detail-wrap/u);
  assert.match(about, /analytics-loader\.js/u);
});
