const MAX_VISIBLE_PROFILES = 100;

// This is intentionally the only production SQL statement in the administrator Worker.
// It reads an existing allowlisted view and never returns identifiers, timestamps, or daily rows.
export const ADMIN_USAGE_SELECT = `
  SELECT
    display_name AS displayName,
    sharing_enabled AS collectionEnabled,
    active_days AS activeDays,
    ai_generation_success_total AS aiGenerationSuccessTotal,
    ordinary_gluco_memory_count AS ordinaryGlucoMemoryCount
  FROM admin_device_usage
  ORDER BY last_seen_at DESC, display_name COLLATE NOCASE ASC
  LIMIT 101
`;

function requireDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("USAGE_DB binding is unavailable");
  }
  return database;
}

function boundedInteger(value, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function normalizeDisplayName(value) {
  const normalized = Array.from(
    String(value || "")
      .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, "")
      .replace(/\s+/gu, " ")
      .trim(),
  ).slice(0, 30).join("");
  return normalized || "（表示名なし）";
}

function toAdminProfile(row) {
  return Object.freeze({
    displayName: normalizeDisplayName(row?.displayName),
    collectionEnabled: Number(row?.collectionEnabled) === 1,
    activeDays: boundedInteger(row?.activeDays, 0, 90),
    aiGenerationSuccessTotal: boundedInteger(row?.aiGenerationSuccessTotal, 0, 2700),
    ordinaryGlucoMemoryCount: boundedInteger(row?.ordinaryGlucoMemoryCount, 0, 50),
  });
}

export async function readAdminUsage(database) {
  const db = requireDatabase(database);
  const result = await db.prepare(ADMIN_USAGE_SELECT).all();
  const rows = Array.isArray(result?.results) ? result.results : [];
  const profiles = rows.slice(0, MAX_VISIBLE_PROFILES).map(toAdminProfile);

  return Object.freeze({
    profiles: Object.freeze(profiles),
    truncated: rows.length > MAX_VISIBLE_PROFILES,
  });
}

export const adminStoreTesting = Object.freeze({
  MAX_VISIBLE_PROFILES,
  normalizeDisplayName,
});
