import { createD1AccountAuthStore } from "./account-auth-store.js";

const AUTH_RETENTION_AFTER_EXPIRY_MS = 24 * 60 * 60 * 1000;
const GLOBAL_SEND_RESERVATION_RETENTION_MS = 24 * 60 * 60 * 1000;

export class AccountAuthCleanupError extends Error {
  constructor() {
    super("cleanup_unavailable");
    this.name = "AccountAuthCleanupError";
    this.code = "cleanup_unavailable";
  }
}

export async function runAccountAuthCleanup(
  env = {},
  controller,
  dependencies = {},
) {
  if (env?.ACCOUNT_AUTH_CLEANUP_ENABLED !== "true") {
    return Object.freeze({ cleaned: false, skipped: true });
  }
  const scheduledTime = controller?.scheduledTime;
  if (!Number.isSafeInteger(scheduledTime) || scheduledTime < 0) {
    throw new AccountAuthCleanupError();
  }
  try {
    const createStore = dependencies.createStore || createD1AccountAuthStore;
    const store = createStore(env.PLUS_DB);
    const result = await store.cleanupExpiredAuthRecords({
      challengeExpiresBefore: Math.max(
        0,
        scheduledTime - AUTH_RETENTION_AFTER_EXPIRY_MS,
      ),
      reservationReservedBefore: Math.max(
        0,
        scheduledTime - GLOBAL_SEND_RESERVATION_RETENTION_MS,
      ),
    });
    if (result?.cleaned !== true) throw new Error("cleanup_failed");
    return Object.freeze({ cleaned: true });
  } catch {
    throw new AccountAuthCleanupError();
  }
}
