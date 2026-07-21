import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const guideCss = await readFile(new URL("../guides/guide.css", import.meta.url), "utf8");
const glurooGuide = await readFile(new URL("../guides/gluroo-setup/index.html", import.meta.url), "utf8");
const dexcomGuide = await readFile(new URL("../guides/dexcom-share/index.html", import.meta.url), "utf8");
const libreGuide = await readFile(new URL("../guides/librelinkup/index.html", import.meta.url), "utf8");
const nightscoutGuide = await readFile(new URL("../guides/nightscout-about/index.html", import.meta.url), "utf8");

test("user onboarding says only one numbered connection method is needed", () => {
  assert.match(index, /どちらか1つ選びます/);
  assert.doesNotMatch(index, /1．血糖データのつなぎ方/);
  assert.match(index, /方法①/);
  assert.match(index, /方法②/);
  assert.match(index, /dataSourceGlurooChoice/);
  assert.match(index, /dataSourceNightscoutChoice/);
});

test("route cards advance directly without a separate choose button", () => {
  assert.doesNotMatch(index, /dataSourceChooseButton/);
  assert.doesNotMatch(index, /選んだ方法で進む/);
  assert.match(app, /selectDataSourceProvider\("gluroo"\)/);
  assert.match(app, /selectDataSourceProvider\("nightscout"\)/);
});

test("Gluroo preparation is a separate step before credential entry", () => {
  assert.match(index, /dataSourceGlurooPrepPanel/);
  assert.match(index, /画像を見ながらGlurooを準備する/);
  assert.match(index, /Glurooの準備ができたので、接続へ進む/);
  const connectStart = index.indexOf('id="dataSourceConnectPanel"');
  const connectEnd = index.indexOf("</form>", connectStart);
  const connectPanel = index.slice(connectStart, connectEnd);
  assert.doesNotMatch(connectPanel, /画像を見ながらGlurooを準備する/);
});

test("Gluroo beginner route is scoped to Libre 2 and Dexcom G7", () => {
  assert.match(index, /FreeStyle Libre 2またはDexcom G7/);
  assert.match(glurooGuide, /FreeStyle Libre 2/);
  assert.match(glurooGuide, /Dexcom G7/);
});

test("Guardian is honestly separated as an advanced route", () => {
  assert.match(index, /Guardian／MiniMed 780G/);
  assert.match(index, /Guardianは現在のかんたん接続では利用できません/);
  assert.match(glurooGuide, /Guardianは現在のかんたん接続では利用できません/);
  assert.match(nightscoutGuide, /Guardian／MiniMed 780Gからつなぐ例/);
  assert.match(nightscoutGuide, /Guardian Monitor/);
});

test("Nightscout wording identifies what the person already uses", () => {
  assert.match(index, /自分のNightscout環境をすでに使っている方/);
  assert.doesNotMatch(index, /すでに使っている方・/);
});

test("public Guardian example uses the lowercase kazuma name", () => {
  assert.match(index, /kazumaのGuardian接続例を見る/);
  assert.match(nightscoutGuide, /参考：kazumaの現在の構成/);
  assert.doesNotMatch(index, /カズマ/);
  assert.doesNotMatch(nightscoutGuide, /カズマ/);
});

test("local-only notice separates the server and shared-device messages", () => {
  assert.match(index, /dataSourceLocalOnlyLine1/);
  assert.match(index, /dataSourceLocalOnlyLine2/);
  assert.match(app, /GlucoScopeのサーバーには保存しません/);
  assert.match(app, /共用している端末/);
});

test("Gluroo guide starts at App Store and uses the correct animal", () => {
  assert.match(glurooGuide, /App StoreからGlurooを入れる/);
  assert.match(glurooGuide, /カンガルーの絵/);
  assert.doesNotMatch(glurooGuide, /鹿の絵/);
  assert.match(glurooGuide, /あとから決めたい項目は、今は入力しなくて大丈夫です/);
});

test("Gluroo guide no longer links to GotCGM", () => {
  assert.doesNotMatch(glurooGuide, /GotCGM/i);
  assert.doesNotMatch(glurooGuide, /announcing-gotcgm/i);
});

test("guide screenshots avoid fixed-position overlays that can drift", () => {
  assert.doesNotMatch(glurooGuide, /guide-focus-box/);
  assert.doesNotMatch(glurooGuide, /guide-down-arrow/);
  assert.doesNotMatch(guideCss, /\.guide-focus-box/);
  assert.doesNotMatch(guideCss, /\.guide-down-arrow/);
  assert.match(glurooGuide, /guide-step-number/);
  assert.match(glurooGuide, /figcaption/);
});

