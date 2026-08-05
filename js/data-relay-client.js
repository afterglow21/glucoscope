(function initializeGlucoScopeDataRelay(root) {
  "use strict";

  const baseManager = root.GlucoScopeDataSource;
  if (!baseManager) return;

  const SESSION_KEY = "glucoscope.dataRelay.session.v1";
  const LOCAL_ENDPOINT_STORAGE_KEY = "glucoscope.dataRelayEndpoint.v1";
  const RELAY_META_NAME = "glucoscope-data-relay-endpoint";
  const TURNSTILE_SITE_KEY = "0x4AAAAAADyftbRcWQW23mEa";
  const TURNSTILE_ACTION = "glucoscope-data-relay";
  const TURNSTILE_SCRIPT_ID = "glucoscope-turnstile-script";
  const TURNSTILE_CONTAINER_ID = "dataSourceRelayTurnstile";
  const REQUEST_TIMEOUT_MS = 20_000;
  const TICKET_EXPIRY_SKEW_MS = 30_000;
  const MAX_RELAY_ENDPOINT_LENGTH = 2_048;
  const MAX_TICKET_LENGTH = 2_048;

  let relayWidgetId = null;
  let pendingChallenge = null;
  let pendingChallengeResolve = null;
  let pendingChallengeReject = null;

  function createRelayError(code, message = code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
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

  function parseSession(raw, endpoint = getRelayEndpoint(), nowMs = Date.now()) {
    if (!raw || !endpoint) return null;

    try {
      const parsed = JSON.parse(raw);
      const expiresAtMs = Date.parse(parsed?.expiresAt || "");
      if (
        parsed?.version !== 1 ||
        parsed.endpoint !== endpoint ||
        typeof parsed.ticket !== "string" ||
        parsed.ticket.length < 20 ||
        parsed.ticket.length > MAX_TICKET_LENGTH ||
        /[\u0000-\u0020\u007f]/u.test(parsed.ticket) ||
        !Number.isFinite(expiresAtMs) ||
        expiresAtMs <= nowMs + TICKET_EXPIRY_SKEW_MS
      ) {
        return null;
      }

      return Object.freeze({
        version: 1,
        endpoint,
        ticket: parsed.ticket,
        expiresAt: new Date(expiresAtMs).toISOString()
      });
    } catch {
      return null;
    }
  }

  function readRelaySession(nowMs = Date.now()) {
    const storage = getStorage("sessionStorage");
    const endpoint = getRelayEndpoint();
    const session = parseSession(storage?.getItem(SESSION_KEY), endpoint, nowMs);
    if (!session) storage?.removeItem(SESSION_KEY);
    return session;
  }

  function saveRelaySession(input) {
    const endpoint = getRelayEndpoint();
    const expiresAtMs = Date.parse(input?.expiresAt || "");
    if (
      !endpoint ||
      typeof input?.ticket !== "string" ||
      input.ticket.length < 20 ||
      input.ticket.length > MAX_TICKET_LENGTH ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= Date.now()
    ) {
      throw createRelayError("relay_ticket_invalid");
    }

    const storage = getStorage("sessionStorage");
    if (!storage) throw createRelayError("relay_unavailable");

    const session = {
      version: 1,
      endpoint,
      ticket: input.ticket,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
    storage.setItem(SESSION_KEY, JSON.stringify(session));
    return Object.freeze(session);
  }

  function clearRelaySession() {
    getStorage("sessionStorage")?.removeItem(SESSION_KEY);
  }

  async function postRelayJson(path, payload, options = {}) {
    const endpoint = getRelayEndpoint();
    if (!endpoint) throw createRelayError("relay_unavailable");

    const fetchImpl = options.fetchImpl || root?.fetch || globalThis.fetch;
    if (typeof fetchImpl !== "function") throw createRelayError("relay_unavailable");

    const controller = new AbortController();
    const externalSignal = options.signal;
    let timeoutTriggered = false;
    let externalAbortHandler = null;

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
      const response = await fetchImpl(`${endpoint}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        throw createRelayError("relay_unavailable", "Relay returned an unreadable response.", {
          status: response.status
        });
      }

      if (!response.ok || data?.ok !== true) {
        const code = typeof data?.error === "string" ? data.error : "relay_unavailable";
        if (code === "relay_ticket_invalid") clearRelaySession();
        throw createRelayError(code, code, { status: response.status });
      }

      return { data, status: response.status, endpoint };
    } catch (cause) {
      if (cause?.code) throw cause;
      const externallyAborted = controller.signal.aborted && !timeoutTriggered && Boolean(externalSignal?.aborted);
      throw createRelayError(
        timeoutTriggered
          ? "request_timeout"
          : externallyAborted
            ? "request_aborted"
            : "relay_unavailable",
        "Relay request failed.",
        { cause }
      );
    } finally {
      root.clearTimeout(timeout);
      if (externalAbortHandler && typeof externalSignal?.removeEventListener === "function") {
        externalSignal.removeEventListener("abort", externalAbortHandler);
      }
    }
  }

  async function issueRelaySession(turnstileToken, options = {}) {
    if (typeof turnstileToken !== "string" || !turnstileToken.trim()) {
      throw createRelayError("turnstile_failed");
    }

    const result = await postRelayJson("/v1/session", {
      turnstileToken: turnstileToken.trim()
    }, options);

    return saveRelaySession({
      ticket: result.data.relayTicket,
      expiresAt: result.data.expiresAt
    });
  }

  function ensureTurnstileContainer() {
    const container = root?.document?.getElementById?.(TURNSTILE_CONTAINER_ID) || null;
    if (!container) throw createRelayError("turnstile_failed");
    return container;
  }

  async function waitForTurnstileApi(timeoutMs = 10_000) {
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
      if (root.turnstile && typeof root.turnstile.render === "function") return root.turnstile;
      await new Promise((resolve) => root.setTimeout(resolve, 50));
    }

    throw createRelayError("turnstile_failed");
  }

  function finishPendingChallenge(error, token = "") {
    const resolve = pendingChallengeResolve;
    const reject = pendingChallengeReject;
    pendingChallenge = null;
    pendingChallengeResolve = null;
    pendingChallengeReject = null;

    if (error) reject?.(error);
    else resolve?.(token);
  }

  async function requestTurnstileToken() {
    if (pendingChallenge) return pendingChallenge;

    const turnstile = await waitForTurnstileApi();
    const container = ensureTurnstileContainer();
    container.hidden = false;
    container.classList.add("is-visible");

    pendingChallenge = new Promise((resolve, reject) => {
      pendingChallengeResolve = resolve;
      pendingChallengeReject = reject;
    });

    if (relayWidgetId === null) {
      relayWidgetId = turnstile.render(container, {
        sitekey: TURNSTILE_SITE_KEY,
        action: TURNSTILE_ACTION,
        theme: "auto",
        size: "flexible",
        callback: (token) => finishPendingChallenge(null, token),
        "expired-callback": () => finishPendingChallenge(createRelayError("turnstile_failed")),
        "error-callback": () => finishPendingChallenge(createRelayError("turnstile_failed"))
      });
    } else if (typeof turnstile.reset === "function") {
      turnstile.reset(relayWidgetId);
    }

    return pendingChallenge;
  }

  function resetRelayTurnstile() {
    const container = root?.document?.getElementById?.(TURNSTILE_CONTAINER_ID) || null;
    if (container) {
      container.classList.remove("is-visible");
      container.hidden = true;
    }

    if (relayWidgetId !== null && root.turnstile && typeof root.turnstile.reset === "function") {
      try {
        root.turnstile.reset(relayWidgetId);
      } catch {
        // A later connection attempt can render again after a page reload.
      }
    }
  }

  async function prepareConnection(configInput, options = {}) {
    const config = baseManager.sanitizeConfig(configInput);
    if (config.provider !== "gluroo") return null;

    const endpoint = getRelayEndpoint();
    if (!endpoint) throw createRelayError("relay_unavailable");

    const existing = readRelaySession();
    if (existing) return existing;

    let token = options.turnstileToken || "";
    try {
      if (!token) token = await requestTurnstileToken();
      return await issueRelaySession(token, options);
    } finally {
      resetRelayTurnstile();
    }
  }

  async function requestRelayEntries(config, options = {}) {
    const session = readRelaySession();
    if (!session) throw createRelayError("relay_ticket_required");

    const payload = {
      sourceUrl: config.baseUrl,
      credential: config.credential,
      limit: options.limit,
      relayTicket: session.ticket
    };
    if (options.from !== undefined || options.to !== undefined) {
      payload.from = new Date(options.from).toISOString();
      payload.to = new Date(options.to).toISOString();
    }

    const result = await postRelayJson("/v1/entries", payload, options);
    return {
      data: Array.isArray(result.data.entries) ? result.data.entries : [],
      strategy: "limited-relay",
      status: result.status,
      urlOrigin: new URL(result.endpoint).origin
    };
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
        const result = await requestRelayEntries(config, { ...options, limit: 2 });
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
    if (!isGluroo) resetRelayTurnstile();
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
      baseManager.clearUserConfig();
      clearRelaySession();
    }
  });

  root.GlucoScopeDataSource = wrappedManager;
  root.GlucoScopeDataRelay = Object.freeze({
    SESSION_KEY,
    TURNSTILE_ACTION,
    getRelayEndpoint,
    readRelaySession,
    clearRelaySession,
    prepareConnection,
    updateUi,
    _testing: Object.freeze({
      normalizeRelayEndpoint,
      parseSession,
      saveRelaySession,
      issueRelaySession,
      postRelayJson,
      createGlurooRelayAdapter
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
