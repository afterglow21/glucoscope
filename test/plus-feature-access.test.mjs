import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../js/plus-feature-access.js", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");

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
  assert.match(app, /const PLUS_FEATURE_GATING_ENABLED = false;/);
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
});
