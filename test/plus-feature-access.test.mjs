import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/plus-feature-access.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const style = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");

function loadModule() {
  const context = { Object, Set, String };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: "plus-feature-access.js" });
  return context.GlucoScopePlusFeatures;
}

test("the rollout switch defaults off and preserves every current feature path", () => {
  const api = loadModule();

  assert.deepEqual(
    { ...api.getConfiguration() },
    { enforcementEnabled: false, hasEntitlementStateProvider: false }
  );
  assert.equal(api.getAccess(api.FEATURE_CUSTOM_RANGE).allowed, true);
  assert.equal(api.getAccess(api.FEATURE_CUSTOM_RANGE).accessMode, "legacy");
  assert.equal(api.getAccess(api.FEATURE_SEVEN_DAY_RANGE).allowed, true);
  assert.equal(api.getAccess(api.FEATURE_THIRTY_DAY_RANGE).allowed, true);
  assert.equal(api.getAccess(api.FEATURE_DEEP_ANALYSIS).allowed, true);
  assert.equal(api.getAccess(api.FEATURE_SHARE_STUDIO).allowed, true);
});

test("extended graph ranges and detailed analysis require active Plus", () => {
  const api = loadModule();
  let state = {
    status: "ready",
    accountVerified: true,
    plusActive: false,
    shareStudioTrialAvailable: true
  };
  api.configure({ enforcementEnabled: true, entitlementStateProvider: () => state });

  for (const [feature, expectedName] of [
    [api.FEATURE_SEVEN_DAY_RANGE, "seven_day_range"],
    [api.FEATURE_THIRTY_DAY_RANGE, "thirty_day_range"],
    [api.FEATURE_CUSTOM_RANGE, "custom_range"],
    [api.FEATURE_DEEP_ANALYSIS, "deep_analysis"]
  ]) {
    assert.deepEqual(
      { ...api.getAccess(feature) },
      {
        allowed: false,
        feature: expectedName,
        accessMode: "none",
        reason: "plus_required"
      }
    );
  }

  state = { ...state, plusActive: true };
  for (const feature of [
    api.FEATURE_SEVEN_DAY_RANGE,
    api.FEATURE_THIRTY_DAY_RANGE,
    api.FEATURE_CUSTOM_RANGE,
    api.FEATURE_DEEP_ANALYSIS
  ]) {
    assert.equal(api.getAccess(feature).accessMode, "plus");
  }
});

test("Share Studio selects Plus or one verified-account trial without consuming it locally", () => {
  const api = loadModule();
  let state = {
    status: "ready",
    accountVerified: true,
    plusActive: false,
    shareStudioTrialAvailable: true
  };
  api.configure({ enforcementEnabled: true, entitlementStateProvider: () => state });

  const trial = api.getAccess(api.FEATURE_SHARE_STUDIO);
  assert.equal(trial.allowed, true);
  assert.equal(trial.accessMode, "trial");
  assert.equal(state.shareStudioTrialAvailable, true);

  state = { ...state, shareStudioTrialAvailable: false };
  assert.equal(api.getAccess(api.FEATURE_SHARE_STUDIO).allowed, false);
  assert.equal(api.getAccess(api.FEATURE_SHARE_STUDIO).reason, "plus_required");

  state = { ...state, accountVerified: false, shareStudioTrialAvailable: true };
  assert.equal(api.getAccess(api.FEATURE_SHARE_STUDIO).reason, "verified_account_required");

  state = { ...state, plusActive: true };
  assert.equal(api.getAccess(api.FEATURE_SHARE_STUDIO).accessMode, "plus");
});

test("signed-out visitors receive normal Plus and verification guidance instead of an outage", () => {
  const api = loadModule();
  for (const reason of ["not_signed_in", "signed_out", "invalid_session"]) {
    api.configure({
      enforcementEnabled: true,
      entitlementStateProvider: () => ({ status: "unavailable", reason })
    });
    assert.equal(api.getAccess(api.FEATURE_SEVEN_DAY_RANGE).reason, "plus_required");
    assert.equal(api.getAccess(api.FEATURE_DEEP_ANALYSIS).reason, "plus_required");
    assert.equal(api.getAccess(api.FEATURE_SHARE_STUDIO).reason, "verified_account_required");
  }
});

