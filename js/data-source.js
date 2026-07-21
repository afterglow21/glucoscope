(function initializeGlucoScopeDataSource(root) {
  "use strict";

  const STORAGE_KEY = "glucoscope.dataSource.v1";
  const SESSION_STORAGE_KEY = "glucoscope.dataSource.session.v1";
  const SCHEMA_VERSION = 1;
  const PUBLIC_DEMO_BASE_URL = "https://kazuma-nightscoutweb.azurewebsites.net";
  const USER_MODE_VALUE = "user";
  const REQUEST_TIMEOUT_MS = 18000;

  function getStorage(name) {
    try {
      const storage = root?.[name];
      if (!storage || typeof storage.getItem !== "function") return null;
      return storage;
    } catch (error) {
      return null;
    }
  }

  function isLocalHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    return normalized === "localhost"
      || normalized === "127.0.0.1"
      || normalized === "[::1]";
  }

  function normalizeProvider(value) {
    return value === "gluroo" ? "gluroo" : "nightscout";
  }

  function normalizeCredentialType(value) {
    return ["auto", "api-secret", "token"].includes(value) ? value : "auto";
  }

  function normalizeAuthStrategy(value) {
    return ["none", "sha1-header", "raw-header", "token-query"].includes(value)
      ? value
      : "auto";
  }

  function normalizeConnectionInput(baseUrlInput, credentialInput = "") {
    let rawUrl = String(baseUrlInput || "").trim();
    let credential = String(credentialInput || "").trim();

    if (!rawUrl) {
      const error = new Error("A Nightscout-compatible URL is required.");
      error.code = "missing_url";
      throw error;
    }

    if (!/^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`;
    }

    let parsed;
    try {
      parsed = new URL(rawUrl);
    } catch (cause) {
      const error = new Error("The URL format could not be read.", { cause });
      error.code = "invalid_url";
      throw error;
    }

    const localHttpAllowed = parsed.protocol === "http:" && isLocalHostname(parsed.hostname);
    if (parsed.protocol !== "https:" && !localHttpAllowed) {
      const error = new Error("HTTPS is required for a data source.");
      error.code = "https_required";
      throw error;
    }

    const usernameFromUrl = parsed.username ? decodeURIComponent(parsed.username) : "";
    if (usernameFromUrl && !credential) {
      credential = usernameFromUrl;
    }

    const tokenFromUrl = parsed.searchParams.get("token") || "";
    if (tokenFromUrl && !credential) {
      credential = tokenFromUrl;
    }

    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    parsed.search = "";

    let path = parsed.pathname.replace(/\/+$/, "");
    path = path.replace(/\/api\/v1(?:\/.*)?$/i, "");
    path = path.replace(/\/+$/, "");

    const baseUrl = `${parsed.origin}${path}`;
    const credentialType = tokenFromUrl || usernameFromUrl ? "token" : "auto";

    return {
      baseUrl,
      credential,
      credentialType
    };
  }

  function sanitizeConfig(input = {}) {
    const normalized = normalizeConnectionInput(input.baseUrl, input.credential);
    const provider = normalizeProvider(input.provider);
    const persist = input.persist !== false;
    const credentialType = normalizeCredentialType(
      input.credentialType || normalized.credentialType
    );

    return {
      schemaVersion: SCHEMA_VERSION,
      mode: USER_MODE_VALUE,
      provider,
      baseUrl: normalized.baseUrl,
      credential: normalized.credential,
      credentialType,
      authStrategy: normalizeAuthStrategy(input.authStrategy),
      persist,
      savedAt: input.savedAt || new Date().toISOString()
    };
  }

  function parseStoredConfig(raw) {
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) return null;
      return sanitizeConfig(parsed);
    } catch (error) {
      return null;
    }
  }

  function readUserConfig() {
    const sessionStorage = getStorage("sessionStorage");
    const localStorage = getStorage("localStorage");

    return parseStoredConfig(sessionStorage?.getItem(SESSION_STORAGE_KEY))
      || parseStoredConfig(localStorage?.getItem(STORAGE_KEY));
  }

  function saveUserConfig(input, options = {}) {
    const config = sanitizeConfig({
      ...input,
      persist: options.persist ?? input.persist
    });
    const localStorage = getStorage("localStorage");
    const sessionStorage = getStorage("sessionStorage");
    const payload = JSON.stringify(config);

    localStorage?.removeItem(STORAGE_KEY);
    sessionStorage?.removeItem(SESSION_STORAGE_KEY);

    if (config.persist) {
      if (!localStorage) throw new Error("Browser local storage is unavailable.");
      localStorage.setItem(STORAGE_KEY, payload);
    } else {
      if (!sessionStorage) throw new Error("Browser session storage is unavailable.");
      sessionStorage.setItem(SESSION_STORAGE_KEY, payload);
    }

    return config;
  }

  function clearUserConfig() {
    getStorage("localStorage")?.removeItem(STORAGE_KEY);
    getStorage("sessionStorage")?.removeItem(SESSION_STORAGE_KEY);
  }

  function getLaunchMode() {
    try {
      const params = new URLSearchParams(root?.location?.search || "");
      if (params.get("mode") === USER_MODE_VALUE) return USER_MODE_VALUE;
      if (/\/user\.html$/i.test(root?.location?.pathname || "")) return USER_MODE_VALUE;
    } catch (error) {
      // Keep the public demo as the safe fallback.
    }

    return "public-demo";
  }

  function getPublicDemoConfig() {
    return {
      schemaVersion: SCHEMA_VERSION,
      mode: "public-demo",
      provider: "nightscout",
      baseUrl: PUBLIC_DEMO_BASE_URL,
      credential: "",
      credentialType: "auto",
      authStrategy: "none",
      persist: false,
      savedAt: null
    };
  }

  function getActiveConfig() {
    return getLaunchMode() === USER_MODE_VALUE
      ? readUserConfig()
      : getPublicDemoConfig();
  }

  function buildApiUrl(config, relativePath, params = {}, strategy = "none") {
    const baseUrl = String(config?.baseUrl || "").replace(/\/+$/, "");
    const path = String(relativePath || "").startsWith("/")
      ? String(relativePath)
      : `/${relativePath}`;
    const url = new URL(`${baseUrl}${path}`);

    Object.entries(params || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });

    if (strategy === "token-query" && config?.credential) {
      url.searchParams.set("token", config.credential);
    }

    return url;
  }

  async function digestHex(value, algorithm) {
    const cryptoObject = root?.crypto || globalThis.crypto;
    if (!cryptoObject?.subtle) {
      const error = new Error("Web Crypto is unavailable.");
      error.code = "crypto_unavailable";
      throw error;
    }

    const bytes = new TextEncoder().encode(String(value || ""));
    const digest = await cryptoObject.subtle.digest(algorithm, bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function getAuthStrategies(config) {
    if (!config?.credential) return ["none"];

    const preferred = normalizeAuthStrategy(config.authStrategy);
    if (preferred !== "auto") {
      return [preferred, "sha1-header", "raw-header", "token-query"]
        .filter((value, index, values) => values.indexOf(value) === index);
    }

    if (config.credentialType === "token") {
      return ["token-query", "raw-header", "sha1-header"];
    }

    if (config.credentialType === "api-secret") {
      return ["sha1-header", "raw-header", "token-query"];
    }

    return config.provider === "gluroo"
      ? ["raw-header", "token-query", "sha1-header"]
      : ["sha1-header", "raw-header", "token-query"];
  }

  function createRequestError(message, code, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.assign(error, details);
    return error;
  }


  function normalizeEntryTimestamp(entry = {}) {
    const rawNumber = Number(entry.date ?? entry.timestamp ?? entry.time);
    if (Number.isFinite(rawNumber)) {
      return rawNumber < 100_000_000_000 ? rawNumber * 1000 : rawNumber;
    }

    const parsed = Date.parse(entry.dateString || entry.created_at || entry.datetime || "");
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function normalizeGlucoseEntry(entry = {}) {
    const glucose = Number(entry.sgv ?? entry.glucose ?? entry.mgdl ?? entry.value);
    const date = normalizeEntryTimestamp(entry);
    if (!Number.isFinite(glucose) || !Number.isFinite(date)) return null;

    return {
      ...entry,
      sgv: glucose,
      date,
      direction: entry.direction || entry.trendArrow || entry.arrow || ""
    };
  }

  function normalizeGlucoseEntries(data) {
    if (!Array.isArray(data)) return [];
    return data.map(normalizeGlucoseEntry).filter(Boolean);
  }

  async function requestJson(configInput, relativePath, params = {}, options = {}) {
    const config = configInput?.mode === "public-demo"
      ? getPublicDemoConfig()
      : sanitizeConfig(configInput);
    const fetchImpl = options.fetchImpl || root?.fetch || globalThis.fetch;

    if (typeof fetchImpl !== "function") {
      throw createRequestError("Fetch is unavailable.", "fetch_unavailable");
    }

    const strategies = options.authStrategy
      ? [normalizeAuthStrategy(options.authStrategy)]
      : getAuthStrategies(config);
    const attempts = [];
    let lastError = null;

    for (const strategy of strategies) {
      const headers = new Headers({ Accept: "application/json" });
      if (strategy === "sha1-header" && config.credential) {
        headers.set("api-secret", await digestHex(config.credential, "SHA-1"));
      } else if (strategy === "raw-header" && config.credential) {
        headers.set("api-secret", config.credential);
      }

      const url = buildApiUrl(config, relativePath, params, strategy);
      const controller = new AbortController();
      const externalSignal = options.signal;
      let timeoutTriggered = false;
      let externalAbortHandler = null;

      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort(externalSignal.reason);
        } else if (typeof externalSignal.addEventListener === "function") {
          externalAbortHandler = () => controller.abort(externalSignal.reason);
          externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
        }
      }

      const timeout = root.setTimeout(
        () => {
          timeoutTriggered = true;
          controller.abort();
        },
        Number(options.timeoutMs) || REQUEST_TIMEOUT_MS
      );

      try {
        const response = await fetchImpl(url.toString(), {
          method: "GET",
          headers,
          cache: "no-store",
          redirect: "error",
          signal: controller.signal
        });
        attempts.push({ strategy, status: response.status });

        if (response.ok) {
          const data = await response.json();
          return {
            data,
            strategy,
            status: response.status,
            urlOrigin: url.origin
          };
        }

        if (options.allowNotFound && response.status === 404) {
          return {
            data: options.fallback ?? [],
            strategy,
            status: response.status,
            urlOrigin: url.origin
          };
        }

        lastError = createRequestError(
          `Data source returned HTTP ${response.status}.`,
          response.status === 401 || response.status === 403 ? "authentication_failed" : "http_error",
          { status: response.status, strategy }
        );

        if (response.status !== 401 && response.status !== 403) break;
      } catch (cause) {
        const aborted = cause?.name === "AbortError" || controller.signal.aborted;
        const externallyAborted = aborted && !timeoutTriggered && Boolean(externalSignal?.aborted);
        lastError = createRequestError(
          timeoutTriggered
            ? "The data source request timed out."
            : externallyAborted
              ? "The data source request was stopped."
              : "The browser could not reach the data source.",
          timeoutTriggered
            ? "request_timeout"
            : externallyAborted
              ? "request_aborted"
              : "cors_or_network",
          { cause, strategy }
        );
      } finally {
        root.clearTimeout(timeout);
        if (externalAbortHandler && typeof externalSignal?.removeEventListener === "function") {
          externalSignal.removeEventListener("abort", externalAbortHandler);
        }
      }
    }

    if (lastError) {
      lastError.attempts = attempts;
      throw lastError;
    }

    throw createRequestError("The data source request failed.", "request_failed", { attempts });
  }

  function createAdapter(configInput) {
    const config = configInput?.mode === "public-demo"
      ? getPublicDemoConfig()
      : sanitizeConfig(configInput);

    return {
      config,

      async fetchLatest(count = 2) {
        const result = await requestJson(config, "/api/v1/entries.json", { count });
        return { ...result, data: normalizeGlucoseEntries(result.data) };
      },

      async fetchEntries(rangeStart, rangeEnd, count = 1000) {
        const params = {
          "find[date][$gte]": Math.round(rangeStart),
          "find[date][$lte]": Math.round(rangeEnd),
          count
        };
        let result;
        try {
          result = await requestJson(config, "/api/v1/entries/sgv.json", params);
        } catch (error) {
          if (error?.status !== 404) throw error;
          result = await requestJson(config, "/api/v1/entries.json", params);
        }
        return { ...result, data: normalizeGlucoseEntries(result.data) };
      },

      async fetchTreatments(rangeStart, rangeEnd, count = 1000) {
        return requestJson(config, "/api/v1/treatments.json", {
          "find[created_at][$gte]": new Date(rangeStart).toISOString(),
          count
        }, {
          allowNotFound: true,
          fallback: []
        });
      },

      async fetchDeviceStatus() {
        return requestJson(config, "/api/v1/devicestatus.json", { count: 1 }, {
          allowNotFound: true,
          fallback: []
        });
      },

      async testConnection() {
        const result = await requestJson(config, "/api/v1/entries.json", { count: 2 });
        const rawEntries = Array.isArray(result.data) ? result.data : [];
        if (!rawEntries.length) {
          throw createRequestError(
            "The connection worked, but no glucose entries were returned.",
            "no_glucose_data",
            { strategy: result.strategy }
          );
        }

        const entries = normalizeGlucoseEntries(rawEntries);
        if (!entries.length) {
          throw createRequestError(
            "The endpoint responded, but the glucose entry format is not compatible yet.",
            "incompatible_entry_format",
            { strategy: result.strategy }
          );
        }

        const latest = entries[0] || {};
        const glucose = Number(latest.sgv);
        const measuredAt = Number(latest.date);

        return {
          ok: true,
          strategy: result.strategy,
          provider: config.provider,
          latest: {
            glucose,
            measuredAt,
            direction: latest.direction || ""
          }
        };
      }
    };
  }

  function getProviderLabel(provider, language = "ja") {
    if (provider === "gluroo") return "Gluroo";
    return language === "en" ? "Nightscout" : "Nightscout";
  }

  root.GlucoScopeDataSource = Object.freeze({
    STORAGE_KEY,
    SESSION_STORAGE_KEY,
    SCHEMA_VERSION,
    getLaunchMode,
    getActiveConfig,
    getPublicDemoConfig,
    readUserConfig,
    saveUserConfig,
    clearUserConfig,
    sanitizeConfig,
    normalizeConnectionInput,
    createAdapter,
    getProviderLabel,
    requestJson,
    _testing: Object.freeze({
      buildApiUrl,
      digestHex,
      getAuthStrategies,
      normalizeGlucoseEntry,
      normalizeGlucoseEntries
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
