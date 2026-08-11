(function initializeGlucoScopeUsage(root) {
  "use strict";

  const STORAGE_KEY = "glucoscope.usageProfile.v1";
  const SCHEMA_VERSION = 1;
  const NOTICE_VERSION = "2026-08-11";
  const MAX_DISPLAY_NAME_CODE_POINTS = 30;
  const MAX_PENDING_AI_EVENTS = 20;
  const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
  const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
  const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

  let configuration = Object.freeze({ enabled: false, endpoint: "" });

  function defaultStoredState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profileId: "",
      profileToken: "",
      collectionEnabled: false,
      lastVisitDay: "",
      ordinaryMemoryCount: -1,
      pendingAiEvents: []
    };
  }

  function normalizeDisplayName(value) {
    let text;
    try {
      text = String(value ?? "");
    } catch (error) {
      return "";
    }

    return Array.from(
      text.replace(/\s+/gu, " ").replace(CONTROL_AND_BIDI_PATTERN, "").trim()
    ).slice(0, MAX_DISPLAY_NAME_CODE_POINTS).join("").trim();
  }

  function getStorage() {
    try {
      const storage = root?.localStorage;
      if (!storage
        || typeof storage.getItem !== "function"
        || typeof storage.setItem !== "function"
        || typeof storage.removeItem !== "function") {
        return null;
      }
      return storage;
    } catch (error) {
      return null;
    }
  }

  function normalizePendingEvents(value) {
    if (!Array.isArray(value)) return [];
    const unique = new Set();
    const events = [];

    for (const item of value) {
      const eventId = String(item?.eventId || "");
      if (!EVENT_ID_PATTERN.test(eventId) || unique.has(eventId)) continue;
      unique.add(eventId);
      events.push({ type: "ai_generation_success", eventId });
      if (events.length >= MAX_PENDING_AI_EVENTS) break;
    }
    return events;
  }

  function normalizeStoredState(input) {
    if (!input || typeof input !== "object" || input.schemaVersion !== SCHEMA_VERSION) {
      return null;
    }

    const profileId = String(input.profileId || "");
    const profileToken = String(input.profileToken || "");
    if (!PROFILE_ID_PATTERN.test(profileId) || !TOKEN_PATTERN.test(profileToken)) return null;

    const ordinaryMemoryCount = Number(input.ordinaryMemoryCount);
    return {
      schemaVersion: SCHEMA_VERSION,
      profileId,
      profileToken,
      collectionEnabled: input.collectionEnabled === true,
      lastVisitDay: /^\d{4}-\d{2}-\d{2}$/u.test(String(input.lastVisitDay || ""))
        ? String(input.lastVisitDay)
        : "",
      ordinaryMemoryCount: Number.isInteger(ordinaryMemoryCount)
        && ordinaryMemoryCount >= -1
        && ordinaryMemoryCount <= 50
        ? ordinaryMemoryCount
        : -1,
      pendingAiEvents: normalizePendingEvents(input.pendingAiEvents)
    };
  }

  function readStoredState() {
    const storage = getStorage();
    if (!storage) return { ok: false, state: defaultStoredState(), error: "storage_unavailable" };

    let raw;
    try {
      raw = storage.getItem(STORAGE_KEY);
    } catch (error) {
      return { ok: false, state: defaultStoredState(), error: "storage_read_failed" };
    }

    if (raw === null) return { ok: true, state: defaultStoredState(), error: null };

    try {
      const state = normalizeStoredState(JSON.parse(raw));
      if (!state) return { ok: false, state: defaultStoredState(), error: "invalid_profile" };
      return { ok: true, state, error: null };
    } catch (error) {
      return { ok: false, state: defaultStoredState(), error: "invalid_profile" };
    }
  }

  function writeStoredState(state) {
    const storage = getStorage();
    if (!storage) return { ok: false, error: "storage_unavailable" };
    const normalized = normalizeStoredState(state);
    if (!normalized) return { ok: false, error: "invalid_profile" };

    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return { ok: true, error: null };
    } catch (error) {
      return { ok: false, error: "storage_write_failed" };
    }
  }

  function preflightStartStorage() {
    const storage = getStorage();
    if (!storage) return { ok: false, error: "storage_unavailable" };

    let existing;
    try {
      existing = storage.getItem(STORAGE_KEY);
    } catch (error) {
      return { ok: false, error: "storage_read_failed" };
    }
    if (existing !== null) return { ok: false, error: "profile_already_exists" };

    const probe = JSON.stringify({ schemaVersion: 0, storageProbe: true });
    try {
      storage.setItem(STORAGE_KEY, probe);
      if (storage.getItem(STORAGE_KEY) !== probe) throw new Error("storage_probe_failed");
      storage.removeItem(STORAGE_KEY);
      return { ok: true, error: null };
    } catch (error) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch (cleanupError) {
        // Storage is already unavailable; never create a server profile in this state.
      }
      return { ok: false, error: "storage_write_failed" };
    }
  }

  function publicState(readResult = readStoredState()) {
    const state = readResult.state;
    return {
      ok: readResult.ok,
      enabled: configuration.enabled,
      registered: Boolean(readResult.ok && state.profileId && state.profileToken),
      collectionEnabled: Boolean(readResult.ok && state.collectionEnabled),
      profileId: readResult.ok ? state.profileId : "",
      error: readResult.error
    };
  }

  function configure(options = {}) {
    const rawEndpoint = String(options.endpoint || "").trim().replace(/\/+$/u, "");
    const endpointAllowed = /^https:\/\//iu.test(rawEndpoint)
      || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/iu.test(rawEndpoint);
    configuration = Object.freeze({
      enabled: options.enabled === true,
      endpoint: endpointAllowed ? rawEndpoint : ""
    });
    return publicState();
  }

  function getState() {
    return publicState();
  }

  function createEventId() {
    try {
      if (typeof root?.crypto?.randomUUID === "function") return root.crypto.randomUUID();
    } catch (error) {
      return "";
    }
    return "";
  }

  function getLocalDay(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  async function requestJson(path, { method = "GET", body, token = "" } = {}) {
    if (!configuration.endpoint || typeof root?.fetch !== "function") {
      return { ok: false, error: "usage_unavailable" };
    }

    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    let response;
    try {
      response = await root.fetch(`${configuration.endpoint}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
    } catch (error) {
      return { ok: false, error: "network_failed" };
    }

    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok || data?.ok === false) {
      return { ok: false, error: String(data?.error || `http_${response.status}`), status: response.status };
    }
    return { ok: true, data, status: response.status };
  }

  async function start(input = {}) {
    if (!configuration.enabled || !configuration.endpoint) {
      return { ok: false, error: "usage_not_enabled", state: getState() };
    }

    const turnstileToken = String(input.turnstileToken || "").trim();
    if (!turnstileToken || turnstileToken.length > 2048) {
      return { ok: false, error: "turnstile_required", state: getState() };
    }

    const existing = readStoredState();
    if (!existing.ok) {
      return { ok: false, error: existing.error, state: publicState(existing) };
    }
    if (existing.state.profileId || existing.state.profileToken) {
      return { ok: false, error: "profile_already_exists", state: publicState(existing) };
    }
    const storagePreflight = preflightStartStorage();
    if (!storagePreflight.ok) {
      return { ok: false, error: storagePreflight.error, state: getState() };
    }

    const result = await requestJson("/v1/profiles", {
      method: "POST",
      body: {
        displayName: normalizeDisplayName(input.displayName),
        turnstileToken
      }
    });
    if (!result.ok) return { ...result, state: getState() };

    const profile = result.data?.profile;
    const profileToken = String(result.data?.profileToken || "");
    const storedState = normalizeStoredState({
      schemaVersion: SCHEMA_VERSION,
      profileId: profile?.id,
      profileToken,
      collectionEnabled: profile?.collectionEnabled === true,
      lastVisitDay: "",
      ordinaryMemoryCount: -1,
      pendingAiEvents: []
    });
    if (!storedState) {
      if (TOKEN_PATTERN.test(profileToken)) {
        await requestJson("/v1/me", { method: "DELETE", token: profileToken });
      }
      return { ok: false, error: "invalid_server_response", state: getState() };
    }

    const writeResult = writeStoredState(storedState);
    if (!writeResult.ok) {
      const cleanupResult = await requestJson("/v1/me", {
        method: "DELETE",
        token: profileToken
      });
      if (cleanupResult.ok) {
        try {
          getStorage()?.removeItem(STORAGE_KEY);
        } catch (cleanupError) {
          // The server record is already gone; a broken browser store cannot be repaired here.
        }
      }
      return {
        ok: false,
        error: writeResult.error,
        serverCleanupPending: !cleanupResult.ok,
        state: getState()
      };
    }
    return { ok: true, state: getState(), profile: { displayName: normalizeDisplayName(profile?.displayName) } };
  }

  async function sendEvents(state, events) {
    if (!Array.isArray(events) || events.length === 0) return { ok: true, data: { results: [] } };
    return requestJson("/v1/events", {
      method: "POST",
      token: state.profileToken,
      body: { events: events.slice(0, 20) }
    });
  }

  async function flushPendingAiEvents(state) {
    if (!configuration.enabled || !state.collectionEnabled || state.pendingAiEvents.length === 0) {
      return { ok: true, state };
    }
    const result = await sendEvents(state, state.pendingAiEvents);
    if (!result.ok) return { ...result, state };
    const nextState = { ...state, pendingAiEvents: [] };
    const writeResult = writeStoredState(nextState);
    return writeResult.ok
      ? { ok: true, state: nextState }
      : { ok: false, error: writeResult.error, state };
  }

  async function init() {
    const readResult = readStoredState();
    if (!readResult.ok) return publicState(readResult);
    if (!configuration.enabled || !readResult.state.collectionEnabled) return publicState(readResult);
    await flushPendingAiEvents(readResult.state);
    return getState();
  }

  async function recordVisit() {
    const readResult = readStoredState();
    if (!configuration.enabled || !readResult.ok || !readResult.state.collectionEnabled) {
      return { ok: false, skipped: true, error: readResult.error || "collection_stopped" };
    }

    const state = readResult.state;
    const day = getLocalDay();
    if (state.lastVisitDay === day) return { ok: true, skipped: true, reason: "already_recorded" };

    const eventId = createEventId();
    if (!EVENT_ID_PATTERN.test(eventId)) return { ok: false, error: "secure_id_unavailable" };
    const result = await sendEvents(state, [{ type: "visit_day", eventId }]);
    if (!result.ok) return result;
    const writeResult = writeStoredState({ ...state, lastVisitDay: day });
    return writeResult.ok ? { ok: true } : { ok: false, error: writeResult.error };
  }

  async function recordAiGeneration(input = {}) {
    const readResult = readStoredState();
    if (!configuration.enabled || !readResult.ok || !readResult.state.collectionEnabled) {
      return { ok: false, skipped: true, error: readResult.error || "collection_stopped" };
    }

    const state = readResult.state;
    const suppliedId = String(input.eventId || "");
    const eventId = EVENT_ID_PATTERN.test(suppliedId) ? suppliedId : createEventId();
    if (!EVENT_ID_PATTERN.test(eventId)) return { ok: false, error: "secure_id_unavailable" };

    if (state.pendingAiEvents.some((event) => event.eventId === eventId)) {
      return { ok: true, skipped: true, reason: "already_queued" };
    }
    const event = { type: "ai_generation_success", eventId };
    const result = await sendEvents(state, [event]);
    if (result.ok) return { ok: true, eventId };

    const pendingAiEvents = [...state.pendingAiEvents, event].slice(-MAX_PENDING_AI_EVENTS);
    const writeResult = writeStoredState({ ...state, pendingAiEvents });
    return { ok: false, queued: writeResult.ok, eventId, error: result.error };
  }

  async function syncOrdinaryMemoryCount(value) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > 50) {
      return { ok: false, skipped: true, error: "invalid_memory_count" };
    }

    const readResult = readStoredState();
    if (!configuration.enabled || !readResult.ok || !readResult.state.collectionEnabled) {
      return { ok: false, skipped: true, error: readResult.error || "collection_stopped" };
    }
    const state = readResult.state;
    if (count <= state.ordinaryMemoryCount) {
      return { ok: true, skipped: true, reason: "already_recorded" };
    }

    const eventId = createEventId();
    if (!EVENT_ID_PATTERN.test(eventId)) return { ok: false, error: "secure_id_unavailable" };
    const result = await sendEvents(state, [{
      type: "ordinary_gluco_memory_count",
      eventId,
      count
    }]);
    if (!result.ok) return result;
    const writeResult = writeStoredState({ ...state, ordinaryMemoryCount: count });
    return writeResult.ok ? { ok: true } : { ok: false, error: writeResult.error };
  }

  async function updateProfile(input = {}) {
    const readResult = readStoredState();
    if (!readResult.ok || !readResult.state.profileToken) {
      return { ok: false, error: readResult.error || "profile_not_found", state: getState() };
    }

    const body = {};
    if (Object.prototype.hasOwnProperty.call(input, "displayName")) {
      body.displayName = normalizeDisplayName(input.displayName);
    }
    if (Object.prototype.hasOwnProperty.call(input, "collectionEnabled")) {
      body.collectionEnabled = input.collectionEnabled === true;
      if (body.collectionEnabled && !configuration.enabled) {
        return { ok: false, error: "usage_not_enabled", state: getState() };
      }
    }
    if (Object.keys(body).length === 0) {
      return { ok: false, error: "no_changes", state: getState() };
    }

    const result = await requestJson("/v1/me", {
      method: "PATCH",
      token: readResult.state.profileToken,
      body
    });
    if (!result.ok) return { ...result, state: getState() };

    const nextEnabled = typeof result.data?.profile?.collectionEnabled === "boolean"
      ? result.data.profile.collectionEnabled
      : body.collectionEnabled ?? readResult.state.collectionEnabled;
    const nextState = { ...readResult.state, collectionEnabled: nextEnabled };
    const writeResult = writeStoredState(nextState);
    return writeResult.ok
      ? { ok: true, state: getState() }
      : { ok: false, error: writeResult.error, state: getState() };
  }

  async function exportData() {
    const readResult = readStoredState();
    if (!readResult.ok || !readResult.state.profileToken) {
      return { ok: false, error: readResult.error || "profile_not_found" };
    }
    const result = await requestJson("/v1/me/export", {
      token: readResult.state.profileToken
    });
    return result.ok ? { ok: true, data: result.data } : result;
  }

  async function deleteData() {
    const readResult = readStoredState();
    if (!readResult.ok || !readResult.state.profileToken) {
      return { ok: false, error: readResult.error || "profile_not_found", state: getState() };
    }
    const result = await requestJson("/v1/me", {
      method: "DELETE",
      token: readResult.state.profileToken
    });
    if (!result.ok) return { ...result, state: getState() };

    const storage = getStorage();
    if (!storage) return { ok: false, error: "storage_unavailable", state: getState() };
    try {
      storage.removeItem(STORAGE_KEY);
      return { ok: true, state: getState() };
    } catch (error) {
      return { ok: false, error: "storage_delete_failed", state: getState() };
    }
  }

  root.GlucoScopeUsage = Object.freeze({
    STORAGE_KEY,
    SCHEMA_VERSION,
    NOTICE_VERSION,
    configure,
    init,
    getState,
    start,
    recordVisit,
    recordAiGeneration,
    syncOrdinaryMemoryCount,
    updateProfile,
    exportData,
    deleteData,
    _testing: Object.freeze({
      normalizeDisplayName,
      normalizeStoredState,
      getLocalDay
    })
  });
})(typeof window !== "undefined" ? window : globalThis);
