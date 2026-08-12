(function initializeGlucoScopeUsage(root) {
  "use strict";

  const STORAGE_KEY = "glucoscope.usageProfile.v1";
  const SCHEMA_VERSION = 1;
  const NOTICE_VERSION = "2026-08-12-simple-connection-1";
  const MAX_DISPLAY_NAME_CODE_POINTS = 30;
  const MAX_PENDING_AI_EVENTS = 20;
  const MAX_LIFECYCLE_GENERATION = 1_000_000_000;
  const PROFILE_CREATE_TIMEOUT_MS = 10_000;
  const PROFILE_CLEANUP_TIMEOUT_MS = 2_000;
  const CONTROL_AND_BIDI_PATTERN = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu;
  const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
  const EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

  let configuration = Object.freeze({ enabled: false, endpoint: "" });
  let sessionCollectionBlocked = false;
  let lifecycleEpoch = 0;

  function defaultStoredState() {
    return {
      schemaVersion: SCHEMA_VERSION,
      profileId: "",
      profileToken: "",
      lifecycleGeneration: 0,
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
    const lifecycleGeneration = Number(input.lifecycleGeneration);
    return {
      schemaVersion: SCHEMA_VERSION,
      profileId,
      profileToken,
      lifecycleGeneration: Number.isInteger(lifecycleGeneration)
        && lifecycleGeneration >= 0
        && lifecycleGeneration <= MAX_LIFECYCLE_GENERATION
        ? lifecycleGeneration
        : 0,
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

  function advanceLifecycleEpoch() {
    lifecycleEpoch = lifecycleEpoch >= MAX_LIFECYCLE_GENERATION ? 1 : lifecycleEpoch + 1;
    return lifecycleEpoch;
  }

  function nextLifecycleGeneration(currentGeneration) {
    return currentGeneration >= MAX_LIFECYCLE_GENERATION ? 1 : currentGeneration + 1;
  }

  function getCurrentOperationState(
    startedState,
    startedEpoch,
    { requireCollectionEnabled = true } = {}
  ) {
    const currentResult = readStoredState();
    const currentState = currentResult.state;
    if (
      lifecycleEpoch !== startedEpoch
      || !currentResult.ok
      || currentState.profileId !== startedState.profileId
      || currentState.profileToken !== startedState.profileToken
      || currentState.lifecycleGeneration !== startedState.lifecycleGeneration
      || (requireCollectionEnabled && (
        sessionCollectionBlocked || !currentState.collectionEnabled
      ))
    ) {
      return {
        ok: currentResult.ok,
        skipped: true,
        error: currentResult.error,
        state: currentState
      };
    }

    return { ok: true, skipped: false, error: null, state: currentState };
  }

  function persistInFlightEventState(
    startedState,
    startedEpoch,
    updateState,
    options = {}
  ) {
    const currentResult = getCurrentOperationState(startedState, startedEpoch, options);
    if (!currentResult.ok || currentResult.skipped) return currentResult;

    const nextState = updateState(currentResult.state);
    const writeResult = writeStoredState(nextState);
    return writeResult.ok
      ? { ok: true, skipped: false, state: nextState }
      : { ok: false, skipped: false, error: writeResult.error, state: currentResult.state };
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
      collectionEnabled: Boolean(
        readResult.ok && state.collectionEnabled && !sessionCollectionBlocked
      ),
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

  async function requestJson(
    path,
    { method = "GET", body, token = "", signal, timeoutMs = 0 } = {}
  ) {
    if (!configuration.endpoint || typeof root?.fetch !== "function") {
      return { ok: false, error: "usage_unavailable" };
    }

    const headers = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    const requestedTimeoutMs = Number(timeoutMs);
    const hasTimeout = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0;
    const externalSignal = signal
      && typeof signal === "object"
      && typeof signal.aborted === "boolean"
      ? signal
      : null;
    let requestSignal = externalSignal || undefined;
    let abortController = null;
    let timeoutId = null;
    let timedOut = false;
    let removeExternalAbortListener = null;

    if (hasTimeout) {
      if (
        typeof root?.AbortController !== "function"
        || typeof root?.setTimeout !== "function"
        || typeof root?.clearTimeout !== "function"
      ) {
        return { ok: false, error: "usage_unavailable" };
      }

      abortController = new root.AbortController();
      requestSignal = abortController.signal;
      const abortRequest = () => {
        try {
          abortController.abort();
        } catch (error) {
          // Aborting is best effort on older browser implementations.
        }
      };
      if (externalSignal?.aborted) {
        abortRequest();
      } else if (typeof externalSignal?.addEventListener === "function") {
        const forwardExternalAbort = () => abortRequest();
        externalSignal.addEventListener("abort", forwardExternalAbort, { once: true });
        removeExternalAbortListener = () => {
          if (typeof externalSignal.removeEventListener === "function") {
            externalSignal.removeEventListener("abort", forwardExternalAbort);
          }
        };
      }
      if (!requestSignal.aborted) {
        timeoutId = root.setTimeout(() => {
          timedOut = true;
          abortRequest();
        }, requestedTimeoutMs);
      }
    }

    const abortError = () => ({
      ok: false,
      error: timedOut ? "request_timeout" : "request_aborted"
    });

    if (requestSignal?.aborted) {
      removeExternalAbortListener?.();
      return abortError();
    }

    try {
      const response = await root.fetch(`${configuration.endpoint}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: requestSignal
      });
      let data = {};
      try {
        data = await response.json();
      } catch (error) {
        if (requestSignal?.aborted || error?.name === "AbortError") throw error;
        data = {};
      }
      if (requestSignal?.aborted) return abortError();
      if (!response.ok || data?.ok === false) {
        return {
          ok: false,
          error: String(data?.error || `http_${response.status}`),
          status: response.status
        };
      }
      return { ok: true, data, status: response.status };
    } catch (error) {
      if (requestSignal?.aborted || error?.name === "AbortError") return abortError();
      return { ok: false, error: "network_failed" };
    } finally {
      if (timeoutId !== null) root.clearTimeout(timeoutId);
      removeExternalAbortListener?.();
    }
  }

  async function start(input = {}) {
    if (!configuration.enabled || !configuration.endpoint) {
      return { ok: false, error: "usage_not_enabled", state: getState() };
    }

    const turnstileToken = String(input.turnstileToken || "").trim();
    if (!turnstileToken || turnstileToken.length > 2048) {
      return { ok: false, error: "turnstile_required", state: getState() };
    }
    const displayName = normalizeDisplayName(input.displayName);
    if (!displayName) {
      return { ok: false, error: "display_name_required", state: getState() };
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

    const startEpoch = advanceLifecycleEpoch();
    const startGeneration = nextLifecycleGeneration(existing.state.lifecycleGeneration);
    sessionCollectionBlocked = true;
    // A timeout can race a server commit whose credentials never reach this browser.
    // Without that token the client cannot clean up the server row, so it must never
    // accept a late response or persist credentials after the aborted request settles.
    const result = await requestJson("/v1/profiles", {
      method: "POST",
      signal: input.signal,
      timeoutMs: PROFILE_CREATE_TIMEOUT_MS,
      body: {
        displayName,
        turnstileToken
      }
    });
    if (!result.ok) {
      if (lifecycleEpoch === startEpoch) sessionCollectionBlocked = false;
      return { ...result, state: getState() };
    }

    const profile = result.data?.profile;
    const profileToken = String(result.data?.profileToken || "");
    const storedState = normalizeStoredState({
      schemaVersion: SCHEMA_VERSION,
      profileId: profile?.id,
      profileToken,
      lifecycleGeneration: startGeneration,
      collectionEnabled: profile?.collectionEnabled === true,
      lastVisitDay: "",
      ordinaryMemoryCount: -1,
      pendingAiEvents: []
    });
    if (!storedState) {
      if (TOKEN_PATTERN.test(profileToken)) {
        await requestJson("/v1/me", {
          method: "DELETE",
          token: profileToken,
          signal: input.signal,
          timeoutMs: PROFILE_CLEANUP_TIMEOUT_MS
        });
      }
      if (lifecycleEpoch === startEpoch) sessionCollectionBlocked = false;
      return { ok: false, error: "invalid_server_response", state: getState() };
    }

    const currentBeforeWrite = readStoredState();
    if (
      lifecycleEpoch !== startEpoch
      || !currentBeforeWrite.ok
      || currentBeforeWrite.state.profileId
      || currentBeforeWrite.state.profileToken
    ) {
      const cleanupResult = await requestJson("/v1/me", {
        method: "DELETE",
        token: profileToken,
        signal: input.signal,
        timeoutMs: PROFILE_CLEANUP_TIMEOUT_MS
      });
      return {
        ok: false,
        error: "stale_operation",
        serverCleanupPending: !cleanupResult.ok,
        state: getState()
      };
    }

    const writeResult = writeStoredState(storedState);
    if (!writeResult.ok) {
      const cleanupResult = await requestJson("/v1/me", {
        method: "DELETE",
        token: profileToken,
        signal: input.signal,
        timeoutMs: PROFILE_CLEANUP_TIMEOUT_MS
      });
      if (cleanupResult.ok && lifecycleEpoch === startEpoch) {
        const cleanupState = readStoredState();
        try {
          if (
            cleanupState.ok
            && cleanupState.state.profileId === storedState.profileId
            && cleanupState.state.profileToken === storedState.profileToken
            && cleanupState.state.lifecycleGeneration === storedState.lifecycleGeneration
          ) {
            getStorage()?.removeItem(STORAGE_KEY);
          }
        } catch (cleanupError) {
          // The server record is already gone; a broken browser store cannot be repaired here.
        }
        sessionCollectionBlocked = false;
      }
      return {
        ok: false,
        error: writeResult.error,
        serverCleanupPending: !cleanupResult.ok,
        state: getState()
      };
    }
    if (lifecycleEpoch !== startEpoch) {
      return { ok: false, error: "stale_operation", state: getState() };
    }
    sessionCollectionBlocked = false;
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
    if (
      !configuration.enabled
      || sessionCollectionBlocked
      || !state.collectionEnabled
      || state.pendingAiEvents.length === 0
    ) {
      return { ok: true, state };
    }
    const operationEpoch = lifecycleEpoch;
    const result = await sendEvents(state, state.pendingAiEvents);
    if (!result.ok) return { ...result, state };
    const sentEventIds = new Set(state.pendingAiEvents.map((event) => event.eventId));
    const persistResult = persistInFlightEventState(state, operationEpoch, (currentState) => ({
      ...currentState,
      pendingAiEvents: currentState.pendingAiEvents.filter(
        (event) => !sentEventIds.has(event.eventId)
      )
    }));
    return persistResult.ok
      ? { ok: true, skipped: persistResult.skipped, state: persistResult.state }
      : { ok: false, error: persistResult.error, state: persistResult.state };
  }

  async function init() {
    const readResult = readStoredState();
    if (!readResult.ok) return publicState(readResult);
    if (
      !configuration.enabled
      || sessionCollectionBlocked
      || !readResult.state.collectionEnabled
    ) return publicState(readResult);
    await flushPendingAiEvents(readResult.state);
    return getState();
  }

  async function recordVisit() {
    const readResult = readStoredState();
    if (
      !configuration.enabled
      || sessionCollectionBlocked
      || !readResult.ok
      || !readResult.state.collectionEnabled
    ) {
      return { ok: false, skipped: true, error: readResult.error || "collection_stopped" };
    }

    const state = readResult.state;
    const day = getLocalDay();
    if (state.lastVisitDay === day) return { ok: true, skipped: true, reason: "already_recorded" };

    const eventId = createEventId();
    if (!EVENT_ID_PATTERN.test(eventId)) return { ok: false, error: "secure_id_unavailable" };
    const operationEpoch = lifecycleEpoch;
    const result = await sendEvents(state, [{ type: "visit_day", eventId }]);
    if (!result.ok) return result;
    const persistResult = persistInFlightEventState(state, operationEpoch, (currentState) => ({
      ...currentState,
      lastVisitDay: day
    }));
    return persistResult.ok
      ? { ok: true, skipped: persistResult.skipped }
      : { ok: false, error: persistResult.error };
  }

  async function recordAiGeneration(input = {}) {
    const readResult = readStoredState();
    if (
      !configuration.enabled
      || sessionCollectionBlocked
      || !readResult.ok
      || !readResult.state.collectionEnabled
    ) {
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
    const operationEpoch = lifecycleEpoch;
    const result = await sendEvents(state, [event]);
    if (result.ok) return { ok: true, eventId };

    const persistResult = persistInFlightEventState(state, operationEpoch, (currentState) => ({
      ...currentState,
      pendingAiEvents: [...currentState.pendingAiEvents, event].slice(-MAX_PENDING_AI_EVENTS)
    }));
    return {
      ok: false,
      queued: persistResult.ok && !persistResult.skipped,
      eventId,
      error: result.error
    };
  }

  async function syncOrdinaryMemoryCount(value) {
    const count = Number(value);
    if (!Number.isInteger(count) || count < 0 || count > 50) {
      return { ok: false, skipped: true, error: "invalid_memory_count" };
    }

    const readResult = readStoredState();
    if (
      !configuration.enabled
      || sessionCollectionBlocked
      || !readResult.ok
      || !readResult.state.collectionEnabled
    ) {
      return { ok: false, skipped: true, error: readResult.error || "collection_stopped" };
    }
    const state = readResult.state;
    if (count <= state.ordinaryMemoryCount) {
      return { ok: true, skipped: true, reason: "already_recorded" };
    }

    const eventId = createEventId();
    if (!EVENT_ID_PATTERN.test(eventId)) return { ok: false, error: "secure_id_unavailable" };
    const operationEpoch = lifecycleEpoch;
    const result = await sendEvents(state, [{
      type: "ordinary_gluco_memory_count",
      eventId,
      count
    }]);
    if (!result.ok) return result;
    const persistResult = persistInFlightEventState(state, operationEpoch, (currentState) => ({
      ...currentState,
      ordinaryMemoryCount: Math.max(currentState.ordinaryMemoryCount, count)
    }));
    return persistResult.ok
      ? { ok: true, skipped: persistResult.skipped }
      : { ok: false, error: persistResult.error };
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

    const hasCollectionChange = Object.prototype.hasOwnProperty.call(body, "collectionEnabled");
    let operationEpoch = lifecycleEpoch;
    let stateForUpdate = readResult.state;
    let lifecycleWrite = { ok: true, error: null };
    if (hasCollectionChange) {
      operationEpoch = advanceLifecycleEpoch();
      stateForUpdate = {
        ...readResult.state,
        lifecycleGeneration: nextLifecycleGeneration(readResult.state.lifecycleGeneration)
      };
      if (!body.collectionEnabled) {
        // Stop locally before the network request. A failed/offline PATCH must never
        // leave automatic visit, AI, or memory events active in this browser session.
        sessionCollectionBlocked = true;
        stateForUpdate.collectionEnabled = false;
        stateForUpdate.pendingAiEvents = [];
      }
      lifecycleWrite = writeStoredState(stateForUpdate);
      if (body.collectionEnabled && !lifecycleWrite.ok) {
        return { ok: false, error: lifecycleWrite.error, state: getState() };
      }
    }

    const result = await requestJson("/v1/me", {
      method: "PATCH",
      token: readResult.state.profileToken,
      body
    });
    if (!result.ok) {
      return {
        ...result,
        localStopped: body.collectionEnabled === false,
        localStopPersisted: body.collectionEnabled === false ? lifecycleWrite.ok : undefined,
        state: getState()
      };
    }
    if (hasCollectionChange && !lifecycleWrite.ok) {
      return {
        ok: false,
        error: lifecycleWrite.error,
        localStopped: body.collectionEnabled === false,
        localStopPersisted: false,
        state: getState()
      };
    }
    if (!hasCollectionChange) {
      const currentResult = getCurrentOperationState(
        stateForUpdate,
        operationEpoch,
        { requireCollectionEnabled: false }
      );
      return currentResult.ok
        ? { ok: true, skipped: currentResult.skipped, state: getState() }
        : { ok: false, error: currentResult.error, state: getState() };
    }

    const nextEnabled = body.collectionEnabled === false
      ? false
      : typeof result.data?.profile?.collectionEnabled === "boolean"
        ? result.data.profile.collectionEnabled
        : true;
    const persistResult = persistInFlightEventState(
      stateForUpdate,
      operationEpoch,
      (currentState) => ({ ...currentState, collectionEnabled: nextEnabled }),
      { requireCollectionEnabled: false }
    );
    if (
      persistResult.ok
      && !persistResult.skipped
      && hasCollectionChange
      && body.collectionEnabled
      && nextEnabled
    ) {
      sessionCollectionBlocked = false;
    }
    return persistResult.ok
      ? { ok: true, skipped: persistResult.skipped, state: getState() }
      : { ok: false, error: persistResult.error, state: getState() };
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
    // Deletion also stops local collection first. If the server cannot be reached,
    // keep the credential for retry/export while sending no further events.
    advanceLifecycleEpoch();
    sessionCollectionBlocked = true;
    const stoppedState = {
      ...readResult.state,
      lifecycleGeneration: nextLifecycleGeneration(readResult.state.lifecycleGeneration),
      collectionEnabled: false,
      pendingAiEvents: []
    };
    const localStopWrite = writeStoredState(stoppedState);

    const result = await requestJson("/v1/me", {
      method: "DELETE",
      token: readResult.state.profileToken
    });
    if (!result.ok) {
      return {
        ...result,
        localStopped: true,
        localStopPersisted: localStopWrite.ok,
        state: getState()
      };
    }

    const currentBeforeDelete = readStoredState();
    if (!currentBeforeDelete.ok) {
      return { ok: false, error: currentBeforeDelete.error, state: getState() };
    }
    const currentMatchesDeletedProfile =
      currentBeforeDelete.state.profileId === readResult.state.profileId
      && currentBeforeDelete.state.profileToken === readResult.state.profileToken;
    if (!currentMatchesDeletedProfile) {
      return { ok: true, skipped: true, state: getState() };
    }

    const storage = getStorage();
    if (!storage) return { ok: false, error: "storage_unavailable", state: getState() };
    try {
      storage.removeItem(STORAGE_KEY);
      sessionCollectionBlocked = false;
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
