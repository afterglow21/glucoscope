const COUNTER_KEYS = new Set(["bucket", "limit"]);

export function validateCounterInput(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("invalid counter payload");
  }
  for (const key of Object.keys(payload)) {
    if (!COUNTER_KEYS.has(key)) throw new TypeError("invalid counter payload");
  }
  if (typeof payload.bucket !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(payload.bucket)) {
    throw new TypeError("invalid counter bucket");
  }
  const limit = Number(payload.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000) {
    throw new TypeError("invalid counter limit");
  }
  return Object.freeze({ bucket: payload.bucket, limit });
}

export async function consumeCounterStorage(storage, rawPayload) {
  const payload = validateCounterInput(rawPayload);
  return storage.transaction(async (transaction) => {
    const storedBucket = await transaction.get("bucket");
    const storedCount = await transaction.get("count");
    let count = storedBucket === payload.bucket && Number.isSafeInteger(storedCount) ? storedCount : 0;

    if (count >= payload.limit) {
      return Object.freeze({ allowed: false, count, limit: payload.limit });
    }

    count += 1;
    await transaction.put({ bucket: payload.bucket, count });
    return Object.freeze({ allowed: true, count, limit: payload.limit });
  });
}
