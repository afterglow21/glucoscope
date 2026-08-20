import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");

function loadBrowserDetector() {
  const start = app.indexOf("function getDataSourceBrowserContext");
  const end = app.indexOf("function shouldCreateNewUsageProfile", start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(`(${app.slice(start, end).trim()})`, {
    window: {
      navigator: {},
      matchMedia() {
        return { matches: false };
      }
    }
  });
}

function loadUsageEnrollmentPolicy() {
  const start = app.indexOf("function shouldCreateNewUsageProfile");
  const end = app.indexOf("function setVisibleDataSourceEntryPanel", start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(`(${app.slice(start, end).trim()})`);
}

test("Instagram and non-Safari iPhone browsers are separated from Safari and Home Screen launches", () => {
  const detect = loadBrowserDetector();
  const safariUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1";
  const instagramUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 390.0";
  const chromeUa = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 CriOS/140.0.0.0 Mobile/15E148 Safari/604.1";

  assert.deepEqual(
    { ...detect({ navigator: { userAgent: instagramUa }, displayModeStandalone: false }) },
    { isIphone: true, isInAppBrowser: true, isIphoneSafari: false, isStandalone: false }
  );
  assert.deepEqual(
    { ...detect({ navigator: { userAgent: chromeUa }, displayModeStandalone: false }) },
    { isIphone: true, isInAppBrowser: true, isIphoneSafari: false, isStandalone: false }
  );
  assert.deepEqual(
    { ...detect({ navigator: { userAgent: safariUa }, displayModeStandalone: false }) },
    { isIphone: true, isInAppBrowser: false, isIphoneSafari: true, isStandalone: false }
  );
  assert.deepEqual(
    { ...detect({ navigator: { userAgent: safariUa, standalone: true }, displayModeStandalone: false }) },
    { isIphone: true, isInAppBrowser: false, isIphoneSafari: true, isStandalone: true }
  );
});

test("the in-app browser is a hard stop and ordinary Safari gets install-first guidance", () => {
  const inAppStart = index.indexOf('id="dataSourceInAppBrowserPanel"');
  const inAppEnd = index.indexOf('id="dataSourceHomeScreenPanel"', inAppStart);
  const inAppPanel = index.slice(inAppStart, inAppEnd);

  assert.match(inAppPanel, /Safariで開いてください/);
  assert.match(inAppPanel, /Safari以外のiPhoneブラウザ/);
  assert.match(inAppPanel, /「Safariで開く」を選びます/);
  assert.match(inAppPanel, /id="dataSourceCopyEntryUrlButton"/);
  assert.doesNotMatch(inAppPanel, /dataSourceContinueInSafariButton|dataSourceConnectPanel/);
  assert.match(index, /Safariの共有ボタン、または「…」を押して「共有」を選びます/);
  assert.match(index, /「ホーム画面に追加」を押します/);
  assert.match(index, /ブラウザから自動で追加することはできません/);
  assert.match(index, /id="dataSourceContinueInSafariButton"/);
  assert.match(app, /if \(context\.isInAppBrowser\) \{\s*showDataSourceInAppBrowserStep\(\);\s*return true;/s);
  assert.match(app, /context\.isIphoneSafari && !context\.isStandalone/);
});

test("optional Usage enrollment happens only in the iPhone Home Screen app", () => {
  assert.match(index, /js\/app\.js\?v=20260820-share-trial-1/);
  const shouldCreate = loadUsageEnrollmentPolicy();
  assert.equal(shouldCreate({ isIphone: true, isStandalone: false }), false);
  assert.equal(shouldCreate({ isIphone: true, isStandalone: true }), true);
  assert.equal(shouldCreate({ isIphone: false, isStandalone: false }), true);

  const saveStart = app.indexOf("async function handleDataSourceSave");
  const saveEnd = app.indexOf("async function handleDataSourceDelete", saveStart);
  const saveFlow = app.slice(saveStart, saveEnd);
  assert.match(
    saveFlow,
    /if \(!shouldCreateNewUsageProfile\(getDataSourceBrowserContext\(\)\)\) \{\s*void completePendingDataSourceSave\("", generation, \{ skipUsageProfile: true \}\);\s*return;\s*\}/s
  );
  assert.ok(
    saveFlow.indexOf("if (state.registered)")
      < saveFlow.indexOf("shouldCreateNewUsageProfile(getDataSourceBrowserContext())")
  );
  assert.ok(
    saveFlow.indexOf("shouldCreateNewUsageProfile(getDataSourceBrowserContext())")
      < saveFlow.indexOf("prepareUsageProfileTurnstile(generation)")
  );
});

test("connection confirmation and save use one guarded primary operation", () => {
  assert.equal((index.match(/id="dataSourceSaveButton"/g) || []).length, 1);
  assert.doesNotMatch(index, /id="dataSourceTestButton"/);
  assert.match(index, /接続してGlucoScopeを始める/);
  assert.match(app, /return Boolean\(pendingDataSourceSave \|\| dataSourceSaveInFlight \|\| dataSourceTestAbortController\)/);

  const testStart = app.indexOf("async function handleDataSourceTest");
  const testEnd = app.indexOf("function clearDataSourceSpecificBrowserState", testStart);
  const testFlow = app.slice(testStart, testEnd);
  assert.ok(testFlow.indexOf("relay.prepareConnection") < testFlow.indexOf(".testConnection("));

  const saveStart = app.indexOf("async function handleDataSourceSave");
  const saveEnd = app.indexOf("async function handleDataSourceDelete", saveStart);
  const saveFlow = app.slice(saveStart, saveEnd);
  assert.ok(saveFlow.indexOf("await handleDataSourceTest()") < saveFlow.indexOf("pendingDataSourceSave ="));
  assert.match(saveFlow, /if \(!connectionVerified \|\| dataSourceSaveInFlight \|\| pendingDataSourceSave\) return;/);
});

test("first successful connection starts automatically and shows a non-blocking welcome", () => {
  assert.match(index, /id="dataSourceWelcome"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(index, /ようこそ、GlucoScopeへ/);
  assert.match(index, /接続できました。最新の血糖データを表示しています。/);
  assert.match(app, /navigationStarted = navigateToSavedDataSource\(savedConfig\);\s*if \(!navigationStarted && snapshot\.showWelcome\) showDataSourceWelcome\(\);/s);
  assert.match(app, /showWelcome: firstConnection/);
  assert.match(css, /\.data-source-welcome \{[\s\S]*pointer-events:none;/);
  assert.match(css, /bottom:max\(104px,calc\(env\(safe-area-inset-bottom,0px\) \+ 94px\)\)/);
});
