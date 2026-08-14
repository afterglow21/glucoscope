(function initializeGlucoScopePlusEntitlement(root) {
  "use strict";

  const STORAGE_KEY = "glucoscope.plusSession.v1";
  const SCHEMA_VERSION = 1;
  const DEFAULT_TIMEOUT_MS = 10_000;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
  const VERIFICATION_GRANT_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
  const CODE_PATTERN = /^\d{6}$/u;
  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

  let configuration = Object.freeze({
    enabled: false,
    endpoint: "",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    fetchImpl: null
  });
  let state = unavailableState("not_configured");
  let operationEpoch = 0;
  let verificationGrant = "";

  function clearVerificationGrant() {
    verificationGrant = "";
  }

  function unavailableState(reason = "unavailable") {
    return Object.freeze({
      status: "unavailable",
      accountVerified: false,
      plusActive: false,
      purchasePending: false,
      startsAt: null,
      endsAt: null,
      shareStudioTrialAvailable: false,
      reason
    });
  }

  function loadingState() {
    return Object.freeze({
      status: "loading",
      accountVerified: false,
      plusActive: false,
      purchasePending: false,
      startsAt: null,
      endsAt: null,
      shareStudioTrialAvailable: false,
      reason: "loading"
    });
  }

  function normalizeReadyState(input) {
    if (!input || typeof input !== "object") return null;
    const source = input.session && typeof input.session === "object"
      ? input.session
      : input;
    if (source.status !== "ready" || source.accountVerified !== true) return null;

    const plusActive = source.plusActive === true;
    const startsAt = plusActive && Number.isSafeInteger(source.startsAt)
      ? source.startsAt
      : null;
    const endsAt = plusActive && Number.isSafeInteger(source.endsAt)
      ? source.endsAt
      : null;
    if (plusActive && (
      startsAt === null
      || endsAt === null
      || startsAt < 0
      || endsAt <= startsAt
    )) return null;

    return Object.freeze({
      status: "ready",
      accountVerified: true,
      plusActive,
      purchasePending: !plusActive && source.purchasePending === true,
      startsAt,
      endsAt,
      shareStudioTrialAvailable:
        !plusActive && source.shareStudioTrialAvailable === true,
      reason: "verified"
    });
  }

  function normalizeEndpoint(value) {
    const text = String(value || "").trim().replace(/\/+$/u, "");
    if (!text) return "";
    try {
      const url = new URL(text);
      const local = url.protocol === "http:"
        && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
      if (url.origin !== text || (url.protocol !== "https:" && !local)) return "";
      return url.origin;
    } catch (error) {
      return "";
    }
  }

  function getStorage() {
    try {
      const storage = root?.localStorage;
      return storage
        && typeof storage.getItem === "function"
        && typeof storage.setItem === "function"
        && typeof storage.removeItem === "function"
        ? storage
        : null;
    } catch (error) {
      return null;
    }
  }

  function readStoredToken() {
    const storage = getStorage();
    if (!storage) return { ok: false, token: "", error: "storage_unavailable" };
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (raw === null) return { ok: true, token: "", error: null };
      const parsed = JSON.parse(raw);
      const token = String(parsed?.sessionToken || "");
      if (parsed?.schemaVersion !== SCHEMA_VERSION || !TOKEN_PATTERN.test(token)) {
        return { ok: false, token: "", error: "invalid_session" };
      }
      return { ok: true, token, error: null };
    } catch (error) {
      return { ok: false, token: "", error: "invalid_session" };
    }
  }

  function writeStoredToken(token) {
    const storage = getStorage();
    if (!storage || !TOKEN_PATTERN.test(String(token || ""))) {
      return { ok: false, error: "storage_unavailable" };
    }
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        sessionToken: token
      }));
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: "storage_write_failed" };
    }
  }

  function removeStoredToken() {
    operationEpoch += 1;
    clearVerificationGrant();
    state = unavailableState("signed_out");
    const storage = getStorage();
    if (!storage) return { ok: false, error: "storage_unavailable" };
    try {
      storage.removeItem(STORAGE_KEY);
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: "storage_remove_failed" };
    }
  }

  function publicState() {
    return Object.freeze({
      status: state.status,
      accountVerified: state.accountVerified,
      plusActive: state.plusActive,
      purchasePending: state.purchasePending,
      startsAt: state.startsAt,
      endsAt: state.endsAt,
      shareStudioTrialAvailable: state.shareStudioTrialAvailable,
      reason: state.reason
    });
  }

  function hasStoredSession() {
    const stored = readStoredToken();
    return stored.ok && Boolean(stored.token);
  }

  function configurationError() {
    if (!configuration.enabled) return "plus_disabled";
    if (!configuration.endpoint) return "plus_endpoint_unavailable";
    return "";
  }

  async function requestJson(path, {
    method = "GET",
    body,
    token,
    timeoutMs = configuration.timeoutMs
  } = {}) {
    const configError = configurationError();
    if (configError) return { ok: false, status: 0, error: configError };

    const fetchImpl = configuration.fetchImpl || root?.fetch;
    if (typeof fetchImpl !== "function") {
      return { ok: false, status: 0, error: "network_unavailable" };
    }

    const controller = new AbortController();
    const timeout = root.setTimeout(() => controller.abort("request_timeout"), timeoutMs);
    const headers = new Headers({ Accept: "application/json" });
    if (body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    try {
      const response = await fetchImpl(`${configuration.endpoint}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        mode: "cors",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        return { ok: false, status: response.status, error: "invalid_response" };
      }
      if (!response.ok || payload?.ok !== true) {
        return {
          ok: false,
          status: response.status,
          error: String(payload?.error || "request_failed")
        };
      }
      return { ok: true, status: response.status, payload };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        error: controller.signal.aborted ? "request_timeout" : "network_error"
      };
    } finally {
      root.clearTimeout(timeout);
    }
  }

  function normalizeEmail(value) {
    const raw = String(value || "").trim();
    const separator = raw.lastIndexOf("@");
    if (separator <= 0 || separator !== raw.indexOf("@")) return "";
    const email = `${raw.slice(0, separator)}@${raw.slice(separator + 1).toLowerCase()}`;
    return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : "";
  }

  async function configure(options = {}) {
    const timeoutMs = Number(options.timeoutMs);
    configuration = Object.freeze({
      enabled: options.enabled === true,
      endpoint: normalizeEndpoint(options.endpoint),
      timeoutMs: Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 30_000
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS,
      fetchImpl: typeof options.fetchImpl === "function" ? options.fetchImpl : null
    });
    operationEpoch += 1;
    clearVerificationGrant();
    state = unavailableState(configuration.enabled ? "not_signed_in" : "not_configured");
    return publicState();
  }

  async function refresh() {
    const epoch = ++operationEpoch;
    const stored = readStoredToken();
    if (!stored.ok || !stored.token) {
      if (stored.error === "invalid_session") removeStoredToken();
      state = unavailableState(stored.error || "not_signed_in");
      return { ok: false, state: publicState(), error: state.reason };
    }

    state = loadingState();
    const result = await requestJson("/v1/session", { token: stored.token });
    if (epoch !== operationEpoch) return { ok: false, skipped: true, state: publicState() };
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) removeStoredToken();
      else state = unavailableState(result.error);
      return { ok: false, state: publicState(), error: result.error };
    }

    const next = normalizeReadyState(result.payload);
    if (!next) {
      state = unavailableState("invalid_response");
      return { ok: false, state: publicState(), error: "invalid_response" };
    }
    state = next;
    return { ok: true, state: publicState(), error: null };
  }

  async function requestCode({ email, turnstileToken } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const token = String(turnstileToken || "");
    if (!normalizedEmail || !token || token.length > 4096) {
      return { ok: false, error: "invalid_request" };
    }
    const epoch = ++operationEpoch;
    clearVerificationGrant();
    const result = await requestJson("/v1/auth/request-code", {
      method: "POST",
      body: { email: normalizedEmail, turnstileToken: token }
    });
    if (epoch !== operationEpoch) return { ok: false, skipped: true };
    const grant = String(result.payload?.verificationGrant || "");
    if (!result.ok || result.payload?.status !== "code_sent") {
      return { ok: false, error: result.error || "request_failed" };
    }
    if (!VERIFICATION_GRANT_PATTERN.test(grant)) {
      return { ok: false, error: "invalid_response" };
    }
    verificationGrant = grant;
    return { ok: true, status: "code_sent", error: null };
  }

  async function verifyCode({ email, code } = {}) {
    const normalizedEmail = normalizeEmail(email);
    const normalizedCode = String(code || "").trim();
    if (!normalizedEmail || !CODE_PATTERN.test(normalizedCode)) {
      return { ok: false, error: "invalid_request" };
    }
    if (!VERIFICATION_GRANT_PATTERN.test(verificationGrant)) {
      return { ok: false, error: "verification_grant_required" };
    }

    const epoch = ++operationEpoch;
    const grant = verificationGrant;
    const result = await requestJson("/v1/auth/verify", {
      method: "POST",
      body: {
        email: normalizedEmail,
        code: normalizedCode,
        verificationGrant: grant
      }
    });
    if (epoch !== operationEpoch) return { ok: false, skipped: true };
    const sessionToken = String(result.payload?.sessionToken || "");
    const verifiedResponse = result.ok && result.payload?.status === "verified";
    if (verifiedResponse) clearVerificationGrant();
    const next = verifiedResponse
      ? normalizeReadyState(result.payload)
      : null;
    if (!result.ok || !TOKEN_PATTERN.test(sessionToken) || !next) {
      state = unavailableState(result.error || "invalid_response");
      return { ok: false, error: state.reason };
    }

    const stored = writeStoredToken(sessionToken);
    if (!stored.ok) {
      await requestJson("/v1/auth/logout", { method: "POST", token: sessionToken });
      state = unavailableState(stored.error);
      return { ok: false, error: stored.error };
    }
    state = next;
    return { ok: true, status: "verified", state: publicState(), error: null };
  }

  async function logout() {
    const stored = readStoredToken();
    removeStoredToken();
    if (stored.ok && stored.token && configuration.enabled && configuration.endpoint) {
      await requestJson("/v1/auth/logout", { method: "POST", token: stored.token });
    }
    return { ok: true, status: "signed_out", state: publicState() };
  }

  async function deleteAccount({ turnstileToken } = {}) {
    clearVerificationGrant();
    const stored = readStoredToken();
    const safetyToken = String(turnstileToken || "");
    if (!stored.ok || !stored.token) return { ok: false, error: "not_signed_in" };
    if (!safetyToken || safetyToken.length > 4096) {
      return { ok: false, error: "turnstile_required" };
    }
    const result = await requestJson("/v1/account/delete", {
      method: "POST",
      token: stored.token,
      body: { turnstileToken: safetyToken, confirmDelete: true }
    });
    if (!result.ok || result.payload?.status !== "account_deleted") {
      return {
        ok: false,
        status: result.status,
        error: result.error || "request_failed"
      };
    }
    removeStoredToken();
    return { ok: true, status: "account_deleted", state: publicState(), error: null };
  }

  async function createCheckout() {
    const stored = readStoredToken();
    if (!stored.ok || !stored.token) return { ok: false, error: "not_signed_in" };
    const requestId = root?.crypto?.randomUUID?.();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(String(requestId || ""))) {
      return { ok: false, error: "checkout_unavailable" };
    }
    const result = await requestJson("/v1/plus/checkout", {
      method: "POST",
      token: stored.token,
      body: { requestId }
    });
    if (!result.ok) return { ok: false, error: result.error };
    const urlText = String(result.payload?.checkoutUrl || "");
    try {
      const url = new URL(urlText);
      if (url.protocol !== "https:" || url.hostname !== "checkout.stripe.com") {
        return { ok: false, error: "invalid_checkout_url" };
      }
      return { ok: true, url: url.href, error: null };
    } catch (error) {
      return { ok: false, error: "invalid_checkout_url" };
    }
  }

  root.GlucoScopePlusEntitlement = Object.freeze({
    configure,
    refresh,
    requestCode,
    verifyCode,
    logout,
    deleteAccount,
    createCheckout,
    getState: publicState,
    hasStoredSession,
    clear: removeStoredToken,
    _testing: Object.freeze({
      STORAGE_KEY,
      normalizeEndpoint,
      normalizeEmail,
      normalizeReadyState,
      readStoredToken
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
