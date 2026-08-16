const SESSION_KEY = "device-session";
const RECORD_KEYS = new Set([
  "tokenId",
  "createdAt",
  "lastSeenAt",
  "idleExpiresAt",
  "revoked",
  "sourceFingerprint",
  "dayBucket",
  "dayCount",
]);
const TOKEN_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const CLEANUP_RETRY_DELAY_MS = 60 * 60 * 1000;

function isSafeTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validateTokenId(value) {
  if (typeof value !== "string" || !TOKEN_ID_PATTERN.test(value)) {
    throw new TypeError("invalid device session token id");
  }
  return value;
}

function validateNow(value) {
  if (!isSafeTimestamp(value)) throw new TypeError("invalid device session timestamp");
  return value;
}

function validateIdleTtl(value) {
  if (!Number.isSafeInteger(value) || value < 60_000 || value > 366 * 24 * 60 * 60 * 1000) {
    throw new TypeError("invalid device session idle ttl");
  }
  return value;
}

function validateDailyLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000_000) {
    throw new TypeError("invalid device session daily limit");
  }
  return value;
}

function validateFingerprint(value, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !TOKEN_ID_PATTERN.test(value)) {
    throw new TypeError("invalid device session source fingerprint");
  }
  return value;
}

function fixedTimeOpaqueEqual(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length
  ) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function utcDayBucket(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function validateDeviceSessionRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).length !== RECORD_KEYS.size) return null;
  for (const key of Object.keys(value)) {
    if (!RECORD_KEYS.has(key)) return null;
  }
  if (!TOKEN_ID_PATTERN.test(String(value.tokenId || ""))) return null;
  if (!isSafeTimestamp(value.createdAt)) return null;
  if (!isSafeTimestamp(value.lastSeenAt) || value.lastSeenAt < value.createdAt) return null;
  if (!isSafeTimestamp(value.idleExpiresAt) || value.idleExpiresAt <= value.lastSeenAt) return null;
  if (typeof value.revoked !== "boolean") return null;
  if (value.sourceFingerprint !== null && !TOKEN_ID_PATTERN.test(String(value.sourceFingerprint))) {
    return null;
  }
  if (value.dayBucket !== null && !/^\d{4}-\d{2}-\d{2}$/u.test(String(value.dayBucket))) {
    return null;
  }
  if (!Number.isSafeInteger(value.dayCount) || value.dayCount < 0) return null;
  return Object.freeze({ ...value });
}

export async function createDeviceSessionStorage(storage, rawInput) {
  const tokenId = validateTokenId(rawInput?.tokenId);
  const nowMs = validateNow(rawInput?.nowMs);
  const idleTtlMs = validateIdleTtl(rawInput?.idleTtlMs);
  const idleExpiresAt = nowMs + idleTtlMs;
  if (!Number.isSafeInteger(idleExpiresAt)) throw new TypeError("invalid device session expiry");

  const record = Object.freeze({
    tokenId,
    createdAt: nowMs,
    lastSeenAt: nowMs,
    idleExpiresAt,
    revoked: false,
    sourceFingerprint: null,
    dayBucket: null,
    dayCount: 0,
  });
  return storage.transaction(async (transaction) => {
    await transaction.put(SESSION_KEY, record);
    await transaction.setAlarm(idleExpiresAt);
    return Object.freeze({ status: "active", idleExpiresAt });
  });
}

