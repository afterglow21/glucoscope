import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const localProfile = await readFile(new URL("../js/local-profile.js", import.meta.url), "utf8");
const usageClient = await readFile(new URL("../js/usage-client.js", import.meta.url), "utf8");

test("supervised usage recording keeps its frontend and analytics gates in lockstep", () => {
  assert.match(index, /name="glucoscope-usage-profile-enabled" content="true"/);
  assert.match(index, /id="usageProfileCard"[^>]*hidden/);
  assert.match(index, /id="usageProfileActive"[^>]*hidden/);
  assert.match(index, /id="usageProfileStopped"[^>]*hidden/);
  assert.doesNotMatch(index, /id="usageProfilePreparing"|id="usageProfileNotice"/);
  assert.doesNotMatch(index, /id="usageProfileStartButton"|id="usageProfileSkipButton"/);
  assert.doesNotMatch(app, /usageProfile(?:Preparing|Notice|StartButton|SkipButton|SafetyCheck|Starting|Started|Skipped)/);
  assert.match(app, /const USAGE_PROFILE_ENABLED = true;/);
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

test("the public demo is clearly labelled and user mode hides the demo identity", () => {
  assert.match(index, /id="publicDemoBanner" class="public-demo-banner" role="note"/);
  assert.match(index, /data-i18n-key="publicDemoBannerTitle">公開デモ</);
  assert.match(index, /ここに表示されているのは公開デモのデータです。あなた自身のデータではありません。/);
  assert.match(app, /publicDemoPageTitle: "GlucoScope｜公開デモ"/);
  assert.match(app, /publicDemoBannerLead: "You are viewing the public demo, not your own glucose data\."/);
  assert.match(app, /const userMode = isUserDataSourceMode\(\);[\s\S]*classList\.toggle\("public-demo-mode", !userMode\)/);
  assert.match(app, /document\.title = userMode \? "GlucoScope" : t\("publicDemoPageTitle"\)/);
  assert.match(css, /\.public-demo-banner\{\s*display:none;/);
  assert.match(css, /body\.public-demo-mode \.public-demo-banner\{\s*display:flex;/);
  assert.doesNotMatch(index, /テストデータ|サンプルデータ/);
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
  assert.match(form, /id="dataSourceUsageNoteText"[^>]*data-i18n-key="dataSourceUsageNote"/);
  assert.match(form, /表示名と基本的な利用回数を、GlucoScopeをよくするために記録します。血糖値や接続情報は記録しません。/);
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
  assert.equal((index.match(/<details class="usage-profile-advanced">/g) || []).length, 2);
  assert.match(index, /<summary[^>]*>詳しい管理<\/summary>[\s\S]*class="usage-profile-export-link"[^>]*[^<]*利用記録を確認・保存する/);
  const usageCardEnd = index.indexOf("</section>", index.indexOf('id="usageProfileCard"'));
  assert.ok(index.indexOf('id="usageProfileStatus"') > usageCardEnd);
  assert.doesNotMatch(index, /id="usageProfileStartButton"|id="usageProfileSkipButton"/);
  assert.match(app, /updateProfile\?\.\(\{\s*collectionEnabled: Boolean\(collectionEnabled\)/s);
  assert.match(app, /exportData\?\.\(\)/);
  assert.match(app, /deleteData\?\.\(\)/);
  assert.match(app, /if \(!getUsageProfileState\(\)\.registered \|\| usageProfileActionInFlight\) return;/);
  assert.match(app, /stopDisabledButton\.hidden = state\.enabled \|\| !state\.registered \|\| !state\.collectionEnabled/);
  assert.match(app, /usageProfileDeletedStatus: "利用記録を削除しました。血糖の接続や表示名はそのままです。"/);
  assert.match(app, /usageProfileDeleteConfirm: "この端末の利用記録を削除しますか？ 血糖の接続や表示名、グルコの想い出は消えません。"/);
  assert.match(app, /function openLocalProfileDialog[\s\S]*setUsageProfileStatus\(\);[\s\S]*populateLocalProfileForm\(\);/);
  assert.match(css, /\.usage-profile-status:empty\s*\{\s*display:none;/);
  assert.match(css, /\.usage-profile-advanced summary\s*\{[\s\S]*min-height:44px;/);
  assert.match(css, /\.usage-profile-advanced \.usage-profile-export-link\s*\{[\s\S]*min-height:44px;/);
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
  assert.match(app, /dataSourceSaveStorageError: "この端末に接続を保存できませんでした/);
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
  assert.match(completeHandler, /const \{ displayNameStored, savedConfig \} = persistDataSourceBrowserState\(snapshot\)/);
  assert.match(completeHandler, /USAGE_PROFILE_ENABLED && displayNameStored && !skipUsageProfile/);
  assert.match(completeHandler, /setDataSourceTestStatus\(t\("dataSourceSaveStorageError"\), "error"\)/);
  assert.match(completeHandler, /navigationStarted = navigateToSavedDataSource\(savedConfig\)/);
  assert.match(completeHandler, /if \(ownsInFlightSave && !navigationStarted\) \{\s*setDataSourceSaveControlsDisabled\(false\)/s);
  assert.ok(
    completeHandler.indexOf("persistDataSourceBrowserState(snapshot)")
      < completeHandler.indexOf("usageProfileManager?.start?.(")
  );
  assert.ok(
    completeHandler.indexOf("usageProfileManager?.updateProfile?.(")
      < completeHandler.indexOf("navigateToSavedDataSource(savedConfig)")
  );
  assert.doesNotMatch(completeHandler, /dataSourceUsageStartError/);

  const persistStart = app.indexOf("function persistDataSourceBrowserState");
  const persistEnd = app.indexOf("function activateSavedDataSourceInPlace", persistStart);
  const persistHandler = app.slice(persistStart, persistEnd);
  assert.ok(
    persistHandler.indexOf("dataSourceManager.saveUserConfig(")
      < persistHandler.indexOf("localProfileManager?.save?.({ displayName: snapshot.displayName })")
  );
  assert.match(persistHandler, /return \{ displayNameStored: false, savedConfig \}/);
  assert.match(persistHandler, /return \{ displayNameStored: true, savedConfig \}/);
  assert.doesNotMatch(persistHandler, /throw error/);
});

test("an already-user-mode connection starts in place without losing its relay session", () => {
  const activateStart = app.indexOf("function activateSavedDataSourceInPlace");
  const activateEnd = app.indexOf("function navigateToSavedDataSource", activateStart);
  const activateHandler = app.slice(activateStart, activateEnd);
  const navigateStart = activateEnd;
  const navigateEnd = app.indexOf("async function completePendingDataSourceSave", navigateStart);
  const navigateHandler = app.slice(navigateStart, navigateEnd);

  assert.match(activateHandler, /savedConfig\.provider === "gluroo"[\s\S]*readRelaySession\?\.\(\)/);
  assert.match(activateHandler, /activeDataSourceConfig = savedConfig/);
  assert.match(activateHandler, /activeDataSourceAdapter = savedAdapter/);
  assert.match(activateHandler, /dialog\.dataset\.required = "false"[\s\S]*dialog\.hidden = true/);
  assert.match(activateHandler, /updateDataSourceUiLabels\(\)/);
  assert.match(activateHandler, /startDataRefresh\(\)/);

  assert.match(
    navigateHandler,
    /if \(isUserDataSourceMode\(\)\) \{\s*activateSavedDataSourceInPlace\(savedConfig\);\s*return false;\s*\}/s
  );
  assert.doesNotMatch(navigateHandler, /location\.reload\(/);
  assert.match(navigateHandler, /window\.location\.href = buildUserModeUrl\("glucose"\);\s*return true;/s);
});

test("in-place user activation keeps the relay session and starts data refresh at runtime", () => {
  const activateStart = app.indexOf("function activateSavedDataSourceInPlace");
  const navigateEnd = app.indexOf("async function completePendingDataSourceSave", activateStart);
  const lifecycleFunctions = app.slice(activateStart, navigateEnd);
  const dialog = { dataset: { required: "true" }, hidden: false };
  const closeButton = { hidden: true };
  const liveIndicatorAttributes = new Map();
  const liveIndicator = {
    title: "Gluroo checking",
    focused: false,
    setAttribute: (name, value) => liveIndicatorAttributes.set(name, value),
    removeAttribute: (name) => liveIndicatorAttributes.delete(name),
    addEventListener: () => {},
    focus() { this.focused = true; }
  };
  const classNames = new Set(["data-source-dialog-open"]);
  const calls = { reset: 0, refresh: 0, labels: 0, live: 0, identity: 0 };
  const savedConfig = { mode: "user", provider: "gluroo", baseUrl: "https://example.test" };
  const savedAdapter = { kind: "relay-adapter" };
  const context = {
    currentLanguage: "ja",
    dataSourceManager: { createAdapter: (config) => config === savedConfig ? savedAdapter : null },
    dataSourceDialogOpener: {},
    activeDataSourceConfig: null,
    activeDataSourceAdapter: null,
    document: {
      body: {
        classList: {
          add: (name) => classNames.add(name),
          remove: (name) => classNames.delete(name)
        }
      },
      getElementById(id) {
        if (id === "dataSourceDialog") return dialog;
        if (id === "dataSourceDialogClose") return closeButton;
        if (id === "liveIndicator") return liveIndicator;
        return null;
      }
    },
    window: {
      GlucoScopeDataRelay: { readRelaySession: () => ({ ticket: "kept-in-this-tab" }) },
      location: { href: "https://example.test/?mode=user#glucose" },
      requestAnimationFrame: (callback) => callback()
    },
    isUserDataSourceMode: () => true,
    resetDataSourceDerivedUi: () => { calls.reset += 1; },
    updatePageModeIdentity: () => { calls.identity += 1; },
    updateDataSourceUiLabels: () => { calls.labels += 1; },
    getActiveDataSourceLabel: () => "Gluroo",
    setLiveStatus: () => { calls.live += 1; },
    updateHealthBar: () => {},
    updateAiLetterControls: () => {},
    startDataRefresh: () => { calls.refresh += 1; },
    buildUserModeUrl: () => "https://example.test/?mode=user#glucose",
    Error
  };
  vm.runInNewContext(`${lifecycleFunctions}\nthis.runNavigation = navigateToSavedDataSource;`, context);

  assert.equal(context.runNavigation(savedConfig), false);
  assert.equal(context.activeDataSourceConfig, savedConfig);
  assert.equal(context.activeDataSourceAdapter, savedAdapter);
  assert.equal(dialog.hidden, true);
  assert.equal(dialog.dataset.required, "false");
  assert.equal(closeButton.hidden, false);
  assert.equal(classNames.has("data-source-dialog-open"), false);
  assert.equal(calls.reset, 1);
  assert.equal(calls.identity, 1);
  assert.equal(calls.labels, 1);
  assert.equal(calls.live, 1);
  assert.equal(calls.refresh, 1);
  assert.equal(liveIndicator.focused, true);
  assert.equal(liveIndicatorAttributes.get("tabindex"), "-1");
  assert.equal(liveIndicatorAttributes.has("aria-label"), false);
  assert.equal(context.window.location.href, "https://example.test/?mode=user#glucose");

  context.isUserDataSourceMode = () => false;
  assert.equal(context.runNavigation(savedConfig), true);
  assert.equal(context.window.location.href, "https://example.test/?mode=user#glucose");
  assert.equal(calls.refresh, 1);
});

test("in-place activation clears the former source before a pending or failed refresh", async () => {
  const resetStart = app.indexOf("function resetDataSourceDerivedUi");
  const lifecycleEnd = app.indexOf("function navigateToSavedDataSource", resetStart);
  const lifecycleFunctions = app.slice(resetStart, lifecycleEnd);

  const makeClassList = (...initial) => {
    const values = new Set(initial);
    return {
      values,
      add: (...names) => names.forEach((name) => values.add(name)),
      remove: (...names) => names.forEach((name) => values.delete(name)),
      toggle(name, force) {
        if (force === undefined ? !values.has(name) : force) values.add(name);
        else values.delete(name);
      }
    };
  };

  const runScenario = (refreshResult) => {
    const elements = new Map();
    const makeElement = (id, textContent = "old") => {
      const attributes = new Map();
      const element = {
        id,
        textContent,
        src: "old-source.png",
        alt: "old source",
        hidden: false,
        title: "old source",
        dataset: {},
        classList: makeClassList("old-source"),
        setAttribute(name, value) {
          attributes.set(name, value);
          if (name === "src") this.src = value;
        },
        getAttribute(name) {
          if (name === "src") return this.src;
          return attributes.get(name) ?? null;
        },
        removeAttribute: (name) => attributes.delete(name),
        addEventListener: () => {},
        focus: () => {},
        closest: () => null
      };
      elements.set(id, element);
      return element;
    };

    for (const [id, value] of [
      ["glucoseValue", "188"], ["glucoseArrow", "↑"], ["glucoseDelta", "+8"], ["status", "OLD LIVE"],
      ["lastUpdate", "old"], ["currentLastUpdate", "10:10"], ["graphLastUpdateValue", "old"],
      ["headerUpdated", "1 min ago"], ["rangeStatus", "High"], ["unicornMomentBadge", "old"],
      ["batteryStatus", "99%"], ["cloudStatus", "online"], ["scoreValue", "92"],
      ["scoreReason", "Great"], ["scoreYesterdayDelta", "+4"], ["scoreSevenDayAverage", "88"],
      ["tirValue", "80%"], ["tarValue", "15%"], ["tbrValue", "5%"], ["avgValue", "151"],
      ["cvValue", "31%"], ["gmiValue", "6.9%"], ["chartRange", "old range"],
      ["comparisonLegendItem", "old"], ["manualBolusLegendItem", "old"], ["autoBolusLegendItem", "old"],
      ["comment", "old reflection"], ["commentGlucoNumber", "No. 50"],
      ["commentGlucoLuckyBadge", "Lucky"], ["aiLetterResult", "old AI letter"],
      ["liveIndicator", "old live"]
    ]) makeElement(id, value);

    const peek = makeElement("glucoPeekImage", "");
    peek.dataset.defaultSrc = "default-peek.png";
    peek.classList.add("is-unicorn");
    const scoreImage = makeElement("scoreGlucoImage", "");
    const commentImage = makeElement("commentGlucoImage", "");
    const dialog = makeElement("dataSourceDialog", "");
    dialog.dataset.required = "true";
    dialog.hidden = false;
    makeElement("dataSourceDialogClose", "").hidden = true;

    const scoreMessage = makeElement("scoreMessage", "old score message");
    const commentAvatar = makeElement("commentAvatar", "");
    commentAvatar.classList.add("lucky-gluco", "unicorn-gluco");
    const chart = { destroyed: false, destroy() { this.destroyed = true; } };
    const newAdapter = { source: "new" };
    const savedConfig = { provider: "gluroo", baseUrl: "https://example.test" };
    const bodyClasses = makeClassList("data-source-dialog-open");

    const context = {
      currentLanguage: "ja",
      currentLivePeriod: "today",
      liveStatsRequestSequence: 10,
      glucoseChart: chart,
      latestRuleCommentMetrics: { source: "old" },
      latestAiLetterSummary: { source: "old" },
      aiLetterSummaryState: "ready",
      aiLetterSummaryRangeIdentity: "old-range",
      lastUnicornEvaluatedMeasurementKey: "old-reading",
      activeUnicornGlucoDecision: { source: "old" },
      activeDataSourceConfig: { provider: "old" },
      activeDataSourceAdapter: { source: "old" },
      dataSourceDialogOpener: {},
      scoreGlucoImageByRank: { gentle: "gentle-score.png" },
      dataSourceManager: { createAdapter: () => newAdapter },
      document: {
        body: { classList: bodyClasses },
        getElementById: (id) => elements.get(id) || null,
        querySelector(selector) {
          if (selector === ".score-message") return scoreMessage;
          if (selector === ".gluco-comment-avatar") return commentAvatar;
          return null;
        }
      },
      window: {
        GlucoScopeDataRelay: { readRelaySession: () => ({ ticket: "valid" }) },
        requestAnimationFrame: (callback) => callback()
      },
      t: (key) => key,
      updateCurrentGlucoseColor: () => elements.get("glucoseValue").classList.remove("glucose-high", "glucose-low", "glucose-in-range"),
      updateGlucoseDelta: () => { elements.get("glucoseDelta").textContent = "--"; },
      updateHealthBar: () => {
        elements.get("batteryStatus").textContent = "--";
        elements.get("cloudStatus").textContent = "--";
      },
      updateScoreMetaDisplay: () => {
        elements.get("scoreYesterdayDelta").textContent = "--";
        elements.get("scoreSevenDayAverage").textContent = "--";
      },
      syncMobileRangeSummary: () => {},
      showAiLetterResult: (value) => { elements.get("aiLetterResult").textContent = value; },
      updateAiLetterControls: () => {},
      updatePageModeIdentity: () => {},
      updateDataSourceUiLabels: () => {},
      getActiveDataSourceLabel: () => "Gluroo",
      setLiveStatus: () => {},
      startDataRefresh: () => refreshResult,
      Error
    };
    vm.runInNewContext(`${lifecycleFunctions}\nthis.activate = activateSavedDataSourceInPlace;`, context);
    context.activate(savedConfig);

    assert.equal(chart.destroyed, true);
    assert.equal(context.glucoseChart, null);
    assert.equal(elements.get("glucoseValue").textContent, "--");
    assert.equal(elements.get("graphLastUpdateValue").textContent, "--");
    assert.equal(elements.get("scoreValue").textContent, "--");
    assert.equal(elements.get("tirValue").textContent, "--%");
    assert.equal(elements.get("chartRange").textContent, "--");
    assert.equal(elements.get("comment").textContent, "dataSourceTesting");
    assert.equal(elements.get("aiLetterResult").textContent, "");
    assert.equal(elements.get("commentGlucoNumber").textContent, "No. --");
    assert.equal(commentImage.src, "assets/gluco/live/gluco-live-01.png");
    assert.equal(scoreImage.src, "gentle-score.png");
    assert.equal(context.latestRuleCommentMetrics, null);
    assert.equal(context.latestAiLetterSummary, null);
    assert.equal(context.aiLetterSummaryRangeIdentity, "");
    assert.equal(context.activeDataSourceAdapter, newAdapter);
  };

  const pendingRefresh = new Promise(() => {});
  runScenario(pendingRefresh);

  const failedRefresh = Promise.reject(new Error("new source unavailable"));
  failedRefresh.catch(() => {});
  runScenario(failedRefresh);
});

test("a cleared source never fabricates a zero glucose delta", () => {
  const formatStart = app.indexOf("function formatGlucoseDelta");
  const formatEnd = app.indexOf("function updateGlucoseDelta", formatStart);
  const context = {};
  vm.runInNewContext(`${app.slice(formatStart, formatEnd)}\nthis.formatDelta = formatGlucoseDelta;`, context);

  assert.equal(context.formatDelta(null, null), "--");
  assert.equal(context.formatDelta(undefined, 120), "--");
  assert.equal(context.formatDelta("", 120), "--");
  assert.equal(context.formatDelta(120, 120), "±0");
});

test("unavailable range metrics are not announced as zero", () => {
  const parseStart = app.indexOf("function parseMetricPercentage");
  const syncEnd = app.indexOf("const MOBILE_DISPLAY_MODE_KEY", parseStart);
  const values = new Map([
    ["#tirValue", { textContent: "--%" }],
    ["#tarValue", { textContent: "--%" }],
    ["#tbrValue", { textContent: "--%" }]
  ]);
  const styles = new Map();
  const attributes = new Map();
  const donut = {
    style: { setProperty: (name, value) => styles.set(name, value) },
    setAttribute: (name, value) => attributes.set(name, value)
  };
  const context = {
    currentLanguage: "ja",
    document: {
      querySelector: (selector) => values.get(selector) || null,
      getElementById: (id) => id === "mobileRangeDonut" ? donut : null
    },
    copyTextContent: () => {}
  };
  vm.runInNewContext(`${app.slice(parseStart, syncEnd)}\nthis.sync = syncMobileRangeSummary;`, context);

  context.sync();
  assert.equal(styles.get("--tir-angle"), "0deg");
  assert.equal(styles.get("--tar-angle"), "0deg");
  assert.equal(attributes.get("aria-label"), "血糖範囲データを確認中");

  values.get("#tirValue").textContent = "80%";
  values.get("#tarValue").textContent = "15%";
  values.get("#tbrValue").textContent = "5%";
  context.sync();
  assert.equal(attributes.get("aria-label"), "TIR 80.0%, TAR 15.0%, TBR 5.0%");
});

test("public-demo data connection leaves analytics before accepting private connection fields", () => {
  const entryStart = app.indexOf("function handleDataSourceEntry");
  const entryEnd = app.indexOf("function setupDataSourceFoundation", entryStart);
  const entryHandler = app.slice(entryStart, entryEnd);
  const opened = [];
  const opener = { id: "dataSourceButton" };
  const context = {
    window: { location: { href: "https://example.test/" } },
    document: { activeElement: null },
    isUserDataSourceMode: () => false,
    buildUserModeUrl: () => "https://example.test/?mode=user#glucose",
    hasActiveDataSource: () => false,
    openDataSourceDialog: (options) => opened.push(options)
  };
  vm.runInNewContext(`${entryHandler}\nthis.runEntry = handleDataSourceEntry;`, context);

  context.runEntry({ currentTarget: opener });
  assert.equal(context.window.location.href, "https://example.test/?mode=user#glucose");
  assert.deepEqual(opened, []);

  context.isUserDataSourceMode = () => true;
  context.runEntry({ currentTarget: opener });
  assert.equal(opened.length, 1);
  assert.equal(opened[0].required, true);
  assert.equal(opened[0].opener, opener);
});

test("a late result from a replaced data-source adapter cannot update the new connection", async () => {
  const latestStart = app.indexOf("async function loadLatestGlucose");
  const latestEnd = app.indexOf("async function loadTreatmentEvents", latestStart);
  const latestHandler = app.slice(latestStart, latestEnd);
  const dailyStart = app.indexOf("async function loadDailyStats");
  const dailyEnd = app.indexOf("function updateClock", dailyStart);
  const dailyHandler = app.slice(dailyStart, dailyEnd);

  assert.match(dailyHandler, /const requestedAdapter = activeDataSourceAdapter/);
  assert.match(dailyHandler, /requestedAdapter !== activeDataSourceAdapter/);
  assert.match(dailyHandler, /loadLatestGlucose\(requestedAdapter, isStaleRequest\)/);
  assert.match(dailyHandler, /loadDeviceStatus\(requestedAdapter\)/);
  assert.match(
    dailyHandler,
    /fetchEntriesInRange\(rangeStart, rangeEnd, periodRange\.count, requestedAdapter\)/
  );
  assert.match(dailyHandler, /loadTreatmentEvents\(rangeStart, rangeEnd, requestedAdapter\)/);
  assert.ok(
    latestHandler.indexOf("if (isStaleRequest()) return null;")
      < latestHandler.indexOf("evaluateLatestUnicornEncounter")
  );

  const firstGuard = dailyHandler.indexOf("if (isStaleRequest()) return;");
  const deviceRequest = dailyHandler.indexOf("loadDeviceStatus(requestedAdapter)");
  const secondGuard = dailyHandler.indexOf("if (isStaleRequest()) return;", firstGuard + 1);
  const firstUiMutation = dailyHandler.indexOf("updateHealthBar(latest, deviceStatus");
  const rangeRequests = dailyHandler.indexOf("await Promise.all([");
  const thirdGuard = dailyHandler.indexOf("if (isStaleRequest()) return;", secondGuard + 1);
  const chartMutation = dailyHandler.indexOf("drawGlucoseChart(entries");
  assert.ok(firstGuard < deviceRequest);
  assert.ok(deviceRequest < secondGuard && secondGuard < firstUiMutation);
  assert.ok(rangeRequests < thirdGuard && thirdGuard < chartMutation);

  let resolveOldRequest;
  let fetchCount = 0;
  let activeAdapter;
  const oldAdapter = {
    fetchLatest() {
      fetchCount += 1;
      return new Promise((resolve) => {
        resolveOldRequest = resolve;
      });
    }
  };
  const replacementAdapter = { kind: "replacement-adapter" };
  activeAdapter = oldAdapter;

  const effects = [];
  const guardedElement = new Proxy({}, {
    set(_target, property, value) {
      effects.push({ type: "dom", property: String(property), value });
      return true;
    }
  });
  const recordEffect = (type) => () => { effects.push({ type }); };
  const context = {
    currentLanguage: "ja",
    directionMap: { Flat: "→" },
    document: { getElementById: () => guardedElement },
    requireActiveDataSourceAdapter: () => activeAdapter,
    updateCurrentGlucoseColor: recordEffect("glucose-color"),
    updateGlucoseDelta: recordEffect("glucose-delta"),
    updateCurrentGlucosePeek: recordEffect("glucose-peek"),
    updateRangeStatus: recordEffect("range-status"),
    updateHeaderUpdated: recordEffect("header-updated"),
    updateHealthBar: recordEffect("health-bar"),
    setLiveStatus: recordEffect("live-status"),
    evaluateLatestUnicornEncounter: recordEffect("memory-evaluation"),
    renderUnicornGlucoDecision: recordEffect("memory-storage"),
    getLocalDateKey: () => "2026-08-12",
    getActiveDataSourceLabel: () => "Gluroo",
    formatDateTime: () => "formatted",
    t: (key) => key
  };
  vm.runInNewContext(`${latestHandler}\nthis.runLatest = loadLatestGlucose;`, context);

  const pending = context.runLatest(oldAdapter, () => activeAdapter !== oldAdapter);
  activeAdapter = replacementAdapter;
  resolveOldRequest({
    data: [{ sgv: 123, date: Date.now(), direction: "Flat" }]
  });

  assert.equal(await pending, null);
  assert.equal(fetchCount, 1);
  assert.deepEqual(effects, []);
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
  assert.match(index, /js\/usage-client\.js\?v=20260812-stale-profile-recovery-1/);
  assert.match(index, /style\.css\?v=20260812-early-access-1/);
  assert.match(index, /js\/app\.js\?v=20260812-warmer-gluco-1/);
  assert.match(app, /updateUsageProfileDisplayName\(result\.profile\.displayName\)/);
  assert.doesNotMatch(app, /handleLocalProfileDelete|localProfileDeleteButton/);
  assert.match(app, /if \(!state\.enabled \|\| !state\.registered\) return;/);
});
