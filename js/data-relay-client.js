(function initializeGlucoScopeDataRelay(root) {
  "use strict";

  const baseManager = root.GlucoScopeDataSource;
  if (!baseManager) return;

  // This key belongs to the retired one-hour bearer ticket. It is never read;
  // cleanup is kept so an older build cannot leave a credential-like value in
  // browser storage after the HttpOnly device-session migration.
  const LEGACY_SESSION_KEY = "glucoscope.dataRelay.session.v1";
  const LOCAL_ENDPOINT_STORAGE_KEY = "glucoscope.dataRelayEndpoint.v1";
  const RELAY_META_NAME = "glucoscope-data-relay-endpoint";
  const TURNSTILE_SITE_KEY = "0x4AAAAAADyftbRcWQW23mEa";
  const TURNSTILE_ACTION = "glucoscope-data-relay";
  const TURNSTILE_SCRIPT_ID = "glucoscope-turnstile-script";
  const TURNSTILE_CONTAINER_ID = "dataSourceRelayTurnstile";
  const TURNSTILE_CHALLENGE_TIMEOUT_MS = 15_000;
  const REQUEST_TIMEOUT_MS = 20_000;
  const MAX_RELAY_ENDPOINT_LENGTH = 2_048;

  let relayWidgetId = null;
  let pendingChallenge = null;
  let challengeGeneration = 0;
  let pendingPreparation = null;
  let pendingStatusProbe = null;
  let connectionGeneration = 0;
  let activeConnectionIdentity = "";
  let deviceSessionState = "unknown";
  let preparedConnectionTest = null;
  const activeRequestControllers = new Set();

  function createRelayError(code, message = code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
  }

  function normalizeTurnstileErrorCode(value) {
    const code = String(value ?? "").trim();
    return /^\d{6}$/u.test(code) ? code : "";
  }

  function normalizeRelayErrorCode(value) {
    const code = String(value ?? "").trim();
    return /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? code : "relay_unavailable";
  }

  function getStorage(name) {
    try {
      const storage = root?.[name];
      if (!storage || typeof storage.getItem !== "function") return null;
      return storage;
    } catch {
      return null;
    }
  }

  function cleanupLegacyRelaySession() {
    for (const storageName of ["localStorage", "sessionStorage"]) {
      try {
        getStorage(storageName)?.removeItem(LEGACY_SESSION_KEY);
      } catch {
        // Cleanup is best effort and must never make a saved connection unusable.
      }
    }
  }

  function isLocalHostname(hostname = root?.location?.hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "[::1]";
  }

  function normalizeRelayEndpoint(rawEndpoint) {
    const value = String(rawEndpoint || "").trim();
    if (!value) return "";
    if (value.length > MAX_RELAY_ENDPOINT_LENGTH) {
      throw createRelayError("relay_unavailable", "Relay endpoint is too long.");
    }

    let parsed;
    try {
      parsed = new URL(value);
    } catch (cause) {
      throw createRelayError("relay_unavailable", "Relay endpoint is invalid.", { cause });
    }

    const localHttp = parsed.protocol === "http:" && isLocalHostname(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttp) {
      throw createRelayError("relay_unavailable", "Relay endpoint must use HTTPS.");
    }
    if (parsed.username || parsed.password || parsed.hash) {
      throw createRelayError("relay_unavailable", "Relay endpoint is not allowed.");
    }

    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "");
    return parsed.toString().replace(/\/$/u, "");
  }

  function getRelayEndpoint() {
    let configured = "";

    if (typeof root.GLUCO_SCOPE_DATA_RELAY_ENDPOINT === "string") {
      configured = root.GLUCO_SCOPE_DATA_RELAY_ENDPOINT;
    }

    if (!configured && root?.document?.querySelector) {
      configured = root.document.querySelector(`meta[name="${RELAY_META_NAME}"]`)?.content || "";
    }

    if (isLocalHostname()) {
      try {
        const queryValue = new URLSearchParams(root.location.search || "").get("relayEndpoint");
        if (queryValue) configured = queryValue;
        else configured = getStorage("localStorage")?.getItem(LOCAL_ENDPOINT_STORAGE_KEY) || configured;
      } catch {
        // Keep the checked-in endpoint configuration.
      }
    }

    return normalizeRelayEndpoint(configured);
  }

  function getConnectionIdentity(config) {
    // This is memory-only and is never logged, returned, or written to storage.
    return `${config.baseUrl}\n${config.credential}`;
  }

  function abortActiveRelayRequests() {
    for (const controller of activeRequestControllers) {
      try {
        controller.abort();
      } catch {
        // Generation checks still reject a late response from an abort-ignoring fetch.
      }
    }
    activeRequestControllers.clear();
  }

  function invalidateConnectionWork(nextState = "unknown", { clearIdentity = false } = {}) {
    connectionGeneration += 1;
    abortActiveRelayRequests();
    pendingStatusProbe = null;
    pendingPreparation = null;
    preparedConnectionTest = null;
    resetRelayTurnstile();
    if (clearIdentity) activeConnectionIdentity = "";
    deviceSessionState = nextState;
    return connectionGeneration;
  }

  function activateConnection(config) {
    const identity = getConnectionIdentity(config);
    if (identity !== activeConnectionIdentity) {
      invalidateConnectionWork("unknown");
      activeConnectionIdentity = identity;
    }
    return { identity, generation: connectionGeneration };
  }

  function createDeviceSessionHint(status = deviceSessionState) {
    return Object.freeze({
      version: 2,
      authentication: "http-only-cookie",
      status
    });
  }

  // HttpOnly cookies intentionally cannot be inspected synchronously. This
  // method is a non-secret launch hint for the existing app bootstrap. A fresh
  // page returns "unknown" so it can start normally; the first relay request
  // performs a server-side status probe before requesting entries.
  function readRelaySession() {
    cleanupLegacyRelaySession();
    if (!getRelayEndpoint()) return null;
    if (["invalid", "source-mismatch", "revoking", "revoked"].includes(deviceSessionState)) {
      return null;
    }
    return createDeviceSessionHint();
  }

  function clearRelaySession() {
    cleanupLegacyRelaySession();
    invalidateConnectionWork("revoked", { clearIdentity: true });
  }

  function throwIfGenerationChanged(expectedGeneration) {
    if (Number.isInteger(expectedGeneration) && expectedGeneration !== connectionGeneration) {
      throw createRelayError("request_aborted");
    }
  }

  function throwIfRequestObsolete(expectedGeneration, signal) {
    throwIfGenerationChanged(expectedGeneration);
    if (signal?.aborted) throw createRelayError("request_aborted");
  }

  function awaitWithSignal(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(createRelayError("request_aborted"));

    return new Promise((resolve, reject) => {
      const onAbort = () => reject(createRelayError("request_aborted"));
      signal.addEventListener("abort", onAbort, { once: true });
      promise.then(
        (value) => {
          signal.removeEventListener?.("abort", onAbort);
          resolve(value);
        },
        (error) => {
          signal.removeEventListener?.("abort", onAbort);
          reject(error);
        }
      );
    });
  }

  async function requestRelayJson(path, payload, options = {}) {
    const endpoint = getRelayEndpoint();
    if (!endpoint) throw createRelayError("relay_unavailable");

    const fetchImpl = options.fetchImpl || root?.fetch || globalThis.fetch;
    if (typeof fetchImpl !== "function") throw createRelayError("relay_unavailable");

    const method = String(options.method || "POST").toUpperCase();
    const controller = new AbortController();
    const externalSignal = options.signal;
    const expectedGeneration = options.expectedGeneration;
    let timeoutTriggered = false;
    let externalAbortHandler = null;

    throwIfRequestObsolete(expectedGeneration, externalSignal);
    activeRequestControllers.add(controller);

    if (externalSignal) {
      if (externalSignal.aborted) controller.abort(externalSignal.reason);
      else if (typeof externalSignal.addEventListener === "function") {
        externalAbortHandler = () => controller.abort(externalSignal.reason);
        externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
      }
    }

    const timeout = root.setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS);

    try {
      const requestOptions = {
        method,
        credentials: "include",
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      };
      if (payload !== undefined) {
        requestOptions.headers = { "Content-Type": "application/json" };
        requestOptions.body = JSON.stringify(payload);
      }

      const response = await fetchImpl(`${endpoint}${path}`, requestOptions);
      throwIfRequestObsolete(expectedGeneration, externalSignal);

      let data = null;
      try {
        data = await response.json();
      } catch {
        throw createRelayError("relay_unavailable", "Relay returned an unreadable response.", {
          status: response.status
        });
      }
      throwIfRequestObsolete(expectedGeneration, externalSignal);

      if (!response.ok || data?.ok !== true) {
        const code = normalizeRelayErrorCode(data?.error);
        const turnstileErrorCode = code === "turnstile_failed"
          ? normalizeTurnstileErrorCode(data?.turnstileErrorCode)
          : "";
        throw createRelayError(code, code, {
          status: response.status,
          ...(turnstileErrorCode ? { turnstileErrorCode } : {})
        });
      }

      return { data, status: response.status, endpoint };
    } catch (cause) {
      if (cause?.code) throw cause;
      const externallyAborted = controller.signal.aborted && !timeoutTriggered && Boolean(externalSignal?.aborted);
      const staleGeneration = Number.isInteger(expectedGeneration)
        && expectedGeneration !== connectionGeneration;
      throw createRelayError(
        timeoutTriggered
          ? "request_timeout"
          : externallyAborted || staleGeneration
            ? "request_aborted"
            : "relay_unavailable",
        "Relay request failed.",
        { cause }
      );
    } finally {
      root.clearTimeout(timeout);
      activeRequestControllers.delete(controller);
      if (externalAbortHandler && typeof externalSignal?.removeEventListener === "function") {
        externalSignal.removeEventListener("abort", externalAbortHandler);
      }
    }
  }

  async function createDeviceSession(turnstileToken, configInput, options = {}) {
    if (typeof turnstileToken !== "string" || !turnstileToken.trim()) {
      throw createRelayError("turnstile_failed");
    }
    const config = baseManager.sanitizeConfig(configInput);

    const expectedGeneration = Number.isInteger(options.expectedGeneration)
      ? options.expectedGeneration
      : connectionGeneration;
    const result = await requestRelayJson("/v1/device-session", {
      turnstileToken: turnstileToken.trim(),
      sourceUrl: config.baseUrl,
      credential: config.credential
    }, { ...options, expectedGeneration });

    if (result.data?.session?.status !== "active") {
      throw createRelayError("relay_unavailable");
    }
    if (!Array.isArray(result.data?.entries)) {
      throw createRelayError("relay_unavailable");
    }
    throwIfGenerationChanged(expectedGeneration);
    cleanupLegacyRelaySession();
    deviceSessionState = "active";
    preparedConnectionTest = Object.freeze({
      identity: getConnectionIdentity(config),
      generation: expectedGeneration,
      entries: result.data.entries
    });
    return createDeviceSessionHint("active");
  }

  function ensureTurnstileContainer() {
    const container = root?.document?.getElementById?.(TURNSTILE_CONTAINER_ID) || null;
    if (!container) throw createRelayError("turnstile_failed");
    return container;
  }

  async function waitForTurnstileApi(timeoutMs = 10_000, signal = null) {
    if (signal?.aborted) throw createRelayError("request_aborted");
    if (root.turnstile && typeof root.turnstile.render === "function") return root.turnstile;

    if (!root?.document?.createElement || !root?.document?.head?.appendChild) {
      throw createRelayError("turnstile_failed");
    }

    let script = root.document.getElementById(TURNSTILE_SCRIPT_ID);
    if (!script) {
      script = root.document.createElement("script");
      script.id = TURNSTILE_SCRIPT_ID;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.referrerPolicy = "no-referrer";
      root.document.head.appendChild(script);
    }

    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      if (signal?.aborted) throw createRelayError("request_aborted");
      if (root.turnstile && typeof root.turnstile.render === "function") return root.turnstile;
      await new Promise((resolve) => root.setTimeout(resolve, 50));
    }

    throw createRelayError("turnstile_failed");
  }

  function hideRelayTurnstileContainer() {
    const container = root?.document?.getElementById?.(TURNSTILE_CONTAINER_ID) || null;
    if (!container) return;
    container.classList.remove("is-visible");
    container.hidden = true;
  }

  function removeRelayTurnstileWidget(turnstile = root?.turnstile) {
    const widgetId = relayWidgetId;
    relayWidgetId = null;
    if (widgetId === null || typeof turnstile?.remove !== "function") return;
    try {
      turnstile.remove(widgetId);
    } catch {
      // Callback generations still make a failed removal harmless to later attempts.
    }
  }

  function finishPendingChallenge(generation, error, token = "") {
    const attempt = pendingChallenge;
    if (!attempt || attempt.generation !== generation) return false;
    pendingChallenge = null;
    if (attempt.timeoutId !== null) root.clearTimeout(attempt.timeoutId);
    if (attempt.abortHandler && typeof attempt.signal?.removeEventListener === "function") {
      attempt.signal.removeEventListener("abort", attempt.abortHandler);
    }
    removeRelayTurnstileWidget(attempt.turnstile);
    hideRelayTurnstileContainer();

    if (error) attempt.reject(error);
    else attempt.resolve(token);
    return true;
  }

  function resetRelayTurnstile() {
    const attempt = pendingChallenge;
    if (attempt) {
      finishPendingChallenge(attempt.generation, createRelayError("request_aborted"));
      return;
    }
    challengeGeneration += 1;
    removeRelayTurnstileWidget();
    hideRelayTurnstileContainer();
  }

  async function requestTurnstileToken(options = {}) {
    if (options.signal?.aborted) throw createRelayError("request_aborted");
    if (pendingChallenge) return pendingChallenge.promise;

    const turnstile = await waitForTurnstileApi(10_000, options.signal || null);
    if (options.signal?.aborted) throw createRelayError("request_aborted");
    const container = ensureTurnstileContainer();
    container.hidden = false;
    container.classList.add("is-visible");

    challengeGeneration += 1;
    const generation = challengeGeneration;
    let resolveChallenge;
    let rejectChallenge;
    const promise = new Promise((resolve, reject) => {
      resolveChallenge = resolve;
      rejectChallenge = reject;
    });
    const challengeTimeoutMs = Number(options.challengeTimeoutMs) > 0
      ? Number(options.challengeTimeoutMs)
      : TURNSTILE_CHALLENGE_TIMEOUT_MS;
    const attempt = {
      generation,
      promise,
      resolve: resolveChallenge,
      reject: rejectChallenge,
      signal: options.signal || null,
      abortHandler: null,
      timeoutId: null,
      turnstile
    };
    pendingChallenge = attempt;
    attempt.timeoutId = root.setTimeout(() => {
      finishPendingChallenge(generation, createRelayError("turnstile_failed"));
    }, challengeTimeoutMs);
    if (attempt.signal && typeof attempt.signal.addEventListener === "function") {
      attempt.abortHandler = () => {
        finishPendingChallenge(generation, createRelayError("request_aborted"));
      };
      attempt.signal.addEventListener("abort", attempt.abortHandler, { once: true });
    }

    removeRelayTurnstileWidget(turnstile);
    try {
      relayWidgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        action: TURNSTILE_ACTION,
        theme: "auto",
        size: "flexible",
        callback: (token) => finishPendingChallenge(generation, null, token),
        "expired-callback": () => finishPendingChallenge(
          generation,
          createRelayError("turnstile_failed")
        ),
        "error-callback": (errorCode) => {
          const turnstileErrorCode = normalizeTurnstileErrorCode(errorCode);
          finishPendingChallenge(
            generation,
            createRelayError(
              "turnstile_failed",
              "turnstile_failed",
              turnstileErrorCode ? { turnstileErrorCode } : {}
            )
          );
          return true;
        }
      });
    } catch (cause) {
      finishPendingChallenge(
        generation,
        createRelayError("turnstile_failed", "Turnstile could not start.", { cause })
      );
    }

    return promise;
  }

  async function prepareConnection(configInput, options = {}) {
    const config = baseManager.sanitizeConfig(configInput);
    if (config.provider !== "gluroo") return null;
    if (!getRelayEndpoint()) throw createRelayError("relay_unavailable");

    const { identity, generation } = activateConnection(config);
    if (
      pendingPreparation
      && pendingPreparation.identity === identity
      && pendingPreparation.generation === generation
    ) {
      return awaitWithSignal(pendingPreparation.promise, options.signal);
    }

    // prepareConnection is called only by the explicit connection-test action.
    // Rotate even an existing cookie here so changing a Gluroo URL/passphrase
    // cannot inherit a session bound to the previous connection.
    const record = { identity, generation, promise: null };
    const promise = (async () => {
      try {
        let token = options.turnstileToken || "";
        if (!token) token = await requestTurnstileToken(options);
        throwIfGenerationChanged(generation);
        return await createDeviceSession(
          token,
          config,
          { ...options, expectedGeneration: generation }
        );
      } finally {
        if (pendingPreparation === record) {
          resetRelayTurnstile();
          pendingPreparation = null;
        }
      }
    })();
    record.promise = promise;
    pendingPreparation = record;
    return awaitWithSignal(promise, options.signal);
  }

  function startDeviceSessionStatusProbe(config, options = {}) {
    const { identity, generation } = activateConnection(config);
    if (deviceSessionState === "active") {
      return Promise.resolve(createDeviceSessionHint("active"));
    }
    if (["invalid", "source-mismatch", "revoked"].includes(deviceSessionState)) {
      return Promise.reject(createRelayError(
        deviceSessionState === "source-mismatch"
          ? "device_session_source_mismatch"
          : "device_session_invalid",
        undefined,
        { status: 401 }
      ));
    }

    if (
      pendingStatusProbe
      && pendingStatusProbe.identity === identity
      && pendingStatusProbe.generation === generation
    ) {
      return awaitWithSignal(pendingStatusProbe.promise, options.signal);
    }

    const record = { identity, generation, promise: null };
    const promise = (async () => {
      try {
        const result = await requestRelayJson("/v1/device-session/status", {}, {
          ...options,
          signal: undefined,
          expectedGeneration: generation
        });
        if (result.data?.session?.status !== "active") {
          throw createRelayError("relay_unavailable");
        }
        throwIfGenerationChanged(generation);
        deviceSessionState = "active";
        return createDeviceSessionHint("active");
      } catch (error) {
        if (generation === connectionGeneration && error?.code === "device_session_invalid") {
          deviceSessionState = "invalid";
        }
        throw error;
      } finally {
        if (pendingStatusProbe === record) pendingStatusProbe = null;
      }
    })();
    record.promise = promise;
    pendingStatusProbe = record;
    return awaitWithSignal(promise, options.signal);
  }

  async function requestRelayEntries(config, options = {}) {
    const { generation } = activateConnection(config);
    await startDeviceSessionStatusProbe(config, options);
    throwIfGenerationChanged(generation);

    const payload = {
      sourceUrl: config.baseUrl,
      credential: config.credential,
      limit: options.limit
    };
    if (options.from !== undefined || options.to !== undefined) {
      payload.from = new Date(options.from).toISOString();
      payload.to = new Date(options.to).toISOString();
    }

    try {
      const result = await requestRelayJson("/v1/entries", payload, {
        ...options,
        expectedGeneration: generation
      });
      throwIfGenerationChanged(generation);
      deviceSessionState = "active";
      return {
        data: Array.isArray(result.data.entries) ? result.data.entries : [],
        strategy: "limited-relay",
        status: result.status,
        urlOrigin: new URL(result.endpoint).origin
      };
    } catch (error) {
      if (generation === connectionGeneration) {
        if (error?.code === "device_session_invalid") deviceSessionState = "invalid";
        if (error?.code === "device_session_source_mismatch") deviceSessionState = "source-mismatch";
      }
      throw error;
    }
  }

  async function revokeDeviceSession(options = {}) {
    if (!getRelayEndpoint()) throw createRelayError("relay_unavailable");
    const previousState = deviceSessionState;
    const generation = invalidateConnectionWork("revoking");

    try {
      await requestRelayJson("/v1/device-session", undefined, {
        ...options,
        method: "DELETE",
        expectedGeneration: generation
      });
      throwIfGenerationChanged(generation);
      cleanupLegacyRelaySession();
      deviceSessionState = "revoked";
      activeConnectionIdentity = "";
      return Object.freeze({ ok: true, status: "revoked" });
    } catch (error) {
      if (generation === connectionGeneration) {
        deviceSessionState = previousState === "revoked" ? "revoked" : "unknown";
      }
      throw error;
    }
  }

  function createGlurooRelayAdapter(configInput) {
    const config = baseManager.sanitizeConfig(configInput);

    return {
      config,

      async fetchLatest(count = 2, options = {}) {
        return requestRelayEntries(config, { ...options, limit: count });
      },

      async fetchEntries(rangeStart, rangeEnd, count = 1000, options = {}) {
        return requestRelayEntries(config, {
          ...options,
          from: rangeStart,
          to: rangeEnd,
          limit: count
        });
      },

      async fetchTreatments() {
        return { data: [], strategy: "limited-relay", status: 200 };
      },

      async fetchDeviceStatus() {
        return { data: [], strategy: "limited-relay", status: 200 };
      },

      async testConnection(options = {}) {
        const identity = getConnectionIdentity(config);
        const prepared = (
          preparedConnectionTest?.identity === identity
          && preparedConnectionTest?.generation === connectionGeneration
        ) ? preparedConnectionTest : null;
        if (prepared) preparedConnectionTest = null;
        const result = prepared
          ? { data: prepared.entries }
          : await requestRelayEntries(config, { ...options, limit: 2 });
        const entries = baseManager._testing.normalizeGlucoseEntries(result.data);
        if (!entries.length) {
          throw createRelayError("no_glucose_data");
        }

        const latest = entries[0];
        return {
          ok: true,
          strategy: "limited-relay",
          provider: "gluroo",
          latest: {
            glucose: Number(latest.sgv),
            measuredAt: Number(latest.date),
            direction: latest.direction || ""
          }
        };
      }
    };
  }

  function updateUi(provider) {
    const isGluroo = provider === "gluroo";
    const notice = root?.document?.getElementById?.("dataSourceRelayNotice") || null;
    const directNotice = root?.document?.getElementById?.("dataSourceNightscoutDirectNotice") || null;
    const check = root?.document?.getElementById?.("dataSourceRelayCheck") || null;
    if (notice) notice.hidden = !isGluroo;
    if (directNotice) directNotice.hidden = isGluroo;
    if (check) check.hidden = !isGluroo;
    if (!isGluroo) invalidateConnectionWork("unknown", { clearIdentity: true });
  }

  const wrappedManager = Object.freeze({
    ...baseManager,
    createAdapter(configInput) {
      if (configInput?.mode === "public-demo") return baseManager.createAdapter(configInput);
      const config = baseManager.sanitizeConfig(configInput);
      return config.provider === "gluroo"
        ? createGlurooRelayAdapter(config)
        : baseManager.createAdapter(config);
    },
    clearUserConfig() {
      // Keep local credential deletion synchronous and independent of the
      // best-effort server revocation that the app starts immediately after.
      baseManager.clearUserConfig();
      clearRelaySession();
    }
  });

  cleanupLegacyRelaySession();
  root.GlucoScopeDataSource = wrappedManager;
  root.GlucoScopeDataRelay = Object.freeze({
    LEGACY_SESSION_KEY,
    TURNSTILE_ACTION,
    getRelayEndpoint,
    readRelaySession,
    clearRelaySession,
    prepareConnection,
    probeDeviceSession: startDeviceSessionStatusProbe,
    revokeDeviceSession,
    updateUi,
    _testing: Object.freeze({
      normalizeTurnstileErrorCode,
      normalizeRelayErrorCode,
      normalizeRelayEndpoint,
      cleanupLegacyRelaySession,
      createDeviceSession,
      requestRelayJson,
      createGlurooRelayAdapter,
      getDeviceSessionState: () => deviceSessionState,
      getConnectionGeneration: () => connectionGeneration
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
