const DAY_MS = 24 * 60 * 60 * 1000;

export const PUBLIC_USAGE_WINDOW_DAYS = 30;
export const PUBLIC_USAGE_MIN_CONTRIBUTORS = 10;

const PUBLIC_AGGREGATE_SQL = `
  WITH eligible_daily AS (
    SELECT
      u.profile_id,
      u.day,
      u.visit_day_count,
      u.ai_generation_success_count,
      u.ordinary_gluco_memory_count
    FROM usage_daily AS u
    INNER JOIN profiles AS p ON p.id = u.profile_id
    WHERE p.collection_enabled = 1
      AND u.day BETWEEN ?1 AND ?2
      AND (
        u.visit_day_count > 0
        OR u.ai_generation_success_count > 0
        OR u.ordinary_gluco_memory_count > 0
      )
  ),
  profile_rollups AS (
    SELECT
      profile_id,
      SUM(visit_day_count) AS active_days,
      SUM(ai_generation_success_count) AS ai_successes,
      MAX(ordinary_gluco_memory_count) AS ordinary_memories
    FROM eligible_daily
    GROUP BY profile_id
  )
  SELECT
    COUNT(*) AS contributing_profiles,
    COALESCE(SUM(active_days), 0) AS active_days_total,
    COALESCE(SUM(ai_successes), 0) AS ai_success_total,
    COALESCE(SUM(ordinary_memories), 0) AS ordinary_memories_total
  FROM profile_rollups
`;

function requireDatabase(database) {
  if (!database || typeof database.prepare !== "function") {
    throw new TypeError("USAGE_DB binding is unavailable");
  }
  return database;
}

function toDayKey(nowMs, timezoneOffsetHours) {
  const shifted = new Date(nowMs + timezoneOffsetHours * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

function shiftDayKey(dayKey, dayOffset) {
  const midnightUtc = Date.parse(`${dayKey}T00:00:00.000Z`);
  return new Date(midnightUtc + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

function boundedCount(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

export function getPublicUsagePeriod(
  nowMs = Date.now(),
  timezoneOffsetHours = 9,
  windowDays = PUBLIC_USAGE_WINDOW_DAYS,
) {
  const today = toDayKey(nowMs, timezoneOffsetHours);
  const throughDay = shiftDayKey(today, -1);
  return Object.freeze({
    fromDay: shiftDayKey(throughDay, -(windowDays - 1)),
    throughDay,
    windowDays,
    timezone: "Asia/Tokyo",
  });
}

export async function readPublicUsageAggregate(database, options = {}) {
  const db = requireDatabase(database);
  const minimumContributors = Number.isSafeInteger(options.minimumContributors)
    ? Math.max(1, options.minimumContributors)
    : PUBLIC_USAGE_MIN_CONTRIBUTORS;
  const period = getPublicUsagePeriod(
    Number(options.nowMs ?? Date.now()),
    Number(options.timezoneOffsetHours ?? 9),
    Number(options.windowDays ?? PUBLIC_USAGE_WINDOW_DAYS),
  );
  const row = await db.prepare(PUBLIC_AGGREGATE_SQL)
    .bind(period.fromDay, period.throughDay)
    .first();
  const contributingProfiles = boundedCount(row?.contributing_profiles);

  if (contributingProfiles < minimumContributors) {
    return Object.freeze({
      status: "suppressed",
      period,
      minimumContributors,
    });
  }

  return Object.freeze({
    status: "available",
    period,
    minimumContributors,
    totals: Object.freeze({
      contributingDeviceProfiles: contributingProfiles,
      activeDays: boundedCount(row?.active_days_total),
      successfulAiAnalyses: boundedCount(row?.ai_success_total),
      ordinaryGlucoMemories: boundedCount(row?.ordinary_memories_total),
    }),
  });
}

export const publicAggregateTesting = Object.freeze({
  PUBLIC_AGGREGATE_SQL,
  shiftDayKey,
  toDayKey,
});
