import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const localProfile = await readFile(new URL("../js/local-profile.js", import.meta.url), "utf8");
const usageClient = await readFile(new URL("../js/usage-client.js", import.meta.url), "utf8");

test("paused usage sharing keeps its frontend and analytics gates in lockstep", () => {
  assert.match(index, /name="glucoscope-usage-profile-enabled" content="false"/);
  assert.match(index, /id="usageProfileCard"[^>]*hidden/);
  assert.match(index, /id="usageProfileActive"[^>]*hidden/);
  assert.match(index, /id="usageProfileStopped"[^>]*hidden/);
  assert.doesNotMatch(index, /id="usageProfilePreparing"|id="usageProfileNotice"/);
  assert.doesNotMatch(index, /id="usageProfileStartButton"|id="usageProfileSkipButton"/);
  assert.doesNotMatch(app, /usageProfile(?:Preparing|Notice|StartButton|SkipButton|SafetyCheck|Starting|Started|Skipped)/);
  assert.match(app, /const USAGE_PROFILE_ENABLED = false;/);
  assert.match(app, /dataSourceUsageNotePaused: "表示名はこの端末に保存します。利用記録は現在停止中です。"/);
  assert.match(app, /dataSourceUsageNotePaused: "The display name is saved on this device\. Usage recording is currently paused\."/);
  assert.match(app, /const usageNoteKey = USAGE_PROFILE_ENABLED \? "dataSourceUsageNote" : "dataSourceUsageNotePaused";/);
  assert.match(app, /usageNote\.dataset\.i18nKey = usageNoteKey;\s*usageNote\.textContent = t\(usageNoteKey\);/s);
  const metaEnabled = index.match(/name="glucoscope-usage-profile-enabled" content="(true|false)"/)?.[1];
  const appEnabled = app.match(/const USAGE_PROFILE_ENABLED = (true|false);/)?.[1];
  assert.equal(metaEnabled, appEnabled, "the pre-enrollment analytics gate must match the UI flag");
  assert.match(app, /configure\?\.\(\{\s*enabled: USAGE_PROFILE_ENABLED,\s*endpoint: USAGE_PROFILE_ENDPOINT/s);
  assert.ok(app.indexOf("setupLocalProfileFoundation();") < app.indexOf("initializeUsageProfileFoundation();"));
});

test("data connection asks for a required display name with one short usage note", () => {
  const start = index.indexOf('id="dataSourceForm"');
  const end = index.indexOf("</form>", start);
  const form = index.slice(start, end);
  const displayName = form.match(/<input id="dataSourceDisplayName"[^>]*>/)?.[0] || "";

  assert.match(displayName, /name="displayName"/);
  assert.match(displayName, /type="text"/);
  assert.match(displayName, /autocomplete="nickname"/);
  assert.match(displayName, /\brequired\b/);
  assert.doesNotMatch(displayName, /maxlength=/);
  assert.ok(form.indexOf('id="dataSourceDisplayName"') < form.indexOf('id="dataSourceUrl"'));
  assert.match(form, /本名でなくて大丈夫です/);
  assert.match(form, /id="dataSourceUsageNoteText"[^>]*data-i18n-key="dataSourceUsageNotePaused"/);
  assert.match(form, /表示名はこの端末に保存します。利用記録は現在停止中です。/);
  assert.match(form, /href="pages\/trust\/privacy-notes\.html"[^>]*data-i18n-key="dataSourceUsageDetails"/);
  assert.match(app, /dataSourceTestWaiting: "表示名と接続情報を入力して、つながるか確認します。"/);
  assert.doesNotMatch(form, /ランダムな番号|90日を上限|この端末の利用状況を共有する|今はしない/);
});

test("registered profiles get a small management section with no enrollment controls", () => {
  for (const id of [
    "usageProfileStopButton",
    "usageProfileStopDisabledButton",
    "usageProfileResumeButton",
    "usageProfileExportActiveButton",
    "usageProfileExportStoppedButton",
    "usageProfileDeleteActiveButton",
    "usageProfileDeleteStoppedButton"
  ]) {
    assert.match(index, new RegExp(`id="${id}"`), id);
  }
  assert.match(index, /id="usageProfileCardTitle"[^>]*>利用記録の管理</);
  assert.match(index, /class="usage-profile-export-link"[^>]*[^<]*保存されている利用記録を確認・保存/);
  assert.doesNotMatch(index, /id="usageProfileStartButton"|id="usageProfileSkipButton"/);
  assert.match(app, /updateProfile\?\.\(\{\s*collectionEnabled: Boolean\(collectionEnabled\)/s);
  assert.match(app, /exportData\?\.\(\)/);
  assert.match(app, /deleteData\?\.\(\)/);
  assert.match(app, /if \(!getUsageProfileState\(\)\.registered \|\| usageProfileActionInFlight\) return;/);
  assert.match(app, /stopDisabledButton\.hidden = state\.enabled \|\| !state\.registered \|\| !state\.collectionEnabled/);
  assert.match(app, /端末内の表示名、データ接続、血糖データ、グルコの想い出は削除しません/);
});

test("connection save makes the dedicated usage check best-effort and generation-safe", () => {
  const formStart = index.indexOf('id="dataSourceForm"');
  const formEnd = index.indexOf("</form>", formStart);
  const form = index.slice(formStart, formEnd);
  const profileStart = index.indexOf('id="localProfileDialog"');
  const profileEnd = index.indexOf('<div class="dashboard">', profileStart);
  const profileDialog = index.slice(profileStart, profileEnd);

  assert.match(form, /id="usageProfileTurnstile"[^>]*hidden/);
  assert.doesNotMatch(profileDialog, /id="usageProfileTurnstile"/);
  assert.match(app, /action: "glucoscope-usage-profile"/);
  assert.match(app, /const USAGE_PROFILE_TURNSTILE_TIMEOUT_MS = 15_000;/);
  assert.doesNotMatch(app, /USAGE_PROFILE_REQUEST_TIMEOUT_MS|waitForUsageProfileAttempt|usage_profile_timeout/);
  assert.match(app, /const script = ensureTurnstileScript\(\)/);
  assert.match(app, /usageProfileManager\?\.start\?\.\(\{\s*displayName: snapshot\.displayName,\s*turnstileToken\s*\}\)/s);
  assert.match(app, /document\.getElementById\("dataSourceDisplayName"\)/);
  assert.match(app, /localProfileManager\?\.save\?\.\(\{ displayName: snapshot\.displayName \}\)/);
  assert.match(app, /window\.turnstile\.remove\(widgetId\)/);
  assert.match(app, /pendingDataSourceSave\.generation === generation[\s\S]*dataSourceSaveGeneration === generation/);
  assert.match(app, /container\.dataset\.generation = String\(generation\)/);
  assert.match(app, /if \(!isCurrentPendingDataSourceSave\(generation\) \|\| dataSourceSaveInFlight\) return;\s*void completePendingDataSourceSave\(token, generation\);/s);
  assert.match(app, /usage_turnstile_expired/);
  assert.match(app, /usage_turnstile_error/);
  assert.match(app, /usage_turnstile_script_failed/);
  assert.match(app, /usage_turnstile_timeout/);

  const completeStart = app.indexOf("async function completePendingDataSourceSave");
  const completeEnd = app.indexOf("function handleDataSourceSave", completeStart);
  const completeHandler = app.slice(completeStart, completeEnd);
  assert.equal((completeHandler.match(/usageProfileManager\?\.(?:start|updateProfile)\?\.\(/g) || []).length, 2);
  assert.match(completeHandler, /catch \(usageError\) \{[\s\S]*Continuing without a usage profile/);
  assert.ok(
    completeHandler.indexOf("persistDataSourceBrowserState(snapshot)")
      < completeHandler.indexOf("usageProfileManager?.start?.(")
  );
  assert.ok(
    completeHandler.indexOf("usageProfileManager?.updateProfile?.(")
      < completeHandler.indexOf("navigateToSavedDataSource()")
  );
  assert.doesNotMatch(completeHandler, /dataSourceUsageStartError/);
});

test("busy connection saves block destructive controls and stale callbacks", () => {
  assert.match(app, /let dataSourceSaveGeneration = 0;/);
  assert.match(app, /let dataSourceTestGeneration = 0;/);
  assert.match(app, /function invalidatePendingDataSourceSave\(\) \{\s*nextDataSourceSaveGeneration\(\);\s*pendingDataSourceSave = null;/s);
  assert.match(app, /function handleDataSourceDelete\(\) \{\s*if \(!dataSourceManager \|\| isDataSourceSaveBusy\(\)\) return;\s*invalidateDataSourceTest\(\);\s*invalidatePendingDataSourceSave\(\);/s);
  for (const id of [
    "dataSourceDeleteButton",
    "dataSourceBackButton",
    "dataSourceGlurooPrepBackButton",
    "dataSourceDialogClose"
  ]) {
    assert.match(app, new RegExp(`"${id}"`), id);
  }
  assert.match(app, /function showDataSourceChooseStep\(\) \{\s*if \(isDataSourceSaveBusy\(\)\) return;/s);
  assert.match(app, /destroyUsageProfileTurnstile\(generation\)/);
  assert.match(app, /const generation = nextDataSourceTestGeneration\(\)/);
  assert.ok((app.match(/if \(!isCurrentDataSourceTest\(generation\)\) return;/g) || []).length >= 3);
  assert.match(app, /dataSourceTestGeneration \+= 1;\s*testedDataSourceConfig = null;/s);
  for (const id of ["dataSourceUsageDetailsLink", "dataSourceDemoLink", "dataSourceNightscoutAboutLink"]) {
    assert.match(index, new RegExp(`id="${id}"`), id);
  }
  assert.match(app, /querySelectorAll\('a\[href\]'\)/);
  assert.match(app, /link\.setAttribute\("aria-disabled", disabled \? "true" : "false"\)/);
  assert.match(app, /if \(!isDataSourceSaveBusy\(\)\) return;\s*event\.preventDefault\(\);/s);
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
  assert.match(index, /js\/usage-client\.js\?v=20260812-simple-connection-2/);
  assert.match(index, /js\/app\.js\?v=20260812-simple-connection-2/);
  assert.match(app, /updateUsageProfileDisplayName\(result\.profile\.displayName\)/);
  assert.doesNotMatch(app, /handleLocalProfileDelete|localProfileDeleteButton/);
  assert.match(app, /if \(!state\.enabled \|\| !state\.registered\) return;/);
});
