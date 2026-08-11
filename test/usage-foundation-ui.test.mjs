import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const localProfile = await readFile(new URL("../js/local-profile.js", import.meta.url), "utf8");
const usageClient = await readFile(new URL("../js/usage-client.js", import.meta.url), "utf8");

test("usage sharing rollout is opt-in and its frontend and analytics gates stay in lockstep", () => {
  assert.match(index, /name="glucoscope-usage-profile-enabled" content="true"/);
  assert.match(index, /id="usageProfileCard"/);
  assert.match(index, /id="usageProfilePreparing"[^>]*>この機能はただいま準備中です/);
  assert.match(index, /id="usageProfileNotice"[^>]*hidden/);
  assert.match(index, /id="usageProfileActive"[^>]*hidden/);
  assert.match(index, /id="usageProfileStopped"[^>]*hidden/);
  assert.match(app, /const USAGE_PROFILE_ENABLED = true;/);
  const metaEnabled = index.match(/name="glucoscope-usage-profile-enabled" content="(true|false)"/)?.[1];
  const appEnabled = app.match(/const USAGE_PROFILE_ENABLED = (true|false);/)?.[1];
  assert.equal(metaEnabled, appEnabled, "the pre-enrollment analytics gate must match the UI flag");
  assert.match(app, /configure\?\.\(\{\s*enabled: USAGE_PROFILE_ENABLED,\s*endpoint: USAGE_PROFILE_ENDPOINT/s);
  assert.ok(app.indexOf("setupLocalProfileFoundation();") < app.indexOf("initializeUsageProfileFoundation();"));
});

test("the sharing notice is compact, voluntary, and excludes sensitive information", () => {
  const start = index.indexOf('id="usageProfileCard"');
  const end = index.indexOf('id="localProfileStatus"', start);
  const card = index.slice(start, end);

  assert.match(card, /任意の表示名/);
  assert.match(card, /過去90日間にGlucoScopeを利用した日数/);
  assert.match(card, /新しく成功したAI分析の回数/);
  assert.match(card, /通常のグルコの想い出（No\.1〜50）の数/);
  assert.match(card, /血糖値、グラフ、接続情報、AIお手紙の内容は送りません/);
  assert.match(card, /共有しなくても、血糖表示などの基本機能はそのまま使えます/);
  assert.match(card, /この端末を区別するランダムな番号/);
  assert.match(card, /共有の状態・開始日時・最終利用日時/);
  assert.match(card, /Cloudflareで処理/);
  assert.match(card, /90日を上限/);
  assert.match(card, /いつでも停止・書き出し・削除/);
  assert.match(card, /href="pages\/trust\/privacy-notes\.html"/);
  assert.match(card, /アカウントではなく、このブラウザだけの端末プロフィール/);
  assert.match(card, /別の端末とはまとまらず、ブラウザのデータを消すと引き継げません/);
  assert.match(card, /この端末の利用状況を共有する/);
  assert.match(card, /今はしない/);
  assert.doesNotMatch(card, /type="checkbox"|type="radio"|同意|consent/i);
});

test("sharing controls cover stop, resume, export, and server deletion", () => {
  for (const id of [
    "usageProfileStartButton",
    "usageProfileStopButton",
    "usageProfileResumeButton",
    "usageProfileExportActiveButton",
    "usageProfileExportStoppedButton",
    "usageProfileDeleteActiveButton",
    "usageProfileDeleteStoppedButton"
  ]) {
    assert.match(index, new RegExp(`id="${id}"`), id);
  }
  assert.match(app, /updateProfile\?\.\(\{\s*collectionEnabled: Boolean\(collectionEnabled\)/s);
  assert.match(app, /exportData\?\.\(\)/);
  assert.match(app, /deleteData\?\.\(\)/);
  assert.match(app, /if \(!getUsageProfileState\(\)\.registered \|\| usageProfileActionInFlight\) return;/);
  assert.match(app, /stopDisabledButton\.hidden = state\.enabled \|\| !state\.registered \|\| !state\.collectionEnabled/);
  assert.match(app, /端末内の表示名、データ接続、血糖データ、グルコの想い出は削除しません/);
});

test("usage start uses the shared lazy Turnstile loader with a dedicated action", () => {
  assert.match(index, /id="usageProfileTurnstile"[^>]*hidden/);
  assert.match(app, /action: "glucoscope-usage-profile"/);
  assert.match(app, /ensureTurnstileScript\(\)/);
  assert.match(app, /script\.onload = \(\) => \{\s*renderAiLetterTurnstileWidget\(\);\s*renderUsageProfileTurnstileWidget\(\);/s);
  assert.match(app, /start\?\.\(\{ displayName, turnstileToken \}\)/);
  assert.match(app, /document\.getElementById\("localProfileDisplayName"\)\?\.value/);
  assert.match(app, /localProfileManager\?\.save\?\.\(\{[\s\S]*started\.profile\?\.displayName/s);
});

test("only ordinary Gluco memories 1 through 50 are counted and synced", () => {
  assert.match(app, /imageNumber >= 1 && imageNumber <= GLUCO_NORMAL_MAX_ID/);
  assert.match(app, /syncOrdinaryMemoryCount\?\.\(getOrdinaryGlucoMemoryCount\(\)\)/);
  assert.match(app, /collectionInfo\.isNew[\s\S]*imageNumber <= GLUCO_NORMAL_MAX_ID[\s\S]*syncUsageProfileOrdinaryMemoryCount/);
  assert.doesNotMatch(usageClient, /UNICORN_GLUCO|GLUCO_LUCKY|glucose|tir|GlucoScore/i);
});

test("AI usage is recorded only for a completed new OpenAI generation", () => {
  assert.match(app, /data\?\.status === "success"/);
  assert.match(app, /data\?\.generation\?\.complete === true/);
  assert.match(app, /data\?\.source === "openai"/);
  assert.match(app, /data\?\.letter\?\.cached !== true/);
  assert.match(app, /cacheStatus !== "fresh"/);
  assert.match(app, /cacheStatus !== "stale-fallback"/);
  assert.match(app, /recordAiGeneration\?\.\(\{\}\)/);
  const requestStart = app.indexOf("async function handleAiLetterRequest");
  const requestEnd = app.indexOf("function exposeLetterControlGlobals", requestStart);
  const requestHandler = app.slice(requestStart, requestEnd);
  assert.ok(requestHandler.indexOf("saveAiLetterLocalCache(latestAiLetterSummary, data") < requestHandler.indexOf("recordUsageProfileAiGenerationIfEligible(data)"));
});

test("local display-name storage remains network-free and server sync is separate", () => {
  assert.doesNotMatch(localProfile, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/u);
  assert.match(index, /js\/local-profile\.js\?v=20260811-usage-profile-stage-1/);
  assert.match(index, /js\/usage-client\.js\?v=20260811-usage-profile-rollout-1/);
  assert.match(index, /js\/app\.js\?v=20260811-usage-profile-rollout-1/);
  assert.match(app, /updateUsageProfileDisplayName\(result\.profile\.displayName\)/);
  assert.match(app, /updateUsageProfileDisplayName\(""\)/);
  assert.match(app, /if \(!state\.enabled \|\| !state\.registered\) return;/);
});