test("missing, throwing, asynchronous, or malformed entitlement state fails closed", () => {
  const api = loadModule();
  const providers = [
    null,
    () => { throw new Error("offline"); },
    () => Promise.resolve({ status: "ready", plusActive: true }),
    () => ({ status: "loading", plusActive: true }),
    () => ({ status: "ready", plusActive: "true" })
  ];

  for (const entitlementStateProvider of providers) {
    api.configure({ enforcementEnabled: true, entitlementStateProvider });
    const decision = api.getAccess(api.FEATURE_CUSTOM_RANGE);
    assert.equal(decision.allowed, false);
    assert.ok(["entitlement_unavailable", "plus_required"].includes(decision.reason));
  }

  api.configure({
    enforcementEnabled: true,
    entitlementStateProvider: () => ({
      status: "ready",
      plusActive: true,
      email: "must-not-leak@example.test",
      paymentReference: "must-not-leak"
    })
  });
  assert.deepEqual(Object.keys(api.getAccess(api.FEATURE_CUSTOM_RANGE)).sort(), [
    "accessMode",
    "allowed",
    "feature",
    "reason"
  ]);
});

test("the frontend loads the access module first and gates extended ranges and detailed analysis", () => {
  assert.match(index, /id="plusFeatureNotice"[^>]*role="status"[^>]*hidden/);
  assert.ok(index.indexOf("js/plus-feature-access.js") < index.indexOf("js/app.js"));
  assert.match(index, /name="glucoscope-plus-feature-gating-enabled" content="true"/u);
  assert.match(app, /meta\[name="glucoscope-plus-feature-gating-enabled"\]/u);
  assert.match(app, /configurePlusFeatureGating\(\);[\s\S]*setupPeriodSwitch\(\);/);
  assert.match(
    app,
    /if \(!canUseGraphPeriod\(nextPeriod, \{ announce: true \}\)\) return;/
  );
  assert.match(
    app,
    /applyButton\.addEventListener\("click", \(\) => \{\s*if \(!canUseCustomRange\(\{ announce: true \}\)\) return;/s
  );
  assert.match(
    app,
    /if \(!canUseGraphPeriod\(periodKey\)\) \{\s*return getLivePeriodRange\("today", now\);/s
  );
  assert.match(app, /FEATURE_DEEP_ANALYSIS \|\| "deep_analysis"/);
  assert.match(app, /if \(!setAiLetterMode\(analysisMode, \{ announce: true \}\)\) return;/);
  assert.match(app, /plusDeepAnalysisRequired/);
  assert.match(app, /plusExtendedRangeRequired: "7日・30日・カスタムはPlus機能です。\\n購入は「その他」→「Plus・あなたの設定」へ。"/u);
  assert.match(style, /\.plus-feature-notice\s*\{[^}]*white-space:pre-line/su);
  assert.match(index, /data-period="seven"[\s\S]*?plus-feature-badge[^>]*>Plus</u);
  assert.match(index, /data-period="thirty"[\s\S]*?plus-feature-badge[^>]*>Plus</u);
  assert.match(index, /data-period="custom"[\s\S]*?plus-feature-badge[^>]*>Plus</u);
  assert.match(index, /id="aiModeDeepToggle"[\s\S]*?plus-feature-badge[^>]*>Plus</u);
  assert.match(index, /id="aiModePlusNotice"[^>]*role="status"[^>]*hidden/u);
  assert.match(app, /setInlinePlusNotice\("aiModePlusNotice", "plusDeepAnalysisRequired"/u);
  assert.match(app, /AI分析を試す（2回目からPlus）/u);
  assert.match(app, /もう一度AI分析（Plus）/u);
  assert.match(app, /保存済みの分析を見る（回数に含みません）/u);
  assert.match(
    app,
    /access\.reason === "verified_account_required"[\s\S]*openShareStudioTrialDialog\(event\?\.currentTarget \|\| document\.activeElement\)/u
  );
});

test("a fresh saved gentle analysis is shown before any Turnstile or quota request", () => {
  const handlerStart = app.indexOf("async function handleAiLetterRequest");
  const handlerEnd = app.indexOf("function exposeLetterControlGlobals", handlerStart);
  const handler = app.slice(handlerStart, handlerEnd);
  const cacheRead = handler.indexOf("getFreshCachedAiLetter");
  const turnstilePrep = handler.indexOf("prepareAiLetterTurnstile");
  const quotaContext = handler.indexOf("createAiLetterQuotaRequestContext");

  assert.ok(cacheRead >= 0);
  assert.ok(cacheRead < turnstilePrep);
  assert.ok(turnstilePrep < quotaContext);
  assert.match(
    handler,
    /if \(cached\) \{[\s\S]*setAiLetterPanelStatus\("aiLetterStatusFreshCache", "success"\);[\s\S]*return;\s*\}/u
  );
});