test("Dexcom Share preparation guide explains account identity and password reset", () => {
  assert.match(glurooGuide, /guides\/dexcom-share|\.\.\/dexcom-share/);
  assert.match(dexcomGuide, /Shareをオン/);
  assert.match(dexcomGuide, /本人側（Sharer）/);
  assert.match(dexcomGuide, /プロフィール → アカウント/);
  assert.match(dexcomGuide, /再設定/);
  assert.match(dexcomGuide, /GlucoScopeへDexcomのパスワードを入力することはありません/);
});

test("LibreLinkUp preparation guide explains invitation and credentials", () => {
  assert.match(glurooGuide, /\.\.\/librelinkup/);
  assert.match(libreGuide, /接続するアプリ/);
  assert.match(libreGuide, /LibreLinkUpアプリに自分の血糖値が表示/);
  assert.match(libreGuide, /LibreLinkUpへ登録したメールアドレス/);
  assert.match(libreGuide, /再設定/);
  assert.match(libreGuide, /GlucoScopeへLibreLinkUpのパスワードを入力することはありません/);
});

test("guide has connection-screen return links at the end", () => {
  const matches = glurooGuide.match(/GlucoScopeの接続画面へ戻る/g) || [];
  assert.ok(matches.length >= 2);
  assert.match(glurooGuide, /source=gluroo/);
  assert.match(nightscoutGuide, /source=nightscout/);
});

test("Nightscout page separates data flow from supporting infrastructure", () => {
  assert.match(nightscoutGuide, /Azure App Service/);
  assert.match(nightscoutGuide, /MongoDB Atlas/);
  assert.match(nightscoutGuide, /GitHub Pages/);
  assert.match(nightscoutGuide, /Cloudflare Worker/);
  assert.match(nightscoutGuide, /Cloudflare Pages/);
  assert.match(nightscoutGuide, /Stripe/);
  assert.match(nightscoutGuide, /血糖データは送らない/);
});

test("technical error names are not shown in Japanese user copy", () => {
  const japaneseBlock = app.slice(app.indexOf("ja: {"), app.indexOf("en: {"));
  assert.doesNotMatch(japaneseBlock, /CORS/);
  assert.doesNotMatch(japaneseBlock, /localStorage|sessionStorage/);
});

test("guide pages do not load analytics", () => {
  for (const html of [glurooGuide, dexcomGuide, libreGuide, nightscoutGuide]) {
    assert.doesNotMatch(html, /static\.cloudflareinsights\.com/i);
  }
});

test("guide HTML does not contain real credential strings", () => {
  for (const html of [glurooGuide, dexcomGuide, libreGuide, nightscoutGuide]) {
    assert.doesNotMatch(html, /api-secret=[A-Za-z0-9]/i);
    assert.doesNotMatch(html, /token=[A-Za-z0-9]/i);
  }
});


test("verified connection can start user mode from the onboarding button", () => {
  assert.match(
    app,
    /dataSourceSaveButton"\)\?\.addEventListener\("click", handleDataSourceSave\)/
  );

  const saveHandlerStart = app.indexOf("function handleDataSourceSave");
  const saveHandlerEnd = app.indexOf("function handleDataSourceDelete", saveHandlerStart);
  const saveHandler = app.slice(saveHandlerStart, saveHandlerEnd);

  assert.match(saveHandler, /if \(isUserDataSourceMode\(\)\) \{[\s\S]*window\.location\.reload\(\)/);
  assert.match(saveHandler, /window\.location\.href = buildUserModeUrl\("glucose"\)/);
});

test("disabled AI analysis explains the actual local or user-foundation state", () => {
  assert.match(app, /aiLetterButtonLocalDisabled: "ローカル確認ではAI分析は停止中"/);
  assert.match(app, /aiLetterButtonUserFoundation: "ユーザー版AI分析は準備中"/);

  const controlsStart = app.indexOf("function updateAiLetterControls");
  const controlsEnd = app.indexOf("function forceEnableAiLetterButtonSoon", controlsStart);
  const controls = app.slice(controlsStart, controlsEnd);

  assert.match(controls, /else if \(!workerEnabled\)/);
  assert.match(controls, /isUserDataSourceMode\(\)[\s\S]*aiLetterButtonUserFoundation[\s\S]*aiLetterButtonLocalDisabled/);
});

test("connection deletion confirmation remains visible before reload", () => {
  const deleteStart = app.indexOf("function handleDataSourceDelete");
  const deleteEnd = app.indexOf("function showDataSourceSetupRequiredState", deleteStart);
  const deleteHandler = app.slice(deleteStart, deleteEnd);

  assert.match(deleteHandler, /setDataSourceTestStatus\(t\("dataSourceDeleted"\), "success"\)/);
  assert.match(deleteHandler, /window\.setTimeout\(\(\) => window\.location\.reload\(\), 1500\)/);
});

test("current cache and CSS markers are present", () => {
  assert.match(index, /20260721-user-foundation-3-4/);
  assert.match(guideCss, /User Foundation 0\.3\.1/);
  assert.match(css, /User Foundation 0\.3/);
});
