const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SLOT_KEYS = new Set(["morning", "afternoon", "night"]);
const MODE_KEYS = new Set(["letter", "deep"]);

export const USAGE_RESERVATION_PENDING_TTL_MS = 15 * 60 * 1000;
export const USAGE_RESERVATION_TOMBSTONE_TTL_MS = 48 * 60 * 60 * 1000;
export const USAGE_RESERVATION_MAX_ENTRIES = 512;
export const ATOMIC_USAGE_COUNTER_SCHEMA_VERSION = 1;

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function finiteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegativeInteger(value) {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

function nonNegativeCost(value) {
  return Math.max(0, finiteNumber(value));
}

function roundCost(value) {
  return Number(nonNegativeCost(value).toFixed(4));
}

function roundCostUp(value) {
  const rounded = Math.ceil((nonNegativeCost(value) - Number.EPSILON) * 10_000) / 10_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeSlot(slot) {
  return SLOT_KEYS.has(slot) ? slot : "unknown";
}

function normalizeMode(mode) {
  return MODE_KEYS.has(mode) ? mode : "letter";
}

function emptySlots() {
  return { morning: 0, afternoon: 0, night: 0, unknown: 0 };
}

function emptyModes() {
  return { letter: 0, deep: 0 };
}

function emptyModeSlots() {
  return { letter: emptySlots(), deep: emptySlots() };
}

function ensureCounterState(inputState) {
  const state = clone(inputState);
  const scalarCounters = [
    "dailyGenerationCount",
    "dailyCacheHitCount",
    "dailyRateLimitedCount",
    "dailyTurnstileVerifiedCount",
    "dailyTurnstileFailedCount",
    "monthlyGenerationCount",
    "monthlyCacheHitCount",
    "monthlyBudgetBlockedCount",
    "monthlyAiDisabledCount",
    "monthlyTurnstileVerifiedCount",
    "monthlyTurnstileFailedCount",
    "inputTokens",
    "outputTokens"
  ];

  for (const key of scalarCounters) state[key] = nonNegativeInteger(state[key]);
  state.estimatedCostJpy = roundCost(state.estimatedCostJpy);
  state.dailySlotGenerationCounts = { ...emptySlots(), ...(state.dailySlotGenerationCounts || {}) };
  state.dailySlotCacheHitCounts = { ...emptySlots(), ...(state.dailySlotCacheHitCounts || {}) };
  state.dailySlotRateLimitedCounts = { ...emptySlots(), ...(state.dailySlotRateLimitedCounts || {}) };
  state.dailyModeGenerationCounts = { ...emptyModes(), ...(state.dailyModeGenerationCounts || {}) };
  state.dailyModeCacheHitCounts = { ...emptyModes(), ...(state.dailyModeCacheHitCounts || {}) };
  state.dailyModeRateLimitedCounts = { ...emptyModes(), ...(state.dailyModeRateLimitedCounts || {}) };
  state.monthlyModeGenerationCounts = { ...emptyModes(), ...(state.monthlyModeGenerationCounts || {}) };
  state.monthlyModeCacheHitCounts = { ...emptyModes(), ...(state.monthlyModeCacheHitCounts || {}) };
  state.dailyModeSlotGenerationCounts = {
    ...emptyModeSlots(),
    ...(state.dailyModeSlotGenerationCounts || {})
  };
  state.dailyModeSlotCacheHitCounts = {
    ...emptyModeSlots(),
    ...(state.dailyModeSlotCacheHitCounts || {})
  };
  state.dailyModeSlotRateLimitedCounts = {
    ...emptyModeSlots(),
    ...(state.dailyModeSlotRateLimitedCounts || {})
  };

  for (const mode of MODE_KEYS) {
    state.dailyModeSlotGenerationCounts[mode] = {
      ...emptySlots(),
      ...(state.dailyModeSlotGenerationCounts[mode] || {})
    };
    state.dailyModeSlotCacheHitCounts[mode] = {
      ...emptySlots(),
      ...(state.dailyModeSlotCacheHitCounts[mode] || {})
    };
    state.dailyModeSlotRateLimitedCounts[mode] = {
      ...emptySlots(),
      ...(state.dailyModeSlotRateLimitedCounts[mode] || {})
    };
  }

  state.usageReservations = state.usageReservations && typeof state.usageReservations === "object"
    ? state.usageReservations
    : {};
  return state;
}

function increment(state, key) {
  state[key] = nonNegativeInteger(state[key]) + 1;
}

function incrementMode(state, key, mode) {
  state[key][mode] = nonNegativeInteger(state[key][mode]) + 1;
}

function incrementSlot(state, key, slot) {
  state[key][slot] = nonNegativeInteger(state[key][slot]) + 1;
}

function incrementModeSlot(state, key, mode, slot) {
  state[key][mode][slot] = nonNegativeInteger(state[key][mode][slot]) + 1;
}

function normalizeUsage(usage = {}) {
  return {
    inputTokens: nonNegativeInteger(usage.inputTokens),
    outputTokens: nonNegativeInteger(usage.outputTokens),
    estimatedCostJpy: roundCost(usage.estimatedCostJpy)
  };
}

function addActualUsage(state, usage) {
  const normalized = normalizeUsage(usage);
  state.inputTokens += normalized.inputTokens;
  state.outputTokens += normalized.outputTokens;
  state.estimatedCostJpy = roundCost(state.estimatedCostJpy + normalized.estimatedCostJpy);
  return normalized;
}

function toTimestamp(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? timestamp : null;
}

function finalizeReservation(reservation, nowIso, reason) {
  reservation.status = "released";
  reservation.reason = reason;
  reservation.updatedAt = nowIso;
  reservation.finalizedAt = nowIso;
}

function pruneReservations(state, now = new Date()) {
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  for (const reservation of Object.values(state.usageReservations)) {
    if (!reservation || typeof reservation !== "object") continue;
    if (reservation.status === "pending") {
      const createdAtMs = toTimestamp(reservation.createdAt);
      if (reservation.dayKey !== state.dayKey) {
        reservation.dayKey = state.dayKey;
        reservation.monthKey = state.monthKey;
        reservation.rolledOverAt = nowIso;
        reservation.updatedAt = nowIso;
      }
      if (createdAtMs === null || nowMs - createdAtMs >= USAGE_RESERVATION_PENDING_TTL_MS) {
        finalizeReservation(reservation, nowIso, "reservation_expired");
      }
    }
  }

  const pendingEntries = [];
  const terminalEntries = [];
  for (const [requestId, reservation] of Object.entries(state.usageReservations)) {
    if (!reservation || typeof reservation !== "object") continue;
    if (reservation.status === "pending") {
      pendingEntries.push([requestId, reservation]);
      continue;
    }

    const finalizedAtMs = toTimestamp(reservation.finalizedAt || reservation.updatedAt);
    if (finalizedAtMs !== null && nowMs - finalizedAtMs < USAGE_RESERVATION_TOMBSTONE_TTL_MS) {
      terminalEntries.push([requestId, reservation]);
    }
  }

  terminalEntries.sort((left, right) => {
    const leftMs = toTimestamp(left[1].updatedAt) || 0;
    const rightMs = toTimestamp(right[1].updatedAt) || 0;
    return rightMs - leftMs;
  });
  const terminalLimit = Math.max(0, USAGE_RESERVATION_MAX_ENTRIES - pendingEntries.length);
  state.usageReservations = Object.fromEntries([
    ...pendingEntries,
    ...terminalEntries.slice(0, terminalLimit)
  ]);
  return state;
}

function prepareState(inputState, now) {
  return pruneReservations(ensureCounterState(inputState), now);
}

function reservationResult(state, fields = {}) {
  return { ...fields, state };
}

function createReservation({ requestId, slot, analysisMode, reservedCostJpy, state, now }) {
  const timestamp = now.toISOString();
  return {
    requestId,
    status: "pending",
    dayKey: state.dayKey,
    monthKey: state.monthKey,
    slot,
    analysisMode,
    reservedCostJpy: roundCostUp(reservedCostJpy),
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function rejectReservation({ state, reservation, status, reason, now }) {
  const timestamp = now.toISOString();
  reservation.status = "released";
  reservation.reason = reason;
  reservation.rejectionStatus = status;
  reservation.updatedAt = timestamp;
  reservation.finalizedAt = timestamp;
  state.usageReservations[reservation.requestId] = reservation;

  if (status === "rate_limited") {
    increment(state, "dailyRateLimitedCount");
    incrementSlot(state, "dailySlotRateLimitedCounts", reservation.slot);
    incrementMode(state, "dailyModeRateLimitedCounts", reservation.analysisMode);
    incrementModeSlot(state, "dailyModeSlotRateLimitedCounts", reservation.analysisMode, reservation.slot);
  } else if (status === "budget_stopped") {
    increment(state, "monthlyBudgetBlockedCount");
  } else if (status === "ai_disabled") {
    increment(state, "monthlyAiDisabledCount");
  }

  state.updatedAt = timestamp;
  return reservationResult(state, { ok: false, status, reason, requestId: reservation.requestId });
}

export function normalizeUsageRequestId(value) {
  const requestId = typeof value === "string" ? value.trim() : "";
  return UUID_V4_PATTERN.test(requestId) ? requestId.toLowerCase() : null;
}

export function markAtomicUsageState(inputState, now = new Date()) {
  const state = clone(inputState);
  state.atomicUsageCounterSchemaVersion = ATOMIC_USAGE_COUNTER_SCHEMA_VERSION;
  state.atomicUsageCounterActivatedAt = state.atomicUsageCounterActivatedAt || now.toISOString();
  return state;
}

export function isAtomicUsageStateActive(state) {
  return nonNegativeInteger(state?.atomicUsageCounterSchemaVersion) >= ATOMIC_USAGE_COUNTER_SCHEMA_VERSION;
}

export function shouldUseAtomicUsageCounter(config = {}, state = {}) {
  return config.atomicUsageCounterEnabled === true || isAtomicUsageStateActive(state);
}

export function carryAtomicUsageStateAcrossMonth(previousState = {}, freshState = {}) {
  const state = clone(freshState);
  if (previousState.usageReservations && typeof previousState.usageReservations === "object") {
    state.usageReservations = clone(previousState.usageReservations);
  }
  if (isAtomicUsageStateActive(previousState)) {
    state.atomicUsageCounterSchemaVersion = previousState.atomicUsageCounterSchemaVersion;
    state.atomicUsageCounterActivatedAt = previousState.atomicUsageCounterActivatedAt;
  }
  return state;
}

export function applyLegacyUsageStateSaveBoundary(currentState, incomingState) {
  if (isAtomicUsageStateActive(currentState)) {
    return {
      accepted: false,
      reason: "atomic_usage_counter_active",
      state: clone(currentState)
    };
  }

  return {
    accepted: true,
    reason: "legacy_save_allowed",
    state: clone(incomingState)
  };
}

export function getPendingUsageTotals(inputState, now = new Date()) {
  const state = prepareState(inputState, now);
  const totals = {
    count: 0,
    reservedCostJpy: 0,
    slotCounts: emptySlots(),
    modeCounts: emptyModes()
  };

  for (const reservation of Object.values(state.usageReservations)) {
    if (reservation?.status !== "pending" || reservation.dayKey !== state.dayKey) continue;
    const slot = normalizeSlot(reservation.slot);
    const mode = normalizeMode(reservation.analysisMode);
    totals.count += 1;
    totals.slotCounts[slot] += 1;
    totals.modeCounts[mode] += 1;
    totals.reservedCostJpy += nonNegativeCost(reservation.reservedCostJpy);
  }

  totals.reservedCostJpy = roundCostUp(totals.reservedCostJpy);
  return { state, totals };
}

export function applyAtomicTurnstileEvent(inputState, input = {}, now = new Date()) {
  const state = prepareState(inputState, now);
  if (input.required !== true) {
    return { ok: true, status: "not_required", state };
  }

  if (input.verified === true) {
    increment(state, "dailyTurnstileVerifiedCount");
    increment(state, "monthlyTurnstileVerifiedCount");
  } else {
    increment(state, "dailyTurnstileFailedCount");
    increment(state, "monthlyTurnstileFailedCount");
  }
  state.updatedAt = now.toISOString();
  return { ok: true, status: input.verified === true ? "verified" : "failed", state };
}

export function applyAtomicCacheHit(inputState, input = {}, now = new Date()) {
  const state = prepareState(inputState, now);
  const slot = normalizeSlot(input.slot);
  const analysisMode = normalizeMode(input.analysisMode);
  increment(state, "dailyCacheHitCount");
  increment(state, "monthlyCacheHitCount");
  incrementSlot(state, "dailySlotCacheHitCounts", slot);
  incrementMode(state, "dailyModeCacheHitCounts", analysisMode);
  incrementMode(state, "monthlyModeCacheHitCounts", analysisMode);
  incrementModeSlot(state, "dailyModeSlotCacheHitCounts", analysisMode, slot);
  state.updatedAt = now.toISOString();
  return { ok: true, status: "cached", state };
}

export function applyAtomicGenerationReserve(inputState, input = {}, config = {}, now = new Date()) {
  let state = prepareState(inputState, now);
  const requestId = normalizeUsageRequestId(input.requestId);
  if (!requestId || !Number.isFinite(Number(input.reservedCostJpy)) || Number(input.reservedCostJpy) < 0) {
    return reservationResult(state, { ok: false, status: "invalid_request", reason: "invalid_request" });
  }

  const existing = state.usageReservations[requestId];
  if (existing) {
    const status = existing.status === "pending"
      ? "request_in_progress"
      : existing.status === "completed"
        ? "request_already_completed"
        : existing.rejectionStatus || "request_already_released";
    return reservationResult(state, {
      ok: false,
      status,
      reason: existing.reason || status,
      requestId,
      idempotent: true
    });
  }

  const slot = normalizeSlot(input.slot);
  const analysisMode = normalizeMode(input.analysisMode);
  const reservation = createReservation({
    requestId,
    slot,
    analysisMode,
    reservedCostJpy: input.reservedCostJpy,
    state,
    now
  });
  const forcedStatus = ["rate_limited", "budget_stopped", "ai_disabled"].includes(input.forcedStatus)
    ? input.forcedStatus
    : null;
  if (forcedStatus) {
    return rejectReservation({
      state,
      reservation,
      status: forcedStatus,
      reason: String(input.forcedReason || "manual"),
      now
    });
  }

  if (config.aiEnabled !== true) {
    return rejectReservation({ state, reservation, status: "ai_disabled", reason: "ai_disabled", now });
  }

  const pending = getPendingUsageTotals(state, now);
  state = pending.state;
  const stopBudgetJpy = nonNegativeCost(config.stopBudgetJpy);
  const committedCostJpy = state.estimatedCostJpy + pending.totals.reservedCostJpy;
  if (
    committedCostJpy >= stopBudgetJpy
    || committedCostJpy + reservation.reservedCostJpy >= stopBudgetJpy
  ) {
    return rejectReservation({ state, reservation, status: "budget_stopped", reason: "budget", now });
  }

  const dailyLimit = nonNegativeInteger(config.dailyGenerationLimit);
  if (state.dailyGenerationCount + pending.totals.count >= dailyLimit) {
    return rejectReservation({ state, reservation, status: "rate_limited", reason: "total", now });
  }

  const slotLimit = nonNegativeInteger(config.slotGenerationLimit);
  if (state.dailySlotGenerationCounts[slot] + pending.totals.slotCounts[slot] >= slotLimit) {
    return rejectReservation({ state, reservation, status: "rate_limited", reason: "slot", now });
  }

  state.usageReservations[requestId] = reservation;
  state.updatedAt = now.toISOString();
  return reservationResult(state, {
    ok: true,
    status: "reserved",
    requestId,
    reservedCostJpy: reservation.reservedCostJpy
  });
}

export function applyAtomicGenerationComplete(inputState, input = {}, now = new Date()) {
  const state = prepareState(inputState, now);
  const requestId = normalizeUsageRequestId(input.requestId);
  const reservation = requestId ? state.usageReservations[requestId] : null;
  if (!reservation) {
    return reservationResult(state, { ok: false, status: "reservation_not_found", requestId });
  }
  if (reservation.status === "completed") {
    return reservationResult(state, { ok: true, status: "completed", requestId, idempotent: true });
  }
  if (reservation.status !== "pending") {
    return reservationResult(state, {
      ok: false,
      status: "reservation_already_released",
      reason: reservation.reason || "released",
      requestId,
      idempotent: true
    });
  }

  increment(state, "dailyGenerationCount");
  increment(state, "monthlyGenerationCount");
  incrementSlot(state, "dailySlotGenerationCounts", reservation.slot);
  incrementMode(state, "dailyModeGenerationCounts", reservation.analysisMode);
  incrementMode(state, "monthlyModeGenerationCounts", reservation.analysisMode);
  incrementModeSlot(state, "dailyModeSlotGenerationCounts", reservation.analysisMode, reservation.slot);
  const usage = addActualUsage(state, input.actualUsage);
  const timestamp = now.toISOString();
  reservation.status = "completed";
  reservation.actualUsage = usage;
  reservation.updatedAt = timestamp;
  reservation.finalizedAt = timestamp;
  state.updatedAt = timestamp;
  return reservationResult(state, { ok: true, status: "completed", requestId });
}

export function applyAtomicGenerationRelease(inputState, input = {}, now = new Date()) {
  const state = prepareState(inputState, now);
  const requestId = normalizeUsageRequestId(input.requestId);
  const reservation = requestId ? state.usageReservations[requestId] : null;
  if (!reservation) {
    return reservationResult(state, { ok: false, status: "reservation_not_found", requestId });
  }
  if (reservation.status !== "pending") {
    return reservationResult(state, {
      ok: reservation.status === "released",
      status: reservation.status,
      requestId,
      idempotent: true
    });
  }

  const usage = addActualUsage(state, input.actualUsage);
  const timestamp = now.toISOString();
  reservation.status = "released";
  reservation.reason = String(input.reason || "generation_released").slice(0, 80);
  reservation.actualUsage = usage;
  reservation.updatedAt = timestamp;
  reservation.finalizedAt = timestamp;
  state.updatedAt = timestamp;
  return reservationResult(state, { ok: true, status: "released", requestId });
}

export function estimateMaximumOpenAiCostJpy({
  instructionsUtf8Bytes = 0,
  initialPromptUtf8Bytes = 0,
  retryPromptUtf8Bytes = 0,
  initialMaxOutputTokens = 0,
  retryMaxOutputTokens = 0,
  inputPriceJpyPerMillionTokens = 0,
  outputPriceJpyPerMillionTokens = 0,
  framingInputTokensPerCall = 4096,
  transportAttemptsPerStage = 2
} = {}) {
  const attempts = Math.max(1, nonNegativeInteger(transportAttemptsPerStage));
  const instructions = nonNegativeInteger(instructionsUtf8Bytes);
  const framing = nonNegativeInteger(framingInputTokensPerCall);
  const initialInputTokens = instructions + nonNegativeInteger(initialPromptUtf8Bytes) + framing;
  const retryInputTokens = instructions + nonNegativeInteger(retryPromptUtf8Bytes) + framing;
  const inputTokens = attempts * (initialInputTokens + retryInputTokens);
  const outputTokens = attempts * (
    nonNegativeInteger(initialMaxOutputTokens) + nonNegativeInteger(retryMaxOutputTokens)
  );
  const costJpy = inputTokens * nonNegativeCost(inputPriceJpyPerMillionTokens) / 1_000_000
    + outputTokens * nonNegativeCost(outputPriceJpyPerMillionTokens) / 1_000_000;

  return {
    inputTokens,
    outputTokens,
    reservedCostJpy: roundCostUp(costJpy)
  };
}
