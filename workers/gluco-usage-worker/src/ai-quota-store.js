function requireDatabase(database) {
  if (
    !database
    || typeof database.prepare !== "function"
    || typeof database.batch !== "function"
  ) {
    throw new TypeError("USAGE_DB binding is unavailable");
  }
  return database;
}

function firstResult(result) {
  return Array.isArray(result?.results) ? result.results[0] || null : null;
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function requireQuotaWindow(value) {
  if (value === "day" || value === "retained") return value;
  throw new TypeError("quota window is invalid");
}

function attemptFromRow(row) {
  if (!row) return null;
  return {
    requestId: row.requestId,
    reservationId: row.reservationId,
    day: row.day,
    status: row.status,
    tier: row.tier,
    dailyLimit: numberValue(row.dailyLimit),
    analysisMode: row.analysisMode,
    reservedAt: numberValue(row.reservedAt),
    expiresAt: numberValue(row.expiresAt),
    completedAt: row.completedAt === null || row.completedAt === undefined
      ? null
      : numberValue(row.completedAt),
    releaseReason: row.releaseReason || null,
  };
}

const ATTEMPT_SELECT = `
  request_id AS requestId,
  reservation_id AS reservationId,
  day,
  status,
  tier_at_reserve AS tier,
  daily_limit AS dailyLimit,
  analysis_mode AS analysisMode,
  reserved_at AS reservedAt,
  expires_at AS expiresAt,
  completed_at AS completedAt,
  release_reason AS releaseReason
`;

function quotaSnapshot(attempt, dayRow, activeReservationRow) {
  const successful = numberValue(dayRow?.successCount);
  const activeReservations = numberValue(activeReservationRow?.activeReservations);
  const dailyLimit = attempt?.dailyLimit || numberValue(dayRow?.dailyLimit);
  return {
    attempt,
    successful,
    activeReservations,
    dailyLimit,
    remaining: Math.max(0, dailyLimit - successful - activeReservations),
  };
}

export function createD1AiQuotaStore(database) {
  const db = requireDatabase(database);

  return Object.freeze({
    async findDeviceProfileByTokenHash({ tokenHash }) {
      const row = await db.prepare(`
        SELECT id FROM profiles WHERE token_hash = ?1 LIMIT 1
      `).bind(tokenHash).first();
      return row?.id ? { id: String(row.id) } : null;
    },

    async reserve({
      subjectKey,
      subjectKind,
      deviceProfileId,
      day,
      requestId,
      reservationId,
      tier,
      dailyLimit,
      analysisMode,
      quotaWindow = "day",
      now,
      expiresAt,
    }) {
      const retainedWindow = requireQuotaWindow(quotaWindow) === "retained";
      const insertSuccessDayFilter = retainedWindow ? "" : "AND day = ?5";
      const insertActiveDayFilter = retainedWindow ? "" : "AND day = ?5";
      const snapshotSuccessDayFilter = retainedWindow ? "" : "AND day = ?2";
      const snapshotActiveDayFilter = retainedWindow ? "" : "AND day = ?2";
      const results = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO ai_quota_days (
            subject_key, subject_kind, device_profile_id, day, success_count,
            last_completed_reservation_id, updated_at
          ) VALUES (?1, ?2, ?3, ?4, 0, NULL, ?5)
        `).bind(subjectKey, subjectKind, deviceProfileId, day, now),
        db.prepare(`
          INSERT OR IGNORE INTO ai_quota_attempts (
            subject_key, subject_kind, request_id, reservation_id, day,
            status, tier_at_reserve, daily_limit, analysis_mode,
            reserved_at, expires_at, completed_at, release_reason
          )
          SELECT
            ?1, ?2, ?3, ?4, ?5,
            'reserved', ?6, ?7, ?8,
            ?9, ?10, NULL, NULL
          WHERE (
            SELECT COALESCE(SUM(success_count), 0)
            FROM ai_quota_days
            WHERE subject_key = ?1 ${insertSuccessDayFilter}
          ) + (
            SELECT COUNT(*)
            FROM ai_quota_attempts
            WHERE subject_key = ?1 ${insertActiveDayFilter}
              AND status = 'reserved' AND expires_at > ?9
          ) < ?7
        `).bind(
          subjectKey,
          subjectKind,
          requestId,
          reservationId,
          day,
          tier,
          dailyLimit,
          analysisMode,
          now,
          expiresAt,
        ),
        db.prepare(`
          SELECT ${ATTEMPT_SELECT}
          FROM ai_quota_attempts
          WHERE subject_key = ?1 AND request_id = ?2
          LIMIT 1
        `).bind(subjectKey, requestId),
        db.prepare(`
          SELECT COALESCE(SUM(success_count), 0) AS successCount, ?3 AS dailyLimit
          FROM ai_quota_days
          WHERE subject_key = ?1 ${snapshotSuccessDayFilter}
          LIMIT 1
        `).bind(subjectKey, day, dailyLimit),
        db.prepare(`
          SELECT COUNT(*) AS activeReservations
          FROM ai_quota_attempts
          WHERE subject_key = ?1 ${snapshotActiveDayFilter}
            AND status = 'reserved' AND expires_at > ?3
        `).bind(subjectKey, day, now),
      ]);

      const attempt = attemptFromRow(firstResult(results[2]));
      const snapshot = quotaSnapshot(
        attempt,
        firstResult(results[3]),
        firstResult(results[4]),
      );

      if (!attempt) return { status: "limit_reached", ...snapshot };
      if (attempt.status === "succeeded") {
        return { status: "already_succeeded", ...snapshot };
      }
      if (attempt.status === "released") {
        return { status: "already_released", ...snapshot };
      }
      if (attempt.expiresAt <= now) return { status: "expired", ...snapshot };
      if (attempt.reservationId !== reservationId) {
        return { status: "in_progress", ...snapshot };
      }
      return { status: "reserved", ...snapshot };
    },

    async complete({ reservationId, now }) {
      const results = await db.batch([
        db.prepare(`
          UPDATE ai_quota_days
          SET
            success_count = success_count + 1,
            last_completed_reservation_id = ?1,
            updated_at = ?2
          WHERE (subject_key, day) = (
            SELECT subject_key, day
            FROM ai_quota_attempts
            WHERE reservation_id = ?1
              AND status = 'reserved'
              AND expires_at > ?2
          )
          AND success_count < (
            SELECT daily_limit
            FROM ai_quota_attempts
            WHERE reservation_id = ?1
          )
        `).bind(reservationId, now),
        db.prepare(`
          UPDATE ai_quota_attempts
          SET status = 'succeeded', completed_at = ?2, release_reason = NULL
          WHERE reservation_id = ?1
            AND status = 'reserved'
            AND expires_at > ?2
            AND EXISTS (
              SELECT 1
              FROM ai_quota_days AS d
              WHERE d.subject_key = ai_quota_attempts.subject_key
                AND d.day = ai_quota_attempts.day
                AND d.last_completed_reservation_id = ?1
            )
        `).bind(reservationId, now),
        db.prepare(`
          SELECT ${ATTEMPT_SELECT}, subject_key AS subjectKey
          FROM ai_quota_attempts
          WHERE reservation_id = ?1
          LIMIT 1
        `).bind(reservationId),
      ]);

      const row = firstResult(results[2]);
      const attempt = attemptFromRow(row);
      if (!attempt) return { status: "not_found" };

      const snapshotResults = await db.batch([
        db.prepare(`
          SELECT success_count AS successCount, ?3 AS dailyLimit
          FROM ai_quota_days
          WHERE subject_key = ?1 AND day = ?2
          LIMIT 1
        `).bind(row.subjectKey, attempt.day, attempt.dailyLimit),
        db.prepare(`
          SELECT COUNT(*) AS activeReservations
          FROM ai_quota_attempts
          WHERE subject_key = ?1 AND day = ?2
            AND status = 'reserved' AND expires_at > ?3
        `).bind(row.subjectKey, attempt.day, now),
      ]);
      const snapshot = quotaSnapshot(
        attempt,
        firstResult(snapshotResults[0]),
        firstResult(snapshotResults[1]),
      );

      const changed = numberValue(results[1]?.meta?.changes) > 0;
      if (attempt.status === "succeeded") {
        return { status: changed ? "completed" : "already_succeeded", ...snapshot };
      }
      if (attempt.status === "released") return { status: "released", ...snapshot };
      if (attempt.expiresAt <= now) return { status: "expired", ...snapshot };
      return { status: "conflict", ...snapshot };
    },

    async release({ reservationId, reasonCode, now }) {
      const results = await db.batch([
        db.prepare(`
          UPDATE ai_quota_attempts
          SET status = 'released', completed_at = ?3, release_reason = ?2
          WHERE reservation_id = ?1 AND status = 'reserved'
        `).bind(reservationId, reasonCode, now),
        db.prepare(`
          SELECT ${ATTEMPT_SELECT}, subject_key AS subjectKey
          FROM ai_quota_attempts
          WHERE reservation_id = ?1
          LIMIT 1
        `).bind(reservationId),
      ]);

      const row = firstResult(results[1]);
      const attempt = attemptFromRow(row);
      if (!attempt) return { status: "not_found" };

      const snapshotResults = await db.batch([
        db.prepare(`
          SELECT success_count AS successCount, ?3 AS dailyLimit
          FROM ai_quota_days
          WHERE subject_key = ?1 AND day = ?2
          LIMIT 1
        `).bind(row.subjectKey, attempt.day, attempt.dailyLimit),
        db.prepare(`
          SELECT COUNT(*) AS activeReservations
          FROM ai_quota_attempts
          WHERE subject_key = ?1 AND day = ?2
            AND status = 'reserved' AND expires_at > ?3
        `).bind(row.subjectKey, attempt.day, now),
      ]);
      const snapshot = quotaSnapshot(
        attempt,
        firstResult(snapshotResults[0]),
        firstResult(snapshotResults[1]),
      );
      const changed = numberValue(results[0]?.meta?.changes) > 0;

      if (attempt.status === "released") {
        return { status: changed ? "released" : "already_released", ...snapshot };
      }
      if (attempt.status === "succeeded") {
        return { status: "already_succeeded", ...snapshot };
      }
      return { status: "conflict", ...snapshot };
    },

    async getAggregate({ day, monthStartDay, monthEndDay }) {
      const results = await db.batch([
        db.prepare(`
          SELECT
            COALESCE(SUM(success_count), 0) AS successCount,
            COUNT(CASE WHEN success_count > 0 THEN 1 END) AS activeSubjects
          FROM ai_quota_days
          WHERE day = ?1
        `).bind(day),
        db.prepare(`
          SELECT
            COALESCE(SUM(success_count), 0) AS successCount,
            COUNT(DISTINCT CASE WHEN success_count > 0 THEN subject_key END) AS activeSubjects
          FROM ai_quota_days
          WHERE day >= ?1 AND day < ?2
        `).bind(monthStartDay, monthEndDay),
        db.prepare(`
          SELECT
            COALESCE(SUM(CASE WHEN tier_at_reserve = 'free' THEN 1 ELSE 0 END), 0)
              AS freeSuccessCount,
            COALESCE(SUM(CASE WHEN tier_at_reserve = 'plus' THEN 1 ELSE 0 END), 0)
              AS plusSuccessCount
          FROM ai_quota_attempts
          WHERE day = ?1 AND status = 'succeeded'
        `).bind(day),
      ]);
      const today = firstResult(results[0]) || {};
      const month = firstResult(results[1]) || {};
      const tiers = firstResult(results[2]) || {};
      return {
        today: {
          successCount: numberValue(today.successCount),
          activeSubjects: numberValue(today.activeSubjects),
          freeSuccessCount: numberValue(tiers.freeSuccessCount),
          plusSuccessCount: numberValue(tiers.plusSuccessCount),
        },
        month: {
          successCount: numberValue(month.successCount),
          activeSubjects: numberValue(month.activeSubjects),
        },
      };
    },

    async cleanup({ attemptCutoff, dayCutoff }) {
      const results = await db.batch([
        db.prepare(`
          DELETE FROM ai_quota_attempts WHERE reserved_at < ?1
        `).bind(attemptCutoff),
        db.prepare(`
          DELETE FROM ai_quota_days WHERE day < ?1
        `).bind(dayCutoff),
      ]);
      return {
        attemptsDeleted: numberValue(results[0]?.meta?.changes),
        daysDeleted: numberValue(results[1]?.meta?.changes),
      };
    },
  });
}
