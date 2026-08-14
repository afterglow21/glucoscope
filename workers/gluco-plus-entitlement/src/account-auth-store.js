const EMAIL_NOT_STORED_MARKER = "email-not-stored-v1";

function requireDatabase(database) {
  if (
    !database
    || typeof database.prepare !== "function"
    || typeof database.batch !== "function"
  ) {
    throw new TypeError("PLUS_DB binding is unavailable");
  }
  return database;
}

function firstBatchRow(result) {
  return result?.results?.[0] || null;
}

function toSessionState(row) {
  if (!row) return null;
  const plusActive = Boolean(row.entitlement_id);
  return {
    accountId: row.account_id,
    accountVerified: true,
    sessionExpiresAt: Number(row.session_expires_at),
    plusActive,
    purchasePending: !plusActive && Boolean(row.purchase_pending),
    startsAt: plusActive ? Number(row.entitlement_starts_at) : null,
    endsAt: plusActive ? Number(row.entitlement_ends_at) : null,
    shareStudioTrialAvailable: !plusActive
      && (row.share_trial_used_at === null
        || row.share_trial_used_at === undefined),
  };
}

export function createD1AccountAuthStore(database) {
  const db = requireDatabase(database);

  return Object.freeze({
    async issueChallenge({
      id,
      emailLookupHmac,
      alternateEmailLookupHmac,
      emailHmacKeyVersion,
      codeHmac,
      verificationGrantHash,
      contactRole,
      attempts,
      createdAt,
      expiresAt,
      resendAllowedAfter,
      windowStartsAt,
      maximumPerWindow,
      retentionStartsAt,
      rateWindowMs,
      resendCooldownMs,
    }) {
      const results = await db.batch([
        db.prepare(`
          DELETE FROM account_auth_challenges
          WHERE expires_at < ?1
        `).bind(retentionStartsAt),
        db.prepare(`
          UPDATE account_auth_challenges
          SET invalidated_at = ?3
          WHERE email_lookup_hmac IN (?1, ?2)
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND expires_at <= ?3
        `).bind(emailLookupHmac, alternateEmailLookupHmac, createdAt),
        db.prepare(`
          INSERT INTO account_auth_challenges (
            id, email_lookup_hmac, email_hmac_key_version, code_hmac,
            verification_grant_hash, contact_role, send_state,
            attempts_remaining, created_at,
            expires_at, sent_at, consumed_at, invalidated_at
          )
          SELECT
            ?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9,
            NULL, NULL, NULL
          WHERE (
            SELECT COUNT(*) FROM account_auth_challenges
            WHERE email_lookup_hmac IN (?2, ?12) AND created_at >= ?10
          ) < ?11
            AND NOT EXISTS (
              SELECT 1 FROM account_auth_challenges
              WHERE email_lookup_hmac IN (?2, ?12) AND created_at > ?13
            )
        `).bind(
          id,
          emailLookupHmac,
          emailHmacKeyVersion,
          codeHmac,
          verificationGrantHash,
          contactRole,
          attempts,
          createdAt,
          expiresAt,
          windowStartsAt,
          maximumPerWindow,
          alternateEmailLookupHmac,
          resendAllowedAfter,
        ),
        db.prepare(`
          UPDATE account_auth_challenges
          SET invalidated_at = ?4
          WHERE email_lookup_hmac IN (?1, ?2)
            AND id <> ?3
            AND consumed_at IS NULL
            AND invalidated_at IS NULL
            AND EXISTS (
              SELECT 1 FROM account_auth_challenges WHERE id = ?3
            )
        `).bind(emailLookupHmac, alternateEmailLookupHmac, id, createdAt),
        db.prepare(`
          SELECT
            EXISTS (
              SELECT 1 FROM account_auth_challenges WHERE id = ?1
            ) AS inserted,
            (
              SELECT MAX(created_at) FROM account_auth_challenges
              WHERE email_lookup_hmac IN (?2, ?3) AND id <> ?1
            ) AS latest_previous_created_at,
            (
              SELECT MIN(created_at) FROM account_auth_challenges
              WHERE email_lookup_hmac IN (?2, ?3)
                AND created_at >= ?4
                AND id <> ?1
            ) AS oldest_window_created_at,
            (
              SELECT COUNT(*) FROM account_auth_challenges
              WHERE email_lookup_hmac IN (?2, ?3)
                AND created_at >= ?4
                AND id <> ?1
            ) AS previous_window_count
        `).bind(
          id,
          emailLookupHmac,
          alternateEmailLookupHmac,
          windowStartsAt,
        ),
      ]);
      const row = firstBatchRow(results[4]);
      if (Boolean(row?.inserted)) return { status: "pending", id };
      const latestRetryAt = row?.latest_previous_created_at === null
        || row?.latest_previous_created_at === undefined
        ? createdAt + resendCooldownMs
        : Number(row.latest_previous_created_at) + resendCooldownMs;
      const windowRetryAt = Number(row?.previous_window_count || 0) >= maximumPerWindow
        && row?.oldest_window_created_at !== null
        && row?.oldest_window_created_at !== undefined
        ? Number(row.oldest_window_created_at) + rateWindowMs
        : createdAt;
      return {
        status: "throttled",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((Math.max(latestRetryAt, windowRetryAt) - createdAt) / 1000),
        ),
      };
    },

    async markChallengeSent({ id, sentAt }) {
      const row = await db.prepare(`
        UPDATE account_auth_challenges
        SET send_state = 'sent', sent_at = ?2
        WHERE id = ?1
          AND send_state = 'pending'
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ?2
        RETURNING id
      `).bind(id, sentAt).first();
      return { sent: Boolean(row) };
    },

    async markChallengeSendFailed({ id, failedAt }) {
      await db.prepare(`
        UPDATE account_auth_challenges
        SET send_state = 'failed', invalidated_at = COALESCE(invalidated_at, ?2)
        WHERE id = ?1 AND consumed_at IS NULL
      `).bind(id, failedAt).run();
    },

    async getActiveChallenge({
      emailLookupHmac,
      alternateEmailLookupHmac,
      verificationGrantHash,
      now,
    }) {
      const row = await db.prepare(`
        SELECT id, code_hmac, attempts_remaining, expires_at
        FROM account_auth_challenges
        WHERE email_lookup_hmac IN (?1, ?2)
          AND verification_grant_hash = ?3
          AND send_state = 'sent'
          AND attempts_remaining > 0
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ?4
        ORDER BY created_at DESC
        LIMIT 1
      `).bind(
        emailLookupHmac,
        alternateEmailLookupHmac,
        verificationGrantHash,
        now,
      ).first();
      if (!row) return null;
      return {
        id: row.id,
        codeHmac: row.code_hmac,
        attemptsRemaining: Number(row.attempts_remaining),
        expiresAt: Number(row.expires_at),
      };
    },

    async recordFailedAttempt({ id, now }) {
      const row = await db.prepare(`
        UPDATE account_auth_challenges
        SET
          attempts_remaining = attempts_remaining - 1,
          invalidated_at = CASE
            WHEN attempts_remaining <= 1 THEN ?2
            ELSE invalidated_at
          END
        WHERE id = ?1
          AND send_state = 'sent'
          AND attempts_remaining > 0
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ?2
        RETURNING attempts_remaining
      `).bind(id, now).first();
      return { attemptsRemaining: Number(row?.attempts_remaining ?? 0) };
    },

    async consumeChallenge({ id, expectedCodeHmac, now }) {
      const row = await db.prepare(`
        UPDATE account_auth_challenges
        SET consumed_at = ?3
        WHERE id = ?1
          AND code_hmac = ?2
          AND send_state = 'sent'
          AND attempts_remaining > 0
          AND consumed_at IS NULL
          AND invalidated_at IS NULL
          AND expires_at > ?3
        RETURNING id
      `).bind(id, expectedCodeHmac, now).first();
      return { consumed: Boolean(row) };
    },

    async rotateSessionForVerifiedEmail({
      emailLookupHmac,
      alternateEmailLookupHmac,
      emailHmacKeyVersion,
      newAccountId,
      newSessionId,
      newTokenHash,
      verifiedAt,
      sessionExpiresAt,
    }) {
      const results = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO accounts (
            id, email_lookup_hmac, email_ciphertext, email_key_version,
            email_verified_at, status, created_at, updated_at
          )
          SELECT
            ?1, ?2, '${EMAIL_NOT_STORED_MARKER}', ?3, ?4, 'active', ?4, ?4
          WHERE NOT EXISTS (
            SELECT 1 FROM accounts
            WHERE email_lookup_hmac IN (?2, ?5) AND status = 'active'
          )
        `).bind(
          newAccountId,
          emailLookupHmac,
          emailHmacKeyVersion,
          verifiedAt,
          alternateEmailLookupHmac,
        ),
        db.prepare(`
          UPDATE accounts
          SET
            email_lookup_hmac = ?1,
            email_key_version = ?3,
            updated_at = MAX(updated_at, ?4)
          WHERE email_lookup_hmac = ?2
            AND ?1 <> ?2
            AND status = 'active'
            AND (
              SELECT COUNT(*) FROM accounts
              WHERE email_lookup_hmac IN (?1, ?2) AND status = 'active'
            ) = 1
            AND NOT EXISTS (
              SELECT 1 FROM accounts AS current_account
              WHERE current_account.email_lookup_hmac = ?1
                AND current_account.status = 'active'
            )
        `).bind(
          emailLookupHmac,
          alternateEmailLookupHmac,
          emailHmacKeyVersion,
          verifiedAt,
        ),
        db.prepare(`
          UPDATE accounts
          SET
            email_verified_at = COALESCE(email_verified_at, ?2),
            updated_at = MAX(updated_at, ?2)
          WHERE email_lookup_hmac = ?1
            AND status = 'active'
            AND (
              SELECT COUNT(*) FROM accounts
              WHERE email_lookup_hmac IN (?1, ?3) AND status = 'active'
            ) = 1
        `).bind(emailLookupHmac, verifiedAt, alternateEmailLookupHmac),
        db.prepare(`
          INSERT OR IGNORE INTO share_trial_state (account_id, updated_at)
          SELECT id, ?2 FROM accounts
          WHERE email_lookup_hmac = ?1
            AND status = 'active'
            AND (
              SELECT COUNT(*) FROM accounts
              WHERE email_lookup_hmac IN (?1, ?3) AND status = 'active'
            ) = 1
        `).bind(emailLookupHmac, verifiedAt, alternateEmailLookupHmac),
        db.prepare(`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ?2)
          WHERE account_id = (
            SELECT id FROM accounts
            WHERE email_lookup_hmac = ?1
              AND status = 'active'
              AND (
                SELECT COUNT(*) FROM accounts
                WHERE email_lookup_hmac IN (?1, ?3) AND status = 'active'
              ) = 1
          ) AND revoked_at IS NULL
        `).bind(emailLookupHmac, verifiedAt, alternateEmailLookupHmac),
        db.prepare(`
          INSERT INTO sessions (
            id, account_id, token_hash, created_at, expires_at, revoked_at
          )
          SELECT ?1, id, ?2, ?3, ?4, NULL
          FROM accounts
          WHERE email_lookup_hmac = ?5
            AND status = 'active'
            AND email_verified_at IS NOT NULL
            AND (
              SELECT COUNT(*) FROM accounts
              WHERE email_lookup_hmac IN (?5, ?6) AND status = 'active'
            ) = 1
        `).bind(
          newSessionId,
          newTokenHash,
          verifiedAt,
          sessionExpiresAt,
          emailLookupHmac,
          alternateEmailLookupHmac,
        ),
        db.prepare(`
          SELECT
            a.id AS account_id,
            s.created_at AS session_created_at,
            s.expires_at AS session_expires_at
          FROM sessions AS s
          JOIN accounts AS a ON a.id = s.account_id
          WHERE s.id = ?1 AND s.token_hash = ?2
          LIMIT 1
        `).bind(newSessionId, newTokenHash),
      ]);
      const row = firstBatchRow(results[6]);
      return row
        ? {
            accountId: row.account_id,
            issuedAt: Number(row.session_created_at),
            expiresAt: Number(row.session_expires_at),
          }
        : null;
    },

    async getSessionState({ tokenHash, now }) {
      const row = await db.prepare(`
        SELECT
          a.id AS account_id,
          s.expires_at AS session_expires_at,
          e.id AS entitlement_id,
          e.starts_at AS entitlement_starts_at,
          e.ends_at AS entitlement_ends_at,
          t.used_at AS share_trial_used_at,
          CASE
            WHEN e.id IS NOT NULL THEN 0
            ELSE (
              EXISTS (
                SELECT 1 FROM checkout_attempts AS c
                WHERE c.account_id = a.id
                  AND (
                    (c.state = 'reserved' AND c.reservation_expires_at > ?2)
                    OR c.state = 'open'
                    OR (c.state = 'completed' AND c.updated_at > ?2 - 600000)
                  )
              )
              OR EXISTS (
                SELECT 1 FROM processed_webhook_events AS w
                WHERE w.account_id = a.id
                  AND w.outcome = 'pending'
              )
            )
          END AS purchase_pending
        FROM sessions AS s
        JOIN accounts AS a ON a.id = s.account_id
        LEFT JOIN entitlements AS e ON e.id = (
          SELECT candidate.id
          FROM entitlements AS candidate
          WHERE candidate.account_id = a.id
            AND candidate.status = 'granted'
            AND candidate.starts_at <= ?2
            AND candidate.ends_at > ?2
          ORDER BY candidate.ends_at DESC
          LIMIT 1
        )
        LEFT JOIN share_trial_state AS t ON t.account_id = a.id
        WHERE s.token_hash = ?1
          AND s.revoked_at IS NULL
          AND s.expires_at > ?2
          AND a.status = 'active'
          AND a.email_verified_at IS NOT NULL
        LIMIT 1
      `).bind(tokenHash, now).first();
      return toSessionState(row);
    },

    async revokeSession({ tokenHash, now }) {
      await db.prepare(`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, ?2)
        WHERE token_hash = ?1
      `).bind(tokenHash, now).run();
      return { revoked: true };
    },

    async deleteAccountBySession({ tokenHash, now }) {
      const results = await db.batch([
        db.prepare(`
          SELECT
            a.id AS account_id,
            EXISTS (
              SELECT 1 FROM entitlements AS e WHERE e.account_id = a.id
            ) OR EXISTS (
              SELECT 1 FROM processed_webhook_events AS w
              WHERE w.account_id = a.id
            ) OR EXISTS (
              SELECT 1 FROM checkout_attempts AS c
              WHERE c.account_id = a.id
                AND c.state NOT IN ('failed', 'expired')
            ) OR EXISTS (
              SELECT 1
              FROM checkout_attempts AS c
              JOIN processed_refund_events AS r
                ON r.checkout_session_id = c.checkout_session_id
              WHERE c.account_id = a.id
            ) AS has_purchase_record
          FROM sessions AS s
          JOIN accounts AS a ON a.id = s.account_id
          WHERE s.token_hash = ?1
            AND s.revoked_at IS NULL
            AND s.expires_at > ?2
            AND a.status = 'active'
            AND a.email_verified_at IS NOT NULL
          LIMIT 1
        `).bind(tokenHash, now),
        db.prepare(`
          DELETE FROM account_auth_challenges
          WHERE email_lookup_hmac = (
            SELECT a.email_lookup_hmac
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token_hash = ?1
              AND s.revoked_at IS NULL
              AND s.expires_at > ?2
              AND NOT EXISTS (
                SELECT 1 FROM entitlements AS e WHERE e.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM processed_webhook_events AS w
                WHERE w.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM checkout_attempts AS c
                WHERE c.account_id = a.id
                  AND c.state NOT IN ('failed', 'expired')
              )
              AND NOT EXISTS (
                SELECT 1
                FROM checkout_attempts AS c
                JOIN processed_refund_events AS r
                  ON r.checkout_session_id = c.checkout_session_id
                WHERE c.account_id = a.id
              )
          )
        `).bind(tokenHash, now),
        db.prepare(`
          DELETE FROM share_trial_state
          WHERE account_id = (
            SELECT a.id
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token_hash = ?1
              AND s.revoked_at IS NULL
              AND s.expires_at > ?2
              AND NOT EXISTS (
                SELECT 1 FROM entitlements AS e WHERE e.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM processed_webhook_events AS w
                WHERE w.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM checkout_attempts AS c
                WHERE c.account_id = a.id
                  AND c.state NOT IN ('failed', 'expired')
              )
              AND NOT EXISTS (
                SELECT 1
                FROM checkout_attempts AS c
                JOIN processed_refund_events AS r
                  ON r.checkout_session_id = c.checkout_session_id
                WHERE c.account_id = a.id
              )
          )
        `).bind(tokenHash, now),
        db.prepare(`
          DELETE FROM share_trial_operations
          WHERE account_id = (
            SELECT a.id
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token_hash = ?1
              AND s.revoked_at IS NULL
              AND s.expires_at > ?2
              AND NOT EXISTS (
                SELECT 1 FROM entitlements AS e WHERE e.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM processed_webhook_events AS w
                WHERE w.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM checkout_attempts AS c
                WHERE c.account_id = a.id
                  AND c.state NOT IN ('failed', 'expired')
              )
              AND NOT EXISTS (
                SELECT 1
                FROM checkout_attempts AS c
                JOIN processed_refund_events AS r
                  ON r.checkout_session_id = c.checkout_session_id
                WHERE c.account_id = a.id
              )
          )
        `).bind(tokenHash, now),
        db.prepare(`
          UPDATE sessions
          SET revoked_at = COALESCE(revoked_at, ?2)
          WHERE account_id = (
            SELECT a.id
            FROM sessions AS current_session
            JOIN accounts AS a ON a.id = current_session.account_id
            WHERE current_session.token_hash = ?1
              AND current_session.revoked_at IS NULL
              AND current_session.expires_at > ?2
              AND NOT EXISTS (
                SELECT 1 FROM entitlements AS e WHERE e.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM processed_webhook_events AS w
                WHERE w.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM checkout_attempts AS c
                WHERE c.account_id = a.id
                  AND c.state NOT IN ('failed', 'expired')
              )
              AND NOT EXISTS (
                SELECT 1
                FROM checkout_attempts AS c
                JOIN processed_refund_events AS r
                  ON r.checkout_session_id = c.checkout_session_id
                WHERE c.account_id = a.id
              )
          )
        `).bind(tokenHash, now),
        db.prepare(`
          DELETE FROM accounts
          WHERE id = (
            SELECT a.id
            FROM sessions AS s
            JOIN accounts AS a ON a.id = s.account_id
            WHERE s.token_hash = ?1
              AND s.expires_at > ?2
              AND NOT EXISTS (
                SELECT 1 FROM entitlements AS e WHERE e.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM processed_webhook_events AS w
                WHERE w.account_id = a.id
              )
              AND NOT EXISTS (
                SELECT 1 FROM checkout_attempts AS c
                WHERE c.account_id = a.id
                  AND c.state NOT IN ('failed', 'expired')
              )
              AND NOT EXISTS (
                SELECT 1
                FROM checkout_attempts AS c
                JOIN processed_refund_events AS r
                  ON r.checkout_session_id = c.checkout_session_id
                WHERE c.account_id = a.id
              )
          )
          RETURNING id
        `).bind(tokenHash, now),
      ]);
      const eligibility = firstBatchRow(results[0]);
      if (!eligibility) return { status: "invalid_session" };
      if (Boolean(eligibility.has_purchase_record)) {
        return { status: "requires_support" };
      }
      return firstBatchRow(results[5])
        ? { status: "deleted" }
        : { status: "unavailable" };
    },
  });
}
