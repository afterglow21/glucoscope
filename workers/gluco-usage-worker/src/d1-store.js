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

function toProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayName: row.display_name,
    collectionEnabled: Boolean(row.collection_enabled),
    noticeVersion: row.notice_version,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    lastSeenAt: Number(row.last_seen_at),
  };
}

const PROFILE_RETURNING = `
  id,
  display_name,
  collection_enabled,
  notice_version,
  created_at,
  updated_at,
  last_seen_at
`;

export function createD1UsageStore(database) {
  const db = requireDatabase(database);

  return Object.freeze({
    async createProfile({ id, tokenHash, displayName, noticeVersion, day, now }) {
      const row = await db.prepare(`
        INSERT INTO profiles (
          id, token_hash, display_name, collection_enabled, notice_version,
          created_at, updated_at, last_seen_at, request_day, request_count
        ) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?5, ?5, ?6, 0)
        RETURNING ${PROFILE_RETURNING}
      `).bind(id, tokenHash, displayName, noticeVersion, now, day).first();
      return toProfile(row);
    },

    async authenticate({ tokenHash, day, now, requestLimit, consumeRequest }) {
      if (!consumeRequest) {
        const row = await db.prepare(`
          UPDATE profiles
          SET last_seen_at = ?1, updated_at = ?1
          WHERE token_hash = ?2
          RETURNING ${PROFILE_RETURNING}
        `).bind(now, tokenHash).first();
        return row
          ? { status: "ok", profile: toProfile(row) }
          : { status: "not_found" };
      }

      const row = await db.prepare(`
        UPDATE profiles
        SET
          request_count = CASE WHEN request_day = ?1 THEN request_count + 1 ELSE 1 END,
          request_day = ?1,
          last_seen_at = ?2,
          updated_at = ?2
        WHERE token_hash = ?3
          AND (request_day <> ?1 OR request_count < ?4)
        RETURNING ${PROFILE_RETURNING}
      `).bind(day, now, tokenHash, requestLimit).first();

      if (row) return { status: "ok", profile: toProfile(row) };
      const existing = await db.prepare(`
        SELECT id FROM profiles WHERE token_hash = ?1 LIMIT 1
      `).bind(tokenHash).first();
      return existing ? { status: "rate_limited" } : { status: "not_found" };
    },

    async updateProfile({
      profileId,
      hasDisplayName,
      displayName,
      hasCollectionEnabled,
      collectionEnabled,
      now,
    }) {
      let statement;
      if (hasDisplayName && hasCollectionEnabled) {
        statement = db.prepare(`
          UPDATE profiles
          SET display_name = ?1, collection_enabled = ?2, updated_at = ?3
          WHERE id = ?4
          RETURNING ${PROFILE_RETURNING}
        `).bind(displayName, collectionEnabled ? 1 : 0, now, profileId);
      } else if (hasDisplayName) {
        statement = db.prepare(`
          UPDATE profiles
          SET display_name = ?1, updated_at = ?2
          WHERE id = ?3
          RETURNING ${PROFILE_RETURNING}
        `).bind(displayName, now, profileId);
      } else {
        statement = db.prepare(`
          UPDATE profiles
          SET collection_enabled = ?1, updated_at = ?2
          WHERE id = ?3
          RETURNING ${PROFILE_RETURNING}
        `).bind(collectionEnabled ? 1 : 0, now, profileId);
      }
      return toProfile(await statement.first());
    },

    async recordEvent({
      profileId,
      day,
      event,
      now,
      receiptExpiresAt,
      aiDailyLimit,
    }) {
      const statements = [
        db.prepare(`
          INSERT OR IGNORE INTO usage_daily (
            profile_id, day, visit_day_count, ai_generation_success_count,
            ordinary_gluco_memory_count, last_ai_event_id, updated_at
          ) VALUES (?1, ?2, 0, 0, 0, NULL, ?3)
        `).bind(profileId, day, now),
        db.prepare(`
          INSERT OR IGNORE INTO event_receipts (
            profile_id, event_id, event_type, outcome, created_at, expires_at
          ) VALUES (?1, ?2, ?3, 'pending', ?4, ?5)
        `).bind(profileId, event.eventId, event.type, now, receiptExpiresAt),
      ];

      if (event.type === "visit_day") {
        statements.push(db.prepare(`
          UPDATE usage_daily
          SET visit_day_count = 1, updated_at = ?3
          WHERE profile_id = ?1 AND day = ?2
            AND EXISTS (
              SELECT 1 FROM event_receipts
              WHERE profile_id = ?1 AND event_id = ?4 AND outcome = 'pending'
            )
        `).bind(profileId, day, now, event.eventId));
        statements.push(db.prepare(`
          UPDATE event_receipts SET outcome = 'accepted'
          WHERE profile_id = ?1 AND event_id = ?2 AND outcome = 'pending'
        `).bind(profileId, event.eventId));
      } else if (event.type === "ordinary_gluco_memory_count") {
        statements.push(db.prepare(`
          UPDATE usage_daily
          SET ordinary_gluco_memory_count = MAX(ordinary_gluco_memory_count, ?3),
              updated_at = ?4
          WHERE profile_id = ?1 AND day = ?2
            AND EXISTS (
              SELECT 1 FROM event_receipts
              WHERE profile_id = ?1 AND event_id = ?5 AND outcome = 'pending'
            )
        `).bind(profileId, day, event.count, now, event.eventId));
        statements.push(db.prepare(`
          UPDATE event_receipts SET outcome = 'accepted'
          WHERE profile_id = ?1 AND event_id = ?2 AND outcome = 'pending'
        `).bind(profileId, event.eventId));
      } else {
        statements.push(db.prepare(`
          UPDATE usage_daily
          SET ai_generation_success_count = ai_generation_success_count + 1,
              last_ai_event_id = ?4,
              updated_at = ?3
          WHERE profile_id = ?1 AND day = ?2
            AND ai_generation_success_count < ?5
            AND EXISTS (
              SELECT 1 FROM event_receipts
              WHERE profile_id = ?1 AND event_id = ?4 AND outcome = 'pending'
            )
        `).bind(profileId, day, now, event.eventId, aiDailyLimit));
        statements.push(db.prepare(`
          UPDATE event_receipts
          SET outcome = CASE
            WHEN EXISTS (
              SELECT 1 FROM usage_daily
              WHERE profile_id = ?1 AND day = ?2 AND last_ai_event_id = ?3
            ) THEN 'accepted'
            ELSE 'daily_limit'
          END
          WHERE profile_id = ?1 AND event_id = ?3 AND outcome = 'pending'
        `).bind(profileId, day, event.eventId));
      }

      statements.push(db.prepare(`
        SELECT outcome FROM event_receipts
        WHERE profile_id = ?1 AND event_id = ?2
      `).bind(profileId, event.eventId));

      const results = await db.batch(statements);
      const receiptInserted = Number(results[1]?.meta?.changes || 0) > 0;
      const rows = results.at(-1)?.results || [];
      const outcome = rows[0]?.outcome;
      return {
        eventId: event.eventId,
        type: event.type,
        status: !receiptInserted && outcome === "accepted" ? "duplicate" : outcome,
      };
    },

    async exportProfile({ profileId, cutoffDay }) {
      const profileRow = await db.prepare(`
        SELECT ${PROFILE_RETURNING} FROM profiles WHERE id = ?1 LIMIT 1
      `).bind(profileId).first();
      const usage = await db.prepare(`
        SELECT
          day,
          visit_day_count AS visitDayCount,
          ai_generation_success_count AS aiGenerationSuccessCount,
          ordinary_gluco_memory_count AS ordinaryGlucoMemoryCount
        FROM usage_daily
        WHERE profile_id = ?1 AND day >= ?2
        ORDER BY day ASC
      `).bind(profileId, cutoffDay).all();
      return {
        profile: toProfile(profileRow),
        dailyUsage: usage.results || [],
      };
    },

    async deleteProfile({ profileId }) {
      await db.batch([
        db.prepare("DELETE FROM event_receipts WHERE profile_id = ?1").bind(profileId),
        db.prepare("DELETE FROM usage_daily WHERE profile_id = ?1").bind(profileId),
        db.prepare("DELETE FROM profiles WHERE id = ?1").bind(profileId),
      ]);
      return { deleted: true };
    },

    async cleanup({ receiptCutoff, dailyCutoffDay, inactiveProfileCutoff }) {
      const results = await db.batch([
        db.prepare("DELETE FROM event_receipts WHERE expires_at <= ?1").bind(receiptCutoff),
        db.prepare("DELETE FROM usage_daily WHERE day < ?1").bind(dailyCutoffDay),
        db.prepare("DELETE FROM profiles WHERE last_seen_at < ?1").bind(inactiveProfileCutoff),
      ]);
      return {
        receiptsDeleted: Number(results[0]?.meta?.changes || 0),
        dailyRowsDeleted: Number(results[1]?.meta?.changes || 0),
        profilesDeleted: Number(results[2]?.meta?.changes || 0),
      };
    },
  });
}
