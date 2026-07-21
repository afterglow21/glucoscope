(function loadGlucoScopeAnalytics(root) {
  "use strict";

  const STORAGE_KEY = "glucoscope.dataSource.v1";
  const SESSION_STORAGE_KEY = "glucoscope.dataSource.session.v1";
  const ANALYTICS_URL = "https://static.cloudflareinsights.com/beacon.min.js";
  const ANALYTICS_TOKEN = "5dec761abbfe4147b1fecebc68f8e382";

  function storageContainsConnection(storageName, key) {
    try {
      const storage = root?.[storageName];
      if (!storage || typeof storage.getItem !== "function") return true;
      return Boolean(storage.getItem(key));
    } catch (error) {
      // Privacy-first fallback: if browser storage cannot be checked, do not load analytics.
      return true;
    }
  }

  function shouldDisableAnalytics() {
    try {
      const params = new URLSearchParams(root?.location?.search || "");
      if (params.get("mode") === "user") return true;
      if (/\/user\.html$/i.test(root?.location?.pathname || "")) return true;
    } catch (error) {
      return true;
    }

    return storageContainsConnection("localStorage", STORAGE_KEY)
      || storageContainsConnection("sessionStorage", SESSION_STORAGE_KEY);
  }

  if (shouldDisableAnalytics()) return;

  const documentRef = root?.document;
  if (!documentRef?.head || typeof documentRef.createElement !== "function") return;

  const analyticsScript = documentRef.createElement("script");
  analyticsScript.type = "module";
  analyticsScript.src = ANALYTICS_URL;
  analyticsScript.dataset.cfBeacon = JSON.stringify({ token: ANALYTICS_TOKEN });
  analyticsScript.referrerPolicy = "no-referrer";
  documentRef.head.appendChild(analyticsScript);
})(typeof window !== "undefined" ? window : globalThis);
