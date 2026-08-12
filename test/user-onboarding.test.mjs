import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { access } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const userEntry = await readFile(new URL("../user.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const localProfile = await readFile(new URL("../js/local-profile.js", import.meta.url), "utf8");
const relayClient = await readFile(new URL("../js/data-relay-client.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const guideCss = await readFile(new URL("../guides/guide.css", import.meta.url), "utf8");
const glurooGuide = await readFile(new URL("../guides/gluroo-setup/index.html", import.meta.url), "utf8");
const dexcomGuide = await readFile(new URL("../guides/dexcom-share/index.html", import.meta.url), "utf8");
const libreGuide = await readFile(new URL("../guides/librelinkup/index.html", import.meta.url), "utf8");
const nightscoutGuide = await readFile(new URL("../guides/nightscout-about/index.html", import.meta.url), "utf8");
const guardianGuide = await readFile(new URL("../guides/guardian-monitor/index.html", import.meta.url), "utf8");

// Existing user-foundation coverage.
test("public data connection remains clickable and clearly marked as early access", () => {
  assert.match(index, /データ接続（先行体験）/);
  assert.match(index, /Gluroo接続は少人数で確認しながら提供しています/);
  assert.match(index, /js\/app\.js\?v=20260812-early-access-1/);
  assert.match(app, /dataSourceButtonDemo: "データ接続（先行体験）"/);
  assert.match(app, /dataSourceDialogTitle: "Data connection \(early access\)"/);
  assert.doesNotMatch(index, /id="dataSourceButton"[^>]+disabled/);
});

test("Gluroo and Nightscout share one required display-name field in the connection form", () => {
  const formStart = index.indexOf('id="dataSourceForm"');
  const formEnd = index.indexOf("</form>", formStart);
  const form = index.slice(formStart, formEnd);
  const displayNameInput = form.match(/<input id="dataSourceDisplayName"[^>]*>/)?.[0] || "";

  assert.equal((form.match(/id="dataSourceDisplayName"/g) || []).length, 1);
  assert.match(displayNameInput, /autocomplete="nickname"/);
  assert.match(displayNameInput, /\brequired\b/);
  assert.doesNotMatch(displayNameInput, /maxlength=/);
  assert.ok(form.indexOf('id="dataSourceDisplayName"') < form.indexOf('id="dataSourceUrl"'));
  assert.match(app, /queueDataSourceFocus\(document\.getElementById\("dataSourceDisplayName"\)\)/);
  assert.match(form, /本名でなくて大丈夫です/);
  assert.match(form, /id="dataSourceUsageNoteText"[^>]*data-i18n-key="dataSourceUsageNote"/);
  assert.match(form, /data-i18n-key="dataSourceUsageDetails"/);
  assert.match(index, /id="dataSourceGlurooChoice"/);
  assert.match(index, /id="dataSourceNightscoutChoice"/);
});

test("local profile is a compact display-name and registered-record management screen", () => {
  assert.match(index, /id="localProfileDialog"/);
  assert.match(index, /id="localProfileButton"/);
  assert.match(index, /id="mobileLocalProfileButton"/);
  assert.match(index, /GlucoScopeで使う表示名を変更できます/);
  assert.doesNotMatch(index, /表示名（任意）/);
  assert.match(index, /本名でなくて大丈夫です/);

  const profileStart = index.indexOf('id="localProfileDialog"');
  const profileEnd = index.indexOf('<div class="dashboard">', profileStart);
  const profileDialog = index.slice(profileStart, profileEnd);
  assert.doesNotMatch(profileDialog, /id="localProfileDeleteButton"/);
  assert.doesNotMatch(profileDialog, /dataSourceRelayConsent/);
  assert.doesNotMatch(profileDialog, /type="radio"|localProfileUsageSharingPreference|localProfilePreference/);
  assert.doesNotMatch(profileDialog, /usageProfileNotice|usageProfileStartButton|usageProfileSkipButton|この端末の利用状況を共有する|今はしない/);
  assert.match(profileDialog, /id="usageProfileCard"[^>]*hidden/);
  assert.match(profileDialog, /利用記録の管理/);
  assert.match(profileDialog, /autocomplete="nickname"/);
  assert.doesNotMatch(profileDialog, /id="localProfileDisplayName"[^>]+maxlength=/);
  assert.match(profileDialog, /role="status" aria-live="polite"/);

  const jaProfileCopyStart = app.indexOf('localProfileButton: "あなたの設定"');
  const jaProfileCopyEnd = app.indexOf("dataSourceDialogTitle:", jaProfileCopyStart);
  const enProfileCopyStart = app.indexOf('localProfileButton: "Your settings"');
  const enProfileCopyEnd = app.indexOf("dataSourceDialogTitle:", enProfileCopyStart);
  const profileTranslations = `${app.slice(jaProfileCopyStart, jaProfileCopyEnd)}\n${app.slice(enProfileCopyStart, enProfileCopyEnd)}`;
  assert.doesNotMatch(profileTranslations, /localProfilePreference|UsageSharing|利用分析|協力して|同意|willing|unwilling|undecided|usage analytics|consent/i);
});

test("local profile controls stay local, fail closed, and preserve accessible dialog behavior", () => {
  assert.match(index, /js\/local-profile\.js\?v=20260811-usage-profile-stage-1/);
  assert.match(localProfile, /glucoscope\.localProfile\.v1/);
  assert.doesNotMatch(localProfile, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/);
  assert.doesNotMatch(localProfile, /visitorSeed|dataSourceRelayConsent|futureUsage|UsageSharing|willing|unwilling|undecided|consent/i);

  const populateStart = app.indexOf("function populateLocalProfileForm");
  const populateEnd = app.indexOf("function getLocalProfileDialogFocusableElements", populateStart);
  const populateHandler = app.slice(populateStart, populateEnd);
  const saveStart = app.indexOf("function handleLocalProfileSave");
  const saveEnd = app.indexOf("function setupLocalProfileFoundation", saveStart);
  const saveHandler = app.slice(saveStart, saveEnd);
  assert.match(saveHandler, /localProfileManager\.normalizeDisplayName\(/);
  assert.match(saveHandler, /if \(!displayName\) \{[\s\S]*setLocalProfileStatus\("localProfileNameRequired", "error"\);[\s\S]*displayNameInput\?\.focus\(\);/);
  assert.match(saveHandler, /localProfileManager\.save\(\{ displayName \}\)/);
  assert.match(saveHandler, /result\.stored \? "localProfileSaved" : "localProfileEmpty"/);
  assert.doesNotMatch(`${populateHandler}\n${saveHandler}`, /localProfileUsageSharingPreference|futureUsageSharingPreference|type="radio"/);
  assert.doesNotMatch(app, /handleLocalProfileDelete|localProfileDeleteButton|localProfileDeleteConfirm/);
  assert.match(app, /requestAnimationFrame\(\(\) => document\.getElementById\("localProfileDisplayName"\)\?\.focus\(\)\)/);
  assert.match(app, /if \(event\.key === "Escape"\)/);
  assert.match(app, /if \(event\.key !== "Tab"\) return/);
  assert.match(app, /opener\.focus\(\)/);
  assert.match(css, /\.local-profile-save-button,[\s\S]*min-height:46px/);
  assert.match(css, /\.local-profile-field input[\s\S]*font-size:16px/);
});

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
  assert.match(index, /Glurooの準備ガイドを見る/);
  assert.match(index, /Glurooの準備ができたので、接続へ進む/);
  const connectStart = index.indexOf('id="dataSourceConnectPanel"');
  const connectEnd = index.indexOf("</form>", connectStart);
  const connectPanel = index.slice(connectStart, connectEnd);
  assert.doesNotMatch(connectPanel, /Glurooの準備ガイドを見る/);
});

test("Gluroo cost wording is limited to the current testing phase", () => {
  assert.match(index, /Gluroo Global Connectは現在テスト期間中のため費用なし/);
  assert.match(app, /将来はサブスクリプション/);
  assert.match(app, /currently has no cost during its testing phase/);
  assert.doesNotMatch(app, /free alternative to subscription Nightscout/i);
});

test("Gluroo beginner route covers Libre, Dexcom G7, and the verified Guardian Monitor path", () => {
  assert.match(index, /FreeStyle Libre 2、Dexcom G7、Guardian（MiniMed 780G）/);
  assert.match(glurooGuide, /FreeStyle Libre 2/);
  assert.match(glurooGuide, /Dexcom G7/);
  assert.match(glurooGuide, /Guardian Monitor/);
});

test("Guardian uses the verified Guardian Monitor to Gluroo route", () => {
  assert.match(index, /Guardian（MiniMed 780G）/);
  assert.match(index, /Guardian Monitorの設定ガイドを見る/);
  assert.match(index, /guides\/guardian-monitor/);
  assert.match(glurooGuide, /Guardian MonitorからGluroo Global ConnectへNightscout同期/);
  assert.match(guardianGuide, /実機確認しています/);
  assert.match(guardianGuide, /バックグラウンド更新をオン/);
  assert.doesNotMatch(index, /Guardianは現在のかんたん接続では利用できません/);
});

test("Nightscout wording identifies what the person already uses", () => {
  assert.match(index, /自分のNightscout環境をすでに使っている方/);
  assert.doesNotMatch(index, /すでに使っている方・/);
});

test("Gluroo preparation presents equal device guide choices without a separate Guardian warning", () => {
  assert.match(index, /data-source-device-guide-grid/);
  assert.match(index, /Libre／Dexcomを使っている方/);
  assert.match(index, /Guardian（MiniMed 780G）を使っている方/);
  assert.match(index, /Guardian Monitorの設定ガイドを見る/);
  assert.doesNotMatch(index, /data-source-guardian-note/);
  assert.doesNotMatch(index, /kazumaのGuardian接続例を見る/);
  assert.doesNotMatch(guardianGuide, /kazumaの現在の構成/);
});

test("connection screen separates relay, direct, and browser-storage boundaries", () => {
  assert.match(index, /dataSourceRelayNotice/);
  assert.match(index, /dataSourceNightscoutDirectNotice/);
  assert.match(index, /dataSourceLocalOnlyLine1/);
  assert.match(index, /dataSourceLocalOnlyLine2/);
  assert.match(app, /限定中継機能を一時的に通ります/);
  assert.match(app, /このブラウザがあなたのNightscoutへ直接つながります/);
  assert.match(app, /GlucoScopeの中継サーバーへ送ることはありません/);
  assert.doesNotMatch(app, /限定中継機能を通りません/);
  assert.match(app, /共用している端末/);
});

test("Gluroo guide starts at App Store and identifies the correct app", () => {
  assert.match(glurooGuide, /App StoreでGlurooを探します/);
  assert.match(glurooGuide, /カンガルーの絵/);
  assert.match(glurooGuide, /Gluroo Diabetes Logger/);
  assert.match(glurooGuide, /Gluroo Imaginations Inc\./);
  assert.doesNotMatch(glurooGuide, /鹿の絵/);
});

test("field-test revision gives every optional screen an explicit SKIP rule", () => {
  const stepNumbers = glurooGuide.match(/guide-step-number/g) || [];
  assert.ok(stepNumbers.length >= 34);
  assert.match(glurooGuide, /SKIPしてよい/);
  assert.match(glurooGuide, /飛ばさない/);
  assert.match(glurooGuide, /プロフィールの必須項目を入力します/);
  assert.match(glurooGuide, /利用目的を1つ以上選びます/);
  assert.match(glurooGuide, /通知の案内を進みます/);
  assert.doesNotMatch(glurooGuide, /表示される質問へ、分かる範囲で答えます/);
});


test("Gluroo guide maps the reviewed 34-screen source set and warns about version changes", () => {
  const stepImages = glurooGuide.match(/images\/steps\/\d{2}-[a-z0-9-]+\.webp/g) || [];
  assert.equal(new Set(stepImages).size, 34);
  assert.match(glurooGuide, /Gluroo 2\.0\.5/);
  assert.match(glurooGuide, /バージョンや仕様/);
  assert.match(glurooGuide, /画面の見た目、文言、順番、表示される画面が変わる可能性/);
  assert.match(glurooGuide, /Set up later/);
  assert.match(glurooGuide, /基礎リマインダーをスキップ/);
  assert.match(glurooGuide, /スキップして後でやる/);
  assert.match(glurooGuide, /今はスキップ/);
  assert.match(glurooGuide, /API Secret Header \(SHA1\)は使いません/);
});

test("public guide images are lazy loaded and describe redaction", () => {
  assert.match(glurooGuide, /loading="lazy"/);
  assert.match(glurooGuide, /公開用画像では、秘密の接続情報を隠しています/);
  assert.match(glurooGuide, /接続情報は公開用に非表示/);
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

test("Dexcom Share guide uses every supplied screen in one-screen steps", async () => {
  const stepImages = dexcomGuide.match(/images\/steps\/\d{2}-[a-z0-9-]+\.(?:jpg|png)/g) || [];
  assert.equal(stepImages.length, 10);
  assert.equal(new Set(stepImages).size, 10);
  assert.equal((dexcomGuide.match(/guide-step-number/g) || []).length, 10);
  assert.match(dexcomGuide, /フォロワーはまだいません/);
  assert.match(dexcomGuide, /有効なフォロワーなし.*エラーではありません/s);
  assert.match(dexcomGuide, /招待メールを送信しました/);
  assert.match(dexcomGuide, /本人側（Sharer）のユーザーIDとパスワード/);
  assert.match(dexcomGuide, /画像例とご自身の画面でオン・オフが違っても問題ありません/);
  assert.match(dexcomGuide, /\.\.\/gluroo-setup\/#screen-30/);
  for (const relativePath of stepImages) {
    await access(new URL(`../guides/dexcom-share/${relativePath}`, import.meta.url));
  }
});

test("Libre guide identifies each app before switching", async () => {
  assert.match(glurooGuide, /\.\.\/librelinkup/);
  assert.match(libreGuide, /FreeStyle LibreLink – JP/);
  assert.match(libreGuide, /Abbott Labs/);
  assert.match(libreGuide, /LibreLinkUp/);
  assert.match(libreGuide, /Newyu, Inc/);
  assert.match(libreGuide, /Gluroo Diabetes Logger/);
  assert.match(libreGuide, /今から開くアプリ|STEP 1〜6で開くアプリ/);
  assert.match(libreGuide, /アプリアイコンは更新で変わる/);
  assert.match(libreGuide, /id1449296861/);
  assert.match(libreGuide, /id1234323923/);
  assert.match(libreGuide, /guide\.css\?v=20260812-libre-app-icons-1/);
  assert.match(guideCss, /\.guide-app-now/);
  assert.match(libreGuide, /guide-app-store-icon-link/);
  assert.equal((libreGuide.match(/images\/app-icons\/librelink-app\.png/g) || []).length, 2);
  assert.equal((libreGuide.match(/images\/app-icons\/librelinkup-app\.png/g) || []).length, 2);
  assert.match(libreGuide, /LibreLinkの黄色いアプリアイコン/);
  assert.match(libreGuide, /LibreLinkUpの濃い紺色に黄色いマークのアプリアイコン/);
  assert.doesNotMatch(libreGuide, /guide-app-store-icon-placeholder|guide-app-icon-libre|guide-app-icon-linkup/);
  assert.match(libreGuide, /gluroo-app-store\.webp/);
  assert.match(guideCss, /\.guide-app-icon-image/);
  await access(new URL("../guides/librelinkup/images/app-icons/librelink-app.png", import.meta.url));
  await access(new URL("../guides/librelinkup/images/app-icons/librelinkup-app.png", import.meta.url));
});

test("LibreLinkUp preparation guide explains invitation and credentials", () => {
  assert.match(libreGuide, /アプリ連携済み/);
  assert.match(libreGuide, /接続するアプリ/);
  assert.match(libreGuide, /招待メール/);
  assert.match(libreGuide, /LibreLinkUpに自分の血糖値が表示/);
  assert.match(libreGuide, /LibreLinkUpへ登録したメールアドレス/);
  assert.match(libreGuide, /再設定/);
  assert.match(libreGuide, /GlucoScopeへLibreLinkUpのパスワードを入力することはありません/);
});

test("LibreLinkUp guide uses every supplied screen and separates both phones", async () => {
  const stepImages = libreGuide.match(/images\/steps\/\d{2}-[a-z0-9-]+\.png/g) || [];
  assert.equal(stepImages.length, 27);
  assert.equal(new Set(stepImages).size, 27);
  assert.equal((libreGuide.match(/guide-step-number/g) || []).length, 27);
  assert.match(libreGuide, /第1章 · 共有する人のスマホ/);
  assert.match(libreGuide, /第2章 · 招待を受ける人のスマホ/);
  assert.match(libreGuide, /「必須です」と出ても大丈夫です/);
  assert.match(libreGuide, /「最近のデータなし」と表示されることがあります/);
  assert.match(libreGuide, /「許可」または「許可しない」/);
  assert.match(libreGuide, /\.\.\/gluroo-setup\/#screen-30/);
  for (const relativePath of stepImages) {
    await access(new URL(`../guides/librelinkup/${relativePath}`, import.meta.url));
  }
});

test("CGM preparation screenshots are accessible and privacy-explained", () => {
  for (const guide of [libreGuide, dexcomGuide]) {
    const imageTags = guide.match(/<img\s[^>]+>/g) || [];
    assert.ok(imageTags.length > 0);
    imageTags.forEach((tag) => {
      assert.match(tag, /\salt="[^"]+"/);
      assert.match(tag, /\sloading="lazy"/);
      assert.match(tag, /\sdecoding="async"/);
    });
    assert.match(guide, /公開用に隠しています/);
    assert.doesNotMatch(guide, /API Secret|Nightscout URL/);
  }
  assert.match(guideCss, /\.guide-brand,\.guide-back\{[^}]*min-height:44px/);
  assert.match(guideCss, /env\(safe-area-inset-top\)/);
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
  assert.doesNotMatch(app, /dataSourceSaveButton"\)\?\.addEventListener\("click", handleDataSourceSave\)/);
  assert.equal((app.match(/form\?\.addEventListener\("submit", handleDataSourceSave\)/g) || []).length, 1);
  const saveHandlerStart = app.indexOf("function handleDataSourceSave");
  const saveHandlerEnd = app.indexOf("function handleDataSourceDelete", saveHandlerStart);
  const saveHandler = app.slice(saveHandlerStart, saveHandlerEnd);
  assert.match(saveHandler, /if \(dataSourceSaveInFlight \|\| pendingDataSourceSave\) return;/);
  assert.match(saveHandler, /const generation = nextDataSourceSaveGeneration\(\);\s*pendingDataSourceSave = \{\s*generation,\s*config: testedDataSourceConfig,\s*displayName,/s);
  assert.match(saveHandler, /void completePendingDataSourceSave\("", generation, \{ skipUsageProfile: true \}\)/);
  assert.match(saveHandler, /prepareUsageProfileTurnstile\(generation\)/);
  const chooseStepStart = app.indexOf("function showDataSourceChooseStep");
  const chooseStepEnd = app.indexOf("function showDataSourceGlurooPrepStep", chooseStepStart);
  const chooseStep = app.slice(chooseStepStart, chooseStepEnd);
  assert.match(chooseStep, /if \(isDataSourceSaveBusy\(\)\) return;/);
  assert.match(chooseStep, /focusCurrentDataSourceStep\(\)/);

  const persistStart = app.indexOf("function persistDataSourceBrowserState");
  const persistEnd = app.indexOf("async function completePendingDataSourceSave", persistStart);
  const persistHandler = app.slice(persistStart, persistEnd);
  assert.match(persistHandler, /localProfileManager\?\.save\?\.\(\{ displayName: snapshot\.displayName \}\)/);
  assert.match(persistHandler, /dataSourceManager\.saveUserConfig\(\s*snapshot\.config/);
  assert.ok(
    persistHandler.indexOf("dataSourceManager.saveUserConfig(")
      < persistHandler.indexOf("localProfileManager?.save?.({ displayName: snapshot.displayName })")
  );
  assert.match(persistHandler, /return \{ displayNameStored: false, savedConfig \}/);
  assert.match(persistHandler, /function activateSavedDataSourceInPlace\(savedConfig\)/);
  assert.match(persistHandler, /if \(isUserDataSourceMode\(\)\) \{\s*activateSavedDataSourceInPlace\(savedConfig\);\s*return false;/s);
  assert.doesNotMatch(persistHandler, /window\.location\.reload\(\)/);
  assert.match(persistHandler, /window\.location\.href = buildUserModeUrl\("glucose"\);\s*return true;/s);
});

test("data connection dialog traps focus and restores its opener", () => {
  const openStart = app.indexOf("function openDataSourceDialog");
  const openEnd = app.indexOf("async function handleDataSourceTest", openStart);
  const dialogHandlers = app.slice(openStart, openEnd);
  assert.match(dialogHandlers, /dataSourceDialogOpener = options\.opener \|\| document\.activeElement/);
  assert.match(dialogHandlers, /focusCurrentDataSourceStep\(\)/);
  assert.match(dialogHandlers, /dialog\.dataset\.required === "true" \|\| isDataSourceSaveBusy\(\)/);
  assert.match(dialogHandlers, /window\.requestAnimationFrame\(\(\) => opener\.focus\(\)\)/);

  const setupStart = app.indexOf("function setupDataSourceFoundation");
  const setupEnd = app.indexOf("function setLocalProfileStatus", setupStart);
  const setupHandler = app.slice(setupStart, setupEnd);
  assert.match(setupHandler, /if \(event\.key === "Escape"\)/);
  assert.match(setupHandler, /if \(event\.key !== "Tab"\) return;/);
  assert.match(setupHandler, /getDataSourceDialogFocusableElements\(\)/);
  assert.match(setupHandler, /!dialog\.contains\(activeElement\)/);
  assert.match(setupHandler, /event\.shiftKey && activeElement === first/);
  assert.match(setupHandler, /dialog\?\.querySelectorAll\('a\[href\]'\)/);
  assert.match(setupHandler, /!event\.shiftKey && activeElement === last/);

  const focusStart = app.indexOf("function focusCurrentDataSourceStep");
  const focusEnd = app.indexOf("function showDataSourceChooseStep", focusStart);
  const focusHandler = app.slice(focusStart, focusEnd);
  assert.match(focusHandler, /dataSourceDisplayName/);
  assert.match(focusHandler, /heading\.tabIndex = -1/);
  assert.match(focusHandler, /dataSourceNightscoutChoice/);
  assert.match(focusHandler, /dataSourceGlurooChoice/);
});

test("user mode survives static-server canonical URLs and mobile tab changes", () => {
  assert.match(userEntry, /new URL\("\.\/", window\.location\.href\)/);
  assert.match(userEntry, /href="\.\/\?mode=user#glucose"/);
  const buildUrlStart = app.indexOf("function buildUserModeUrl");
  const buildUrlEnd = app.indexOf("function handleDataSourceSave", buildUrlStart);
  const buildUrl = app.slice(buildUrlStart, buildUrlEnd);
  assert.match(buildUrl, /new URL\("\.\/", window\.location\.href\)/);
  assert.match(buildUrl, /url\.search = "\?mode=user"/);
  const mobileStart = app.indexOf("function setMobilePage");
  const mobileEnd = app.indexOf("function syncMobileApp", mobileStart);
  const mobileHandler = app.slice(mobileStart, mobileEnd);
  assert.match(mobileHandler, /const nextUrl = new URL\(window\.location\.href\)/);
  assert.match(mobileHandler, /nextUrl\.hash = resolvedPage/);
  assert.match(mobileHandler, /window\.history\.replaceState\(null, "", nextUrl\.toString\(\)\)/);
  assert.doesNotMatch(mobileHandler, /replaceState\(null, "", `#\$\{resolvedPage\}`\)/);
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

test("guide return links preserve user mode on canonical directory URLs", () => {
  for (const html of [glurooGuide, dexcomGuide, libreGuide, nightscoutGuide]) {
    assert.doesNotMatch(html, /\.\.\/\.\.\/index\.html\?mode=user/);
  }
  assert.match(glurooGuide, /href="\.\.\/\.\.\/\?mode=user&amp;source=gluroo#glucose"/);
  assert.match(nightscoutGuide, /href="\.\.\/\.\.\/\?mode=user&amp;source=nightscout#glucose"/);
  assert.match(glurooGuide, /href="\.\.\/\.\.\/\?mode=user#glucose"/);
  assert.match(nightscoutGuide, /href="\.\.\/\.\.\/\?mode=user#glucose"/);
  assert.match(dexcomGuide, /href="\.\.\/\.\.\/\?mode=user#glucose"/);
  assert.match(libreGuide, /href="\.\.\/\.\.\/\?mode=user#glucose"/);
  assert.equal(
    new URL("../../?mode=user&source=gluroo#glucose", "https://example.test/guides/gluroo-setup/").toString(),
    "https://example.test/?mode=user&source=gluroo#glucose"
  );
});



test("field feedback copy and red-frame navigation are reflected", () => {
  assert.match(glurooGuide, /分からない内容は、分かる範囲で入力して「継続する」/);
  assert.match(glurooGuide, /アボット フリースタイル リブレのバリエーション/);
  assert.match(glurooGuide, /インスリンペンを利用している方は「InPen」を選択してください/);
  assert.match(glurooGuide, /GlucoScopeとの接続には必要ありません/);
  assert.match(glurooGuide, /AppleまたはGoogleのどちらでも構いません/);
  assert.match(glurooGuide, /Dexcom G7の準備ガイドを開く/);
  assert.match(glurooGuide, /上部の「コピー」を押します/);
  assert.match(glurooGuide, /背景の黒い部分をタップ/);
  assert.match(glurooGuide, /34-home-finish\.webp/);
  assert.doesNotMatch(glurooGuide, /URLと合言葉が表示されるまで待ちます/);
  assert.doesNotMatch(glurooGuide, /左上の「×」で閉じます/);
});

test("current cache and CSS markers are present", () => {
  assert.match(index, /js\/data-source\.js\?v=20260812-safari-save-1/);
  assert.match(index, /js\/data-relay-client\.js\?v=20260812-connection-lifecycle-1/);
  assert.match(guideCss, /User Foundation 0\.3\.3/);
  assert.match(css, /Limited Data Relay Paused Acceptance/);
});

test("Turnstile diagnostics show only a validated six-digit confirmation code", () => {
  assert.match(relayClient, /normalizeTurnstileErrorCode/);
  assert.match(relayClient, /turnstileErrorCode \? \{ turnstileErrorCode \} : \{\}/);
  assert.match(app, /dataSourceRelayCheckFailedWithCode/);
  assert.match(app, /getTurnstileConfirmationCode/);
  assert.match(app, /return \/\^\\d\{6\}\$\/u\.test\(code\) \? code : "";/);
  assert.match(app, /replace\("\{code\}", confirmationCode\)/);
  assert.match(app, /この6桁の数字だけを教えてください/);
  assert.doesNotMatch(app, /dataSourceRelayCheckFailedWithCode[^\n]*(?:Secret|credential|token)/i);
});


test("limited relay frontend uses only the approved paused production endpoint", () => {
  assert.match(index, /name="glucoscope-data-relay-endpoint" content="https:\/\/glucoscope-data-relay\.afterglow21\.workers\.dev"/);
  assert.match(index, /js\/data-relay-client\.js/);
  assert.match(index, /dataSourceRelayTurnstile/);
  assert.match(app, /candidate\.provider === "gluroo"/);
  assert.match(app, /relayError\.code = "relay_unavailable"/);
  assert.match(app, /await relay\.prepareConnection\(candidate, \{\s*signal: testAbortController\.signal\s*\}\)/);
});

test("Gluroo relay requires explicit consent before any relay request", () => {
  assert.match(index, /id="dataSourceRelayConsent" type="checkbox"/);
  assert.match(index, /限定中継機能を一時的に通ることに同意します/);
  const testStart = app.indexOf("async function handleDataSourceTest");
  const testEnd = app.indexOf("function clearDataSourceSpecificBrowserState", testStart);
  const handler = app.slice(testStart, testEnd);
  assert.match(handler, /dataSourceRelayConsent/);
  assert.match(handler, /relay_consent_required/);
  assert.ok(handler.indexOf("relay_consent_required") < handler.indexOf("await relay.prepareConnection(candidate, {"));
  assert.match(app, /relay_consent_required: "dataSourceRelayConsentRequired"/);
});

test("Gluroo relay copy never claims that credentials bypass the Worker", () => {
  assert.doesNotMatch(index, /Gluroo[\s\S]{0,500}GlucoScopeのサーバーには保存しません/);
  assert.match(index, /接続情報や血糖データを保存したり、AIへ送ったり、他の利用者と共有したりしません/);
});

test("Guardian Monitor guide has no analytics or real credentials", () => {
  assert.doesNotMatch(guardianGuide, /static\.cloudflareinsights\.com/i);
  assert.doesNotMatch(guardianGuide, /api-secret=[A-Za-z0-9]/i);
  assert.doesNotMatch(guardianGuide, /token=[A-Za-z0-9]/i);
});

test("Guardian Monitor top navigation returns to the route chooser", () => {
  const topbarStart = guardianGuide.indexOf('class="guide-topbar"');
  const topbarEnd = guardianGuide.indexOf("</nav>", topbarStart);
  const topbar = guardianGuide.slice(topbarStart, topbarEnd);
  assert.match(topbar, /href="\.\.\/\.\.\/\?mode=user#glucose"/);
  assert.match(topbar, /つなぎ方を選ぶ画面へ戻る/);
  assert.doesNotMatch(topbar, /source=gluroo/);
});

test("a successful save does not clear the current relay ticket before in-place start", () => {
  const clearStart = app.indexOf("function clearDataSourceSpecificBrowserState");
  const clearEnd = app.indexOf("function buildUserModeUrl", clearStart);
  const clearHandler = app.slice(clearStart, clearEnd);
  assert.doesNotMatch(clearHandler, /clearRelaySession/);
});