export async function authorizeDeviceSessionStorage(storage, rawInput) {
  const tokenId = validateTokenId(rawInput?.tokenId);
  const nowMs = validateNow(rawInput?.nowMs);
  const idleTtlMs = validateIdleTtl(rawInput?.idleTtlMs);
  const consume = rawInput?.consume === true;
  const dailyLimit = consume ? validateDailyLimit(rawInput?.dailyLimit) : 1;
  const sourceFingerprint = rawInput?.sourceFingerprint === null
    ? null
    : validateFingerprint(rawInput?.sourceFingerprint);

  return storage.transaction(async (transaction) => {
    const stored = await transaction.get(SESSION_KEY);
    const record = validateDeviceSessionRecord(stored);
    if (!record) {
      if (stored !== undefined) await transaction.delete(SESSION_KEY);
      await transaction.deleteAlarm();
      return Object.freeze({ status: "invalid" });
    }
    if (!fixedTimeOpaqueEqual(record.tokenId, tokenId)) {
      return Object.freeze({ status: "invalid" });
    }
    if (record.revoked) {
      await transaction.delete(SESSION_KEY);
      await transaction.deleteAlarm();
      return Object.freeze({ status: "invalid" });
    }
    if (record.idleExpiresAt <= nowMs) {
      await transaction.delete(SESSION_KEY);
      await transaction.deleteAlarm();
      return Object.freeze({ status: "invalid", expired: true });
    }

    if (
      sourceFingerprint !== null &&
      record.sourceFingerprint !== null &&
      !fixedTimeOpaqueEqual(record.sourceFingerprint, sourceFingerprint)
    ) {
      return Object.freeze({ status: "source_mismatch" });
    }

    const dayBucket = utcDayBucket(nowMs);
    let dayCount = record.dayBucket === dayBucket ? record.dayCount : 0;
    if (consume && dayCount >= dailyLimit) {
      return Object.freeze({ status: "rate_limited", dayCount, dailyLimit });
    }
    if (consume) dayCount += 1;

    const lastSeenAt = Math.max(record.lastSeenAt, nowMs);
    const idleExpiresAt = lastSeenAt + idleTtlMs;
    if (!Number.isSafeInteger(idleExpiresAt)) throw new TypeError("invalid device session expiry");
    const next = Object.freeze({
      ...record,
      lastSeenAt,
      idleExpiresAt,
      sourceFingerprint: record.sourceFingerprint || sourceFingerprint,
      dayBucket: consume ? dayBucket : record.dayBucket,
      dayCount,
    });
    await transaction.put(SESSION_KEY, next);
    await transaction.setAlarm(idleExpiresAt);
    return Object.freeze({
      status: "active",
      bound: next.sourceFingerprint !== null,
      dayCount: next.dayCount,
      idleExpiresAt,
    });
  });
}

export async function revokeDeviceSessionStorage(storage, rawInput) {
  const tokenId = validateTokenId(rawInput?.tokenId);
  return storage.transaction(async (transaction) => {
    const record = validateDeviceSessionRecord(await transaction.get(SESSION_KEY));
    if (!record || !fixedTimeOpaqueEqual(record.tokenId, tokenId)) {
      return Object.freeze({ status: "absent" });
    }
    await transaction.put(SESSION_KEY, Object.freeze({ ...record, revoked: true }));
    await transaction.delete(SESSION_KEY);
    await transaction.deleteAlarm();
    return Object.freeze({ status: "revoked" });
  });
}

export async function cleanupDeviceSessionStorage(storage, rawInput) {
  const nowMs = validateNow(rawInput?.nowMs);
  return storage.transaction(async (transaction) => {
    const stored = await transaction.get(SESSION_KEY);
    const record = validateDeviceSessionRecord(stored);
    if (!record || record.revoked || record.idleExpiresAt <= nowMs) {
      if (stored !== undefined) await transaction.delete(SESSION_KEY);
      await transaction.deleteAlarm();
      return Object.freeze({ status: "deleted" });
    }
    await transaction.setAlarm(record.idleExpiresAt);
    return Object.freeze({ status: "active", nextAlarmAt: record.idleExpiresAt });
  });
}

export async function cleanupDeviceSessionStorageWithRetry(storage, rawInput) {
  const nowMs = validateNow(rawInput?.nowMs);
  try {
    return await cleanupDeviceSessionStorage(storage, { nowMs });
  } catch (error) {
    const retryAt = nowMs + CLEANUP_RETRY_DELAY_MS;
    if (!Number.isSafeInteger(retryAt)) throw error;
    try {
      // Cloudflare retries a thrown alarm only a bounded number of times.
      // Persist a fresh alarm so a longer storage incident does not strand an
      // already-invalid anonymous record after those platform retries end.
      await storage.setAlarm(retryAt);
    } catch {
      // Preserve the original failure so Cloudflare's built-in alarm retry is
      // still used when even the fallback alarm cannot be persisted.
      throw error;
    }
    return Object.freeze({ status: "retry_scheduled", nextAlarmAt: retryAt });
  }
}

export const DEVICE_SESSION_STORAGE_KEY = SESSION_KEY;
