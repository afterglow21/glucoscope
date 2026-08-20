import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const index = await readFile(new URL("../index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
const css = await readFile(new URL("../style.css", import.meta.url), "utf8");
const localProfile = await readFile(new URL("../js/local-profile.js", import.meta.url), "utf8");
const usageClient = await readFile(new URL("../js/usage-client.js", import.meta.url), "utf8");

test("a missing relay asset never turns a saved Gluroo connection into a direct browser adapter", () => {
  const initializationEnd = app.indexOf("let dataRefreshTimer");
  assert.ok(initializationEnd > 0);
  let createAdapterCalls = 0;
  const context = {
    window: {
      GlucoScopeDataSource: {
        getActiveConfig: () => ({ provider: "gluroo", baseUrl: "https://saved.ns.gluroo.com" }),
        createAdapter: () => {
          createAdapterCalls += 1;
          return { unsafeDirectAdapter: true };
        }
      },
      GlucoScopeLocalProfile: null,
      GlucoScopeUsage: null,
      GlucoScopePlusEntitlement: null,
      GlucoScopePlusFeatures: null
    }
  };
  vm.runInNewContext(`
    ${app.slice(0, initializationEnd)}
    this.result = { activeDataSourceConfig, activeDataSourceAdapter };
  `, context);
  assert.equal(createAdapterCalls, 0);
  assert.equal(context.result.activeDataSourceConfig, null);
  assert.equal(context.result.activeDataSourceAdapter, null);
  assert.match(app, /savedConfig\.provider === "gluroo" && !isGlurooRelayClientAvailable\(\)/);
});

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
  assert.match(app, /const usageNoteKey = !USAGE_PROFILE_ENABLED\s*\? "dataSourceUsageNotePaused"\s*: !usageState\.registered && !shouldCreateNewUsageProfile\(getDataSourceBrowserContext\(\)\)\s*\? "dataSourceUsageNoteSafari"\s*: "dataSourceUsageNote";/s);
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

test("personal-user AI consent is explicit, versioned, and precedes any request", () => {
  const consentStart = app.indexOf("function hasAiLetterUserConsent");
  const consentEnd = app.indexOf("async function handleAiLetterRequest", consentStart);
  const consentSource = app.slice(consentStart, consentEnd);
  const stored = new Map();
  const calls = [];
  const statuses = [];
  const panel = { hidden: true };
  const title = { focus: () => calls.push("focus-title") };
  const aiButton = { focus: () => calls.push("focus-ai") };
  const context = {
    AI_LETTER_USER_CONSENT_STORAGE_KEY: "glucoscope.aiLetterUserConsent.v1",
    AI_LETTER_USER_CONSENT_VERSION: "2026-08-16-user-ai-quota-1",
    aiLetterUserConsentGrantedThisSession: false,
    pendingAiLetterModeAfterConsent: null,
    currentAiLetterMode: "letter",
    isUserDataSourceMode: () => true,
    normalizeAiLetterMode: (mode) => mode === "deep" ? "deep" : "letter",
    localStorage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    },
    document: {
      getElementById: (id) => ({
        aiLetterUserConsent: panel,
        aiLetterUserConsentTitle: title,
        aiLetterButton: aiButton
      })[id] || null
    },
    setAiLetterPanelStatus: (key) => statuses.push(key),
    handleAiLetterRequest: (...args) => calls.push(args),
    console: { warn: () => {} }
  };
  vm.runInNewContext(`${consentSource}\nthis.requestConsent=requestAiLetterUserConsent;this.acceptConsent=acceptAiLetterUserConsent;this.cancelConsent=cancelAiLetterUserConsent;`, context);

  assert.equal(context.requestConsent("deep"), true);
  assert.equal(panel.hidden, false);
  assert.deepEqual(statuses, ["aiLetterStatusConsentWaiting"]);
  assert.deepEqual(calls, ["focus-title"]);

  context.acceptConsent();
  assert.equal(panel.hidden, true);
  const saved = JSON.parse(stored.get("glucoscope.aiLetterUserConsent.v1"));
  assert.equal(saved.accepted, true);
  assert.equal(saved.version, "2026-08-16-user-ai-quota-1");
  assert.equal(calls[1], "focus-ai");
  assert.equal(calls[2][0], "deep");
  assert.equal(calls[2][1].skipUserConsent, true);
  assert.equal(context.requestConsent("letter"), false);

  context.aiLetterUserConsentGrantedThisSession = false;
  stored.delete("glucoscope.aiLetterUserConsent.v1");
  assert.equal(context.requestConsent("letter"), true);
  context.cancelConsent();
  assert.equal(panel.hidden, true);
  assert.equal(calls.at(-1), "focus-ai");
  assert.equal(statuses.at(-1), "aiLetterStatusConsentCancelled");

  context.localStorage.setItem = () => { throw new Error("storage unavailable"); };
  assert.equal(context.requestConsent("deep"), true);
  context.acceptConsent();
  assert.equal(calls.at(-2), "focus-ai");
  assert.equal(calls.at(-1)[0], "deep");
  assert.equal(context.requestConsent("letter"), false, "storage failure keeps consent for this session only");

  assert.match(index, /id="aiLetterUserConsent"[^>]*aria-labelledby="aiLetterUserConsentTitle"[^>]*hidden/);
  assert.match(index, /data-i18n-key="aiLetterUserConsentQuota"/u);
  assert.match(app, /成功したAI分析の日と回数だけを最大90日保存します。Freeはやさしい分析を1日1回、Plusはやさしい分析としっかり分析を合わせて1日5回まで/u);
  assert.match(index, /href="pages\/trust\/privacy-notes\.html#ai-letters"/);
  assert.match(css, /\.ai-letter-user-consent\[hidden\]\{\s*display:none;/);
  assert.match(css, /\.ai-letter-consent-actions \.letter-primary-button,[\s\S]*min-height:44px;/);
});

test("quota request context is inert while off, leaves the reviewed demo credential-free, and fails closed for unresolved user identities", () => {
  const start = app.indexOf("function createAiLetterQuotaRequestContext");
  const end = app.indexOf("function getAiLetterUsageDetailFromResponse", start);
  const helperSource = app.slice(start, end);
  assert.ok(start >= 0 && end > start);

  function runHelper({ enabled, userMode, manager }) {
    const context = { manager };
    vm.runInNewContext(`
      const AI_PER_USER_QUOTA_ENABLED = ${enabled};
      const usageProfileManager = this.manager;
      const isUserDataSourceMode = () => ${userMode};
      ${helperSource}
      this.result = createAiLetterQuotaRequestContext();
    `, context);
    return context.result;
  }

  const forbiddenManager = new Proxy({}, {
    get() { throw new Error("quota manager must not be read while disabled"); }
  });
  assert.deepEqual({ ...runHelper({ enabled: false, userMode: true, manager: forbiddenManager }) }, {
    ok: true,
    enabled: false
  });
  assert.deepEqual({ ...runHelper({ enabled: true, userMode: false, manager: forbiddenManager }) }, {
    ok: true,
    enabled: false,
    publicDemo: true
  });
  assert.equal(runHelper({ enabled: true, userMode: true, manager: null }).error, "quota_identity_required");

  const enabled = runHelper({
    enabled: true,
    userMode: true,
    manager: {
      createAiQuotaRequestContext() {
        return {
          ok: true,
          requestId: "123e4567-e89b-42d3-a456-426614174111",
          quotaCredentialKind: "account",
          authorization: `Bearer ${"B".repeat(43)}`
        };
      }
    }
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.quotaCredentialKind, "account");
  assert.equal(enabled.authorization, `Bearer ${"B".repeat(43)}`);
  assert.match(index, /name="glucoscope-ai-per-user-quota-enabled" content="true"/u);
  assert.match(app, /data\.cache\?\.status === "approved-demo-sample"[\s\S]*aiLetterStatusApprovedDemoSample/u);
});

test("stale AI responses cannot cross a summary, mode, or saved-connection boundary", async () => {
  const clearStart = app.indexOf("function clearDataSourceSpecificBrowserState");
  const clearEnd = app.indexOf("function buildUserModeUrl", clearStart);
  const summaryStart = app.indexOf("function setAiLetterSummary");
  const summaryEnd = app.indexOf("function updateAiLetterControls", summaryStart);
  const requestStart = app.indexOf("function getAiLetterRequestSummaryIdentity");
  const requestEnd = app.indexOf("function exposeLetterControlGlobals", requestStart);
  assert.ok(clearStart >= 0 && clearEnd > clearStart);
  assert.ok(summaryStart >= 0 && summaryEnd > summaryStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);

  const initialSummary = {
    pageMode: "glucoscope-user-foundation",
    language: "ja",
    period: "today",
    slot: "morning",
    cacheRangeKey: "source-a-range"
  };
  const nextSummary = {
    ...initialSummary,
    cacheRangeKey: "source-b-range"
  };
  const pendingFetches = [];
  const calls = {
    displayed: [],
    saved: [],
    usage: 0,
    errors: [],
    removed: [],
    turnstileResets: 0
  };
  const consentPanel = { hidden: false };
  let quotaRequestContext = { ok: true, enabled: false };
  const context = {
    initialSummary,
    AbortController,
    AI_LETTER_LOCAL_CACHE_STORAGE_KEY: "ai-cache-v14",
    AI_LETTER_USER_CONSENT_STORAGE_KEY: "ai-consent-v1",
    AI_LETTER_LEGACY_LOCAL_CACHE_STORAGE_KEYS: ["ai-cache-v13", "ai-cache-v12"],
    localStorage: {
      removeItem: (key) => calls.removed.push(key)
    },
    document: {
      getElementById: (id) => id === "aiLetterUserConsent" ? consentPanel : null
    },
    normalizeAiLetterMode: (mode) => mode === "deep" ? "deep" : "letter",
    getAiLetterLocalCacheKey: (summary, mode) => `${summary?.cacheRangeKey || "none"}|${mode}`,
    resetAiLetterTurnstile: () => { calls.turnstileResets += 1; },
    setAiLetterMode: () => true,
    isAiLetterWorkerEnabled: () => true,
    requestAiLetterUserConsent: () => false,
    getFreshCachedAiLetter: () => null,
    showAiLetterResult: (text) => { if (text) calls.displayed.push(text); },
    updateAiLetterControls: () => {},
    forceEnableAiLetterButtonSoon: () => {},
    prepareAiLetterTurnstile: () => false,
    createAiLetterQuotaRequestContext: () => quotaRequestContext,
    setAiLetterPanelStatus: (_key, type) => {
      if (type === "error") calls.errors.push("status-error");
    },
    getAiLetterWorkerEndpoint: () => "https://example.invalid/ai",
    getTurnstileTokenForAiLetter: () => "turnstile-token",
    isUserDataSourceMode: () => true,
    fetch: (_url, options) => new Promise((resolve) => {
      // Deliberately ignore abort here. The runtime generation/identity guard
      // must still reject a late response from a non-cooperative transport.
      pendingFetches.push({ resolve, options });
    }),
    getAiLetterTextFromResponse: (data) => data?.letter?.text || "",
    saveAiLetterLocalCache: (summary, _data, text) => calls.saved.push({ summary, text }),
    getAiLetterStatusKeyFromResponse: () => "aiLetterStatusSuccess",
    getAiLetterUsageDetailFromResponse: () => "",
    recordUsageProfileAiGenerationIfEligible: () => { calls.usage += 1; },
    getAiLetterErrorStatusKey: () => "aiLetterStatusError",
    showCachedAiLetter: () => false,
    setAiLetterPanelMessage: () => calls.errors.push("panel-error"),
    hasVisibleAiLetterResult: () => false,
    console: {
      warn: () => {},
      error: () => calls.errors.push("console-error")
    }
  };

  const clearSource = app.slice(clearStart, clearEnd);
  const summarySource = app.slice(summaryStart, summaryEnd);
  const requestSource = app.slice(requestStart, requestEnd);
  vm.runInNewContext(`
    let currentAiLetterMode = "letter";
    let latestAiLetterSummary = initialSummary;
    let aiLetterSummaryState = "ready";
    let aiLetterRequestGeneration = 0;
    let aiLetterRequestAbortController = null;
    let aiLetterRequestInFlight = false;
    let aiLetterUserConsentGrantedThisSession = true;
    let pendingAiLetterModeAfterConsent = "letter";
    ${clearSource}
    ${summarySource}
    ${requestSource}
    this.requestAi = handleAiLetterRequest;
    this.replaceSummary = (summary) => setAiLetterSummary(summary, "ready");
    this.forceCurrentModeForTest = (mode) => { currentAiLetterMode = mode; };
    this.clearConnectionState = clearDataSourceSpecificBrowserState;
    this.readRuntimeState = () => ({
      latestAiLetterSummary,
      aiLetterRequestInFlight,
      aiLetterUserConsentGrantedThisSession,
      pendingAiLetterModeAfterConsent
    });
  `, context);

  const successResponse = (text) => ({
    ok: true,
    json: async () => ({
      ok: true,
      status: "success",
      source: "openai",
      generation: { complete: true },
      cache: { status: "miss" },
      letter: { text, cached: false }
    })
  });

  const staleAfterReplacement = context.requestAi("letter", { skipUserConsent: true });
  await Promise.resolve();
  assert.equal(pendingFetches.length, 1);
  const legacyRequestBody = JSON.parse(pendingFetches[0].options.body);
  assert.equal(legacyRequestBody.summary.cacheRangeKey, "source-a-range");
  assert.deepEqual(Object.keys(legacyRequestBody), [
    "summary",
    "analysisMode",
    "turnstileToken",
    "client"
  ]);
  assert.deepEqual(Object.keys(pendingFetches[0].options.headers), ["Content-Type"]);
  assert.equal("Authorization" in pendingFetches[0].options.headers, false);
  context.replaceSummary(nextSummary);
  assert.equal(pendingFetches[0].options.signal.aborted, true);
  pendingFetches[0].resolve(successResponse("old source letter"));
  await staleAfterReplacement;
  assert.deepEqual(calls.displayed, []);
  assert.deepEqual(calls.saved, []);
  assert.equal(calls.usage, 0);
  assert.deepEqual(calls.errors, []);

  const staleAfterModeChange = context.requestAi("letter", { skipUserConsent: true });
  await Promise.resolve();
  assert.equal(pendingFetches.length, 2);
  // This bypasses the real mode setter's abort on purpose, proving that the
  // response-time current-mode guard independently rejects the old result.
  context.forceCurrentModeForTest("deep");
  assert.equal(pendingFetches[1].options.signal.aborted, false);
  pendingFetches[1].resolve(successResponse("wrong mode letter"));
  await staleAfterModeChange;
  assert.deepEqual(calls.displayed, []);
  assert.deepEqual(calls.saved, []);
  assert.equal(calls.usage, 0);
  assert.deepEqual(calls.errors, []);
  context.forceCurrentModeForTest("letter");

  const staleAfterDeletion = context.requestAi("letter", { skipUserConsent: true });
  await Promise.resolve();
  assert.equal(pendingFetches.length, 3);
  context.clearConnectionState();
  assert.equal(pendingFetches[2].options.signal.aborted, true);
  pendingFetches[2].resolve(successResponse("deleted source letter"));
  await staleAfterDeletion;
  assert.deepEqual(calls.displayed, []);
  assert.deepEqual(calls.saved, []);
  assert.equal(calls.usage, 0);
  assert.deepEqual(calls.errors, []);
  assert.deepEqual(calls.removed, [
    "ai-cache-v14",
    "ai-consent-v1",
    "ai-cache-v13",
    "ai-cache-v12"
  ]);
  assert.equal(consentPanel.hidden, true);
  assert.equal(context.readRuntimeState().aiLetterUserConsentGrantedThisSession, false);
  assert.equal(context.readRuntimeState().pendingAiLetterModeAfterConsent, null);

  quotaRequestContext = {
    ok: true,
    enabled: true,
    requestId: "123e4567-e89b-42d3-a456-426614174111",
    quotaCredentialKind: "device_profile",
    authorization: `Bearer ${"A".repeat(43)}`
  };
  const currentRequest = context.requestAi("letter", { skipUserConsent: true });
  await Promise.resolve();
  assert.equal(pendingFetches.length, 4);
  const quotaRequestBody = JSON.parse(pendingFetches[3].options.body);
  assert.equal(pendingFetches[3].options.headers.Authorization, `Bearer ${"A".repeat(43)}`);
  assert.equal(quotaRequestBody.requestId, "123e4567-e89b-42d3-a456-426614174111");
  assert.equal(quotaRequestBody.quotaCredentialKind, "device_profile");
  assert.equal(JSON.stringify(quotaRequestBody).includes("Bearer"), false);
  pendingFetches[3].resolve(successResponse("current source letter"));
  await currentRequest;
  assert.deepEqual(calls.displayed, ["current source letter"]);
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].summary.cacheRangeKey, "source-b-range");
  assert.equal(calls.usage, 1);
  assert.deepEqual(calls.errors, []);
  assert.equal(context.readRuntimeState().aiLetterRequestInFlight, false);

  const partialFailureAttempts = [];
  context.localStorage.removeItem = (key) => {
    partialFailureAttempts.push(key);
    if (key === "ai-cache-v14") throw new Error("one removal failed");
  };
  context.clearConnectionState();
  assert.deepEqual(partialFailureAttempts, [
    "ai-cache-v14",
    "ai-consent-v1",
    "ai-cache-v13",
    "ai-cache-v12"
  ]);
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
  assert.match(app, /dataSourceTestWaiting: "入力できたら、接続と保存をまとめて行います。"/);
  assert.match(app, /dataSourceUsageNoteSafari: "Safariでこのまま続ける場合、表示名はこのブラウザにだけ保存し、新しい利用記録は作りません。血糖値や接続情報も記録しません。"/);
  assert.match(app, /!usageState\.registered && !shouldCreateNewUsageProfile\(getDataSourceBrowserContext\(\)\)/);
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

  assert.doesNotMatch(activateHandler, /readRelaySession/);
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
    isGlurooRelayClientAvailable: () => true,
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
      isGlurooRelayClientAvailable: () => true,
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
  assert.match(app, /async function handleDataSourceDelete\(\) \{\s*if \(!dataSourceManager \|\| isDataSourceSaveBusy\(\) \|\| dataSourceDeleteInFlight\) return;[\s\S]*?invalidateAiLetterRequest\(\);\s*invalidateDataSourceTest\(\);\s*invalidatePendingDataSourceSave\(\);/);
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
  assert.ok((app.match(/if \(!isCurrentDataSourceTest\(generation\)\) return(?: false)?;/g) || []).length >= 3);
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
  assert.ok(requestHandler.indexOf("saveAiLetterLocalCache(requestState.summary, data") < requestHandler.indexOf("recordUsageProfileAiGenerationIfEligible(data)"));

  const recordStart = app.indexOf("function recordUsageProfileAiGenerationIfEligible");
  const recordEnd = app.indexOf("function createAiLetterQuotaRequestContext", recordStart);
  function loadRecorder(enabled) {
    const context = {
      calls: 0,
      getUsageProfileState: () => ({ enabled: true, registered: true, collectionEnabled: true }),
      Promise
    };
    context.usageProfileManager = {
      recordAiGeneration: () => { context.calls += 1; }
    };
    vm.runInNewContext(`
      const AI_PER_USER_QUOTA_ENABLED = ${enabled};
      ${app.slice(recordStart, recordEnd)}
      this.record=recordUsageProfileAiGenerationIfEligible;
    `, context);
    return context;
  }
  const success = {
    status: "success",
    source: "openai",
    generation: { complete: true },
    letter: { cached: false },
    cache: { status: "miss" }
  };
  const authoritative = loadRecorder(true);
  authoritative.record(success);
  authoritative.record({ ...success, quota: { authoritative: true, consumed: false } });
  authoritative.record({ ...success, quota: { authoritative: true, consumed: true } });
  authoritative.record({ ...success, cache: { status: "fresh" }, quota: { authoritative: true, consumed: true } });
  assert.equal(authoritative.calls, 1);

  const legacy = loadRecorder(false);
  legacy.record(success);
  assert.equal(legacy.calls, 1);
});

test("local display-name storage remains network-free and server sync is separate", () => {
  assert.doesNotMatch(localProfile, /\b(?:fetch|XMLHttpRequest|sendBeacon|WebSocket)\b/u);
  assert.match(index, /js\/local-profile\.js\?v=20260811-usage-profile-stage-1/);
  assert.match(index, /js\/usage-client\.js\?v=20260815-guardian-confirmation-1/);
  assert.match(index, /js\/plus-feature-access\.js\?v=20260820-plus-guidance-1/);
  assert.match(index, /style\.css\?v=20260820-share-trial-ui-1/);
  assert.match(index, /js\/app\.js\?v=20260820-share-trial-ui-1/);
  assert.match(app, /updateUsageProfileDisplayName\(result\.profile\.displayName\)/);
  assert.doesNotMatch(app, /handleLocalProfileDelete|localProfileDeleteButton/);
  assert.match(app, /if \(!state\.enabled \|\| !state\.registered\) return;/);
});
