(function initializeGlucoScopePlusFeatures(root) {
  "use strict";

  const FEATURE_SEVEN_DAY_RANGE = "seven_day_range";
  const FEATURE_THIRTY_DAY_RANGE = "thirty_day_range";
  const FEATURE_CUSTOM_RANGE = "custom_range";
  const FEATURE_DEEP_ANALYSIS = "deep_analysis";
  const FEATURE_SHARE_STUDIO = "share_studio";
  const PLUS_ONLY_FEATURES = new Set([
    FEATURE_SEVEN_DAY_RANGE,
    FEATURE_THIRTY_DAY_RANGE,
    FEATURE_CUSTOM_RANGE,
    FEATURE_DEEP_ANALYSIS
  ]);
  const KNOWN_FEATURES = new Set([...PLUS_ONLY_FEATURES, FEATURE_SHARE_STUDIO]);
  const SIGNED_OUT_REASONS = new Set([
    "not_signed_in",
    "signed_out",
    "invalid_session"
  ]);

  let configuration = Object.freeze({
    enforcementEnabled: false,
    entitlementStateProvider: null
  });

  function normalizeEntitlementState(input) {
    if (!input || typeof input !== "object") {
      return Object.freeze({
        status: "unavailable",
        accountVerified: false,
        plusActive: false,
        shareStudioTrialAvailable: false
      });
    }

    const reason = String(input.reason || "");
    const status = input.status === "ready"
      ? "ready"
      : input.status === "signed_out" || SIGNED_OUT_REASONS.has(reason)
        ? "signed_out"
        : "unavailable";
    return Object.freeze({
      status,
      accountVerified: status === "ready" && input.accountVerified === true,
      plusActive: status === "ready" && input.plusActive === true,
      shareStudioTrialAvailable:
        status === "ready" && input.shareStudioTrialAvailable === true
    });
  }

  function readEntitlementState() {
    const provider = configuration.entitlementStateProvider;
    if (typeof provider !== "function") return normalizeEntitlementState(null);

    try {
      const value = provider();
      // Access checks are intentionally synchronous. A future account client should
      // cache its server-verified state, then return that snapshot from this provider.
      if (value && typeof value.then === "function") return normalizeEntitlementState(null);
      return normalizeEntitlementState(value);
    } catch (error) {
      return normalizeEntitlementState(null);
    }
  }

  function configure(options = {}) {
    configuration = Object.freeze({
      enforcementEnabled: options.enforcementEnabled === true,
      entitlementStateProvider:
        typeof options.entitlementStateProvider === "function"
          ? options.entitlementStateProvider
          : null
    });
    return getConfiguration();
  }

  function getConfiguration() {
    return Object.freeze({
      enforcementEnabled: configuration.enforcementEnabled,
      hasEntitlementStateProvider: typeof configuration.entitlementStateProvider === "function"
    });
  }

  function allow(feature, accessMode, reason) {
    return Object.freeze({ allowed: true, feature, accessMode, reason });
  }

  function deny(feature, reason) {
    return Object.freeze({ allowed: false, feature, accessMode: "none", reason });
  }

  function getAccess(feature) {
    const normalizedFeature = String(feature || "");

    // This is the rollout safety switch. While disabled, every current feature keeps
    // its existing behavior and no entitlement data is required.
    if (!configuration.enforcementEnabled) {
      return allow(normalizedFeature, "legacy", "enforcement_disabled");
    }

    if (!KNOWN_FEATURES.has(normalizedFeature)) {
      return deny(normalizedFeature, "unknown_feature");
    }

    const state = readEntitlementState();
    if (state.status === "signed_out") {
      return deny(
        normalizedFeature,
        normalizedFeature === FEATURE_SHARE_STUDIO
          ? "verified_account_required"
          : "plus_required"
      );
    }
    if (state.status !== "ready") return deny(normalizedFeature, "entitlement_unavailable");

    if (state.plusActive) return allow(normalizedFeature, "plus", "active_plus");

    if (PLUS_ONLY_FEATURES.has(normalizedFeature)) {
      return deny(normalizedFeature, "plus_required");
    }

    if (!state.accountVerified) {
      return deny(normalizedFeature, "verified_account_required");
    }

    if (state.shareStudioTrialAvailable) {
      // This decision only selects the trial path. The future Share Studio client must
      // reserve and complete the one-time trial on the server after successful output.
      return allow(normalizedFeature, "trial", "verified_trial_available");
    }

    return deny(normalizedFeature, "plus_required");
  }

  root.GlucoScopePlusFeatures = Object.freeze({
    FEATURE_SEVEN_DAY_RANGE,
    FEATURE_THIRTY_DAY_RANGE,
    FEATURE_CUSTOM_RANGE,
    FEATURE_DEEP_ANALYSIS,
    FEATURE_SHARE_STUDIO,
    configure,
    getConfiguration,
    getAccess,
    _testing: Object.freeze({ normalizeEntitlementState })
  });
})(typeof window !== "undefined" ? window : globalThis);
