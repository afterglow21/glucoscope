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

const EMAIL_NOT_STORED_MARKER = "email-not-stored-v1";

function toSessionSnapshot(row) {
  if (!row) return null;
  const hasEntitlement = Boolean(row.entitlement_id);
  return {
    accountId: row.account_id,
    shareTrialQuotaSeed: row.share_trial_quota_seed,
    buyerRole: row.buyer_role ?? null,
    buyerConfirmationVersion: row.buyer_confirmation_version ?? null,
    adultConfirmedAt: row.adult_confirmed_at === null
      || row.adult_confirmed_at === undefined
      ? null
      : Number(row.adult_confirmed_at),
    guardianConfirmedAt: row.guardian_confirmed_at === null
      || row.guardian_confirmed_at === undefined
      ? null
      : Number(row.guardian_confirmed_at),
    activeEntitlement: hasEntitlement
      ? {
        id: row.entitlement_id,
        startsAt: Number(row.entitlement_starts_at),
        endsAt: Number(row.entitlement_ends_at),
      }
      : null,
    shareTrialUsed: (row.share_trial_used_at !== null
      && row.share_trial_used_at !== undefined)
      || Boolean(row.share_trial_reuse_blocked),
    shareTrialReservationExpiresAt:
      row.share_trial_reservation_expires_at === null
      || row.share_trial_reservation_expires_at === undefined
        ? null
        : Number(row.share_trial_reservation_expires_at),
  };
}

function normalizePaymentResult(row, receiptInserted, input) {
  if (!row) throw new Error("verified payment result is unavailable");
  const commonPurchaseIdentityMatches = row.account_id === input.accountId
    && Number(row.amount_jpy) === input.amountJpy
    && row.currency === input.currency;
  const sameEvent = row.event_id === input.eventId;
  const sameCheckoutSession =
    row.checkout_session_id === input.checkoutSessionId;

  if (sameEvent) {
    const exactEventMatch = sameCheckoutSession
      && row.event_type === input.eventType
      && commonPurchaseIdentityMatches
      && Number(row.paid_at) === input.paidAt;
    if (!exactEventMatch) return { status: "event_conflict" };
  } else if (sameCheckoutSession) {
    if (!commonPurchaseIdentityMatches) {
      return { status: "checkout_session_conflict" };
    }
  } else {
    throw new Error("verified payment identity is unavailable");
  }

  const entitlement = row.entitlement_id
    ? {
      id: row.entitlement_id,
      startsAt: Number(row.entitlement_starts_at),
      endsAt: Number(row.entitlement_ends_at),
    }
    : null;
  if (!receiptInserted) {
    return { status: "duplicate", outcome: row.outcome, entitlement };
  }
  return { status: row.outcome, entitlement };
}

function normalizeRefundResult(row, receiptInserted, input) {
  if (!row) throw new Error("verified refund result is unavailable");
  const exactEventMatch = row.event_id === input.eventId
    && row.event_type === input.eventType
    && row.checkout_session_id === input.checkoutSessionId
    && (row.refund_id ?? null) === (input.refundId ?? null)
    && row.charge_id === input.chargeId
    && Number(row.refunded_at) === input.refundedAt;
  if (!exactEventMatch) return { status: "event_conflict" };

  const entitlement = row.entitlement_id
    ? {
      id: row.entitlement_id,
      startsAt: Number(row.entitlement_starts_at),
      endsAt: Number(row.entitlement_ends_at),
      status: row.entitlement_status,
    }
    : null;
  if (!receiptInserted) {
    return { status: "duplicate", outcome: row.outcome, entitlement };
  }
  return { status: row.outcome, entitlement };
}

function normalizeCheckoutFailureResult(row, receiptInserted, input) {
  if (!row) throw new Error("verified Checkout failure result is unavailable");
  const sameEvent = row.event_id === input.eventId;
  const sameCheckoutSession = row.checkout_session_id === input.checkoutSessionId;
  const commonIdentityMatches = row.account_id === input.accountId
    && row.request_id === input.requestId;
  if (sameEvent) {
    const exactEventMatch = sameCheckoutSession
      && row.event_type === input.eventType
      && commonIdentityMatches
      && Number(row.failed_at) === input.failedAt;
    if (!exactEventMatch) return { status: "event_conflict" };
  } else if (!sameCheckoutSession || !commonIdentityMatches) {
    return { status: "checkout_session_conflict" };
  }
  if (!receiptInserted) {
    return { status: "duplicate", outcome: row.outcome };
  }
  return { status: row.outcome };
}

function normalizeCheckoutExpiryResult(row, receiptInserted, input) {
  if (!row) throw new Error("verified Checkout expiry result is unavailable");
  const sameEvent = row.event_id === input.eventId;
  const sameCheckoutSession = row.checkout_session_id === input.checkoutSessionId;
  const commonIdentityMatches = row.account_id === input.accountId
    && row.request_id === input.requestId;
  if (sameEvent) {
    const exactEventMatch = sameCheckoutSession
      && row.event_type === input.eventType
      && commonIdentityMatches
      && Number(row.expired_at) === input.expiredAt;
    if (!exactEventMatch) return { status: "event_conflict" };
  } else if (!sameCheckoutSession || !commonIdentityMatches) {
    return { status: "checkout_session_conflict" };
  }
  if (!receiptInserted) {
    return { status: "duplicate", outcome: row.outcome };
  }
  return { status: row.outcome };
}

function normalizeCheckoutReservation(row, accountId, requestId) {
  if (!row || row.account_id !== accountId) {
    return { status: "checkout_unavailable" };
  }
  if (Boolean(row.plus_active)) return { status: "plus_active" };
  if (row.state === "open") {
    return {
      status: "existing",
      checkoutSessionId: row.checkout_session_id,
      requestId: row.request_id,
      expiresAt: Number(row.checkout_expires_at),
    };
  }
  if (row.state === "reserved") {
    if (row.request_id === requestId) {
      return {
        status: "reserved",
        requestId,
        reservationExpiresAt: Number(row.reservation_expires_at),
      };
    }
    return {
      status: "checkout_in_progress",
      reservationExpiresAt: Number(row.reservation_expires_at),
    };
  }
  if (row.state === "completed") return { status: "purchase_completed" };
  return { status: "checkout_unavailable" };
}

function normalizeCheckoutCompletion(row, input) {
  if (!row) return { status: "not_found" };
  if (row.account_id !== input.accountId || row.request_id !== input.requestId) {
    return { status: "request_conflict" };
  }
  if (row.checkout_session_id !== input.checkoutSessionId) {
    return { status: "checkout_session_conflict" };
  }
  if (row.state !== "open") return { status: row.state };
  return {
    status: "open",
    checkoutSessionId: row.checkout_session_id,
    requestId: row.request_id,
    expiresAt: Number(row.checkout_expires_at),
  };
}

function normalizeReserveResult(row, accountId, requestId) {
  if (!row) throw new Error("share trial reservation result is unavailable");
  if (row.request_owner && row.request_owner !== accountId) {
    return { status: "request_conflict" };
  }
  if (Boolean(row.plus_active)) return { status: "plus_active", grant: "plus" };
  if (row.request_state === "completed") {
    return { status: "completed", grant: "trial", requestId };
  }
  if ((row.share_trial_used_at !== null && row.share_trial_used_at !== undefined)
    || Boolean(row.share_trial_reuse_blocked)) {
    return { status: "trial_already_used" };
  }
  if (row.request_state === "reserved") {
    return {
      status: "reserved",
      grant: "trial",
      requestId,
      reservationExpiresAt: Number(row.request_expires_at),
    };
  }
  if (row.request_state === "released" || row.request_state === "expired") {
    return { status: row.request_state, requestId };
  }
  if (row.other_reservation_expires_at !== null
    && row.other_reservation_expires_at !== undefined) {
    return {
      status: "reservation_in_progress",
      reservationExpiresAt: Number(row.other_reservation_expires_at),
    };
  }
  return { status: "trial_unavailable" };
}

function normalizeCompletionResult(row, accountId, requestId) {
  if (!row) throw new Error("share trial completion result is unavailable");
  if (row.request_owner && row.request_owner !== accountId) {
    return { status: "request_conflict" };
  }
  if (!row.request_state) return { status: "not_found" };
  if (row.request_state === "completed"
    && row.completed_request_id === requestId) {
    return { status: "completed", grant: "trial", requestId };
  }
  if (Boolean(row.plus_active)) return { status: "plus_active", grant: "plus" };
  if ((row.share_trial_used_at !== null && row.share_trial_used_at !== undefined)
    || Boolean(row.share_trial_reuse_blocked)) {
    return { status: "trial_already_used" };
  }
  return { status: row.request_state, requestId };
}

function normalizeReleaseResult(row, accountId, requestId) {
  if (!row) return { status: "not_found" };
  if (row.request_owner !== accountId) return { status: "request_conflict" };
  if (row.request_state === "completed") {
    return { status: "already_completed", requestId };
  }
  return { status: row.request_state, requestId };
}

export function createD1PlusEntitlementStore(database) {
  const db = requireDatabase(database);

  return Object.freeze({
    async reserveCheckoutAttempt({
      accountId,
      requestId,
      reservedAt,
      reservationExpiresAt,
    }) {
      const results = await db.batch([
        db.prepare(`
          UPDATE checkout_attempts
          SET state = 'expired', updated_at = ?2
          WHERE account_id = ?1
            AND state = 'reserved'
            AND reservation_expires_at <= ?2
        `).bind(accountId, reservedAt),
        db.prepare(`
          INSERT INTO checkout_attempts (
            account_id, request_id, state, checkout_session_id,
            reserved_at, reservation_expires_at, checkout_expires_at,
            completed_at, updated_at
          )
          SELECT ?1, ?2, 'reserved', NULL, ?3, ?4, NULL, NULL, ?3
          WHERE EXISTS (
            SELECT 1 FROM accounts
            WHERE id = ?1 AND status = 'active' AND email_verified_at IS NOT NULL
          )
            AND NOT EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?1
                AND status = 'granted'
                AND starts_at <= ?3
                AND ends_at > ?3
            )
          ON CONFLICT(account_id) DO UPDATE SET
            request_id = excluded.request_id,
            state = 'reserved',
            checkout_session_id = NULL,
            reserved_at = excluded.reserved_at,
            reservation_expires_at = excluded.reservation_expires_at,
            checkout_expires_at = NULL,
            completed_at = NULL,
            updated_at = excluded.updated_at
          WHERE checkout_attempts.state IN (
              'completed', 'refunded', 'failed', 'expired'
            )
            AND NOT EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?1
                AND status = 'granted'
                AND starts_at <= ?3
                AND ends_at > ?3
            )
        `).bind(accountId, requestId, reservedAt, reservationExpiresAt),
        db.prepare(`
          SELECT
            c.account_id,
            c.request_id,
            c.state,
            c.checkout_session_id,
            c.reservation_expires_at,
            c.checkout_expires_at,
            EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = c.account_id
                AND status = 'granted'
                AND starts_at <= ?2
                AND ends_at > ?2
            ) AS plus_active
          FROM checkout_attempts AS c
          WHERE c.account_id = ?1
          LIMIT 1
        `).bind(accountId, reservedAt),
      ]);
      return normalizeCheckoutReservation(
        results[2]?.results?.[0] || null,
        accountId,
        requestId,
      );
    },

    async completeCheckoutAttempt(input) {
      const results = await db.batch([
        db.prepare(`
          UPDATE checkout_attempts
          SET
            state = 'open',
            checkout_session_id = ?3,
            checkout_expires_at = ?4,
            updated_at = ?5
          WHERE account_id = ?1
            AND request_id = ?2
            AND state = 'reserved'
            AND reservation_expires_at > ?5
        `).bind(
          input.accountId,
          input.requestId,
          input.checkoutSessionId,
          input.expiresAt,
          input.now,
        ),
        db.prepare(`
          SELECT
            account_id, request_id, state, checkout_session_id,
            checkout_expires_at
          FROM checkout_attempts
          WHERE account_id = ?1
          LIMIT 1
        `).bind(input.accountId),
      ]);
      return normalizeCheckoutCompletion(results[1]?.results?.[0] || null, input);
    },

    async expireCheckoutAttempt({ accountId, requestId, checkoutSessionId, now }) {
      const row = await db.prepare(`
        UPDATE checkout_attempts
        SET state = 'expired', updated_at = ?4
        WHERE account_id = ?1
          AND request_id = ?2
          AND checkout_session_id = ?3
          AND state = 'open'
        RETURNING account_id
      `).bind(accountId, requestId, checkoutSessionId, now).first();
      return { expired: Boolean(row) };
    },

    async applyVerifiedCheckoutFailure(input) {
      const results = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO processed_checkout_failure_events (
            event_id, checkout_session_id, event_type, account_id, request_id,
            failed_at, outcome, received_at, processed_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL)
        `).bind(
          input.eventId,
          input.checkoutSessionId,
          input.eventType,
          input.accountId,
          input.requestId,
          input.failedAt,
          input.processedAt,
        ),
        db.prepare(`
          UPDATE checkout_attempts
          SET state = 'failed', updated_at = ?5
          WHERE account_id = ?1
            AND request_id = ?2
            AND checkout_session_id = ?3
            AND state = 'open'
            AND EXISTS (
              SELECT 1 FROM processed_checkout_failure_events
              WHERE event_id = ?4 AND outcome IN ('pending', 'not_found')
            )
        `).bind(
          input.accountId,
          input.requestId,
          input.checkoutSessionId,
          input.eventId,
          input.processedAt,
        ),
        db.prepare(`
          UPDATE processed_checkout_failure_events
          SET
            outcome = CASE
              WHEN EXISTS (
                SELECT 1 FROM checkout_attempts
                WHERE account_id = ?2
                  AND request_id = ?3
                  AND checkout_session_id = ?4
                  AND state = 'failed'
              ) THEN 'failed'
              WHEN EXISTS (
                SELECT 1 FROM checkout_attempts
                WHERE account_id = ?2
                  AND request_id = ?3
                  AND checkout_session_id = ?4
                  AND state IN ('completed', 'refunded')
              ) THEN 'final_state_preserved'
              ELSE 'not_found'
            END,
            processed_at = ?5
          WHERE event_id = ?1 AND outcome IN ('pending', 'not_found')
        `).bind(
          input.eventId,
          input.accountId,
          input.requestId,
          input.checkoutSessionId,
          input.processedAt,
        ),
        db.prepare(`
          SELECT
            event_id, checkout_session_id, event_type, account_id, request_id,
            failed_at, outcome
          FROM processed_checkout_failure_events
          WHERE event_id = ?1 OR checkout_session_id = ?2
          ORDER BY CASE WHEN event_id = ?1 THEN 0 ELSE 1 END
          LIMIT 1
        `).bind(input.eventId, input.checkoutSessionId),
      ]);
      const receiptInserted = Number(results[0]?.meta?.changes || 0) > 0;
      const row = results[3]?.results?.[0] || null;
      return normalizeCheckoutFailureResult(row, receiptInserted, input);
    },

    async applyVerifiedCheckoutExpiry(input) {
      const results = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO processed_checkout_expiry_events (
            event_id, checkout_session_id, event_type, account_id, request_id,
            expired_at, outcome, received_at, processed_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL)
        `).bind(
          input.eventId,
          input.checkoutSessionId,
          input.eventType,
          input.accountId,
          input.requestId,
          input.expiredAt,
          input.processedAt,
        ),
        db.prepare(`
          UPDATE checkout_attempts
          SET state = 'expired', updated_at = ?5
          WHERE account_id = ?1
            AND request_id = ?2
            AND checkout_session_id = ?3
            AND state = 'open'
            AND EXISTS (
              SELECT 1 FROM processed_checkout_expiry_events
              WHERE event_id = ?4 AND outcome IN ('pending', 'not_found')
            )
        `).bind(
          input.accountId,
          input.requestId,
          input.checkoutSessionId,
          input.eventId,
          input.processedAt,
        ),
        db.prepare(`
          UPDATE processed_checkout_expiry_events
          SET
            outcome = CASE
              WHEN EXISTS (
                SELECT 1 FROM checkout_attempts
                WHERE account_id = ?2
                  AND request_id = ?3
                  AND checkout_session_id = ?4
                  AND state = 'expired'
              ) THEN 'expired'
              WHEN EXISTS (
                SELECT 1 FROM checkout_attempts
                WHERE account_id = ?2
                  AND request_id = ?3
                  AND checkout_session_id = ?4
                  AND state IN ('completed', 'refunded', 'failed')
              ) THEN 'final_state_preserved'
              ELSE 'not_found'
            END,
            processed_at = ?5
          WHERE event_id = ?1 AND outcome IN ('pending', 'not_found')
        `).bind(
          input.eventId,
          input.accountId,
          input.requestId,
          input.checkoutSessionId,
          input.processedAt,
        ),
        db.prepare(`
          SELECT
            event_id, checkout_session_id, event_type, account_id, request_id,
            expired_at, outcome
          FROM processed_checkout_expiry_events
          WHERE event_id = ?1 OR checkout_session_id = ?2
          ORDER BY CASE WHEN event_id = ?1 THEN 0 ELSE 1 END
          LIMIT 1
        `).bind(input.eventId, input.checkoutSessionId),
      ]);
      const receiptInserted = Number(results[0]?.meta?.changes || 0) > 0;
      const row = results[3]?.results?.[0] || null;
      return normalizeCheckoutExpiryResult(row, receiptInserted, input);
    },

    async getActivePlusCount({ now }) {
      const row = await db.prepare(`
        SELECT COUNT(DISTINCT e.account_id) AS active_plus_count
        FROM entitlements AS e
        JOIN accounts AS a ON a.id = e.account_id
        WHERE e.status = 'granted'
          AND e.starts_at <= ?1
          AND e.ends_at > ?1
          AND a.status = 'active'
          AND a.email_verified_at IS NOT NULL
      `).bind(now).first();
      return Number(row?.active_plus_count ?? 0);
    },

    async createAccount({
      id,
      emailLookupHmac,
      verifiedAt,
      now,
      buyerRole = null,
      buyerConfirmationVersion = null,
      adultConfirmedAt = null,
      guardianConfirmedAt = null,
    }) {
      const results = await db.batch([
        db.prepare(`
          INSERT INTO accounts (
            id, email_lookup_hmac, email_ciphertext, email_key_version,
            email_verified_at, status, created_at, updated_at,
            buyer_role, buyer_confirmation_version,
            adult_confirmed_at, guardian_confirmed_at
          ) VALUES (
            ?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6, ?7, ?8, ?9, ?10
          )
          RETURNING id, email_verified_at, status, created_at, updated_at
        `).bind(
          id,
          emailLookupHmac,
          EMAIL_NOT_STORED_MARKER,
          1,
          verifiedAt,
          now,
          buyerRole,
          buyerConfirmationVersion,
          adultConfirmedAt,
          guardianConfirmedAt,
        ),
        db.prepare(`
          INSERT INTO share_trial_state (account_id, updated_at)
          VALUES (?1, ?2)
        `).bind(id, now),
      ]);
      return results[0]?.results?.[0] || null;
    },

    async createSession({ id, accountId, tokenHash, createdAt, expiresAt }) {
      return db.prepare(`
        INSERT INTO sessions (
          id, account_id, token_hash, created_at, expires_at, revoked_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, NULL)
        RETURNING id, account_id, created_at, expires_at
      `).bind(id, accountId, tokenHash, createdAt, expiresAt).first();
    },

    async revokeSession({ tokenHash, now }) {
      const row = await db.prepare(`
        UPDATE sessions
        SET revoked_at = COALESCE(revoked_at, ?1)
        WHERE token_hash = ?2
        RETURNING id
      `).bind(now, tokenHash).first();
      return { revoked: Boolean(row) };
    },

    async getSessionSnapshot({ tokenHash, now }) {
      const row = await db.prepare(`
        SELECT
          a.id AS account_id,
          a.email_lookup_hmac AS share_trial_quota_seed,
          a.buyer_role,
          a.buyer_confirmation_version,
          a.adult_confirmed_at,
          a.guardian_confirmed_at,
          e.id AS entitlement_id,
          e.starts_at AS entitlement_starts_at,
          e.ends_at AS entitlement_ends_at,
          t.used_at AS share_trial_used_at,
          EXISTS (
            SELECT 1 FROM share_trial_reuse_retention AS retained_trial
            WHERE retained_trial.email_lookup_hmac = a.email_lookup_hmac
              AND retained_trial.expires_at > ?2
          ) AS share_trial_reuse_blocked,
          (
            SELECT MAX(o.expires_at)
            FROM share_trial_operations AS o
            WHERE o.account_id = a.id
              AND o.state = 'reserved'
              AND o.expires_at > ?2
          ) AS share_trial_reservation_expires_at
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
      return toSessionSnapshot(row);
    },

    async isShareTrialReservationActive({ accountId, requestId, now }) {
      const row = await db.prepare(`
        SELECT 1 AS active
        FROM share_trial_operations AS operation
        JOIN share_trial_state AS trial ON trial.account_id = operation.account_id
        WHERE operation.request_id = ?1
          AND operation.account_id = ?2
          AND operation.state = 'reserved'
          AND operation.expires_at > ?3
          AND trial.used_at IS NULL
        LIMIT 1
      `).bind(requestId, accountId, now).first();
      return Boolean(row?.active);
    },

    async applyVerifiedPayment(input) {
      const results = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO processed_webhook_events (
            event_id, checkout_session_id, event_type, account_id,
            amount_jpy, currency, paid_at, outcome, received_at, processed_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, NULL)
        `).bind(
          input.eventId,
          input.checkoutSessionId,
          input.eventType,
          input.accountId,
          input.amountJpy,
          input.currency,
          input.paidAt,
          input.processedAt,
        ),
        db.prepare(`
          INSERT OR IGNORE INTO entitlements (
            id, account_id, product_code, purchase_kind, amount_jpy, currency,
            starts_at, ends_at, status, source_event_id, created_at, updated_at
          )
          SELECT
            ?1, ?2, 'plus_30d', 'one_time', ?8, 'jpy',
            ?3, ?4, 'granted', ?5, ?6, ?6
          WHERE EXISTS (
            SELECT 1 FROM processed_webhook_events
            WHERE event_id = ?5 AND outcome = 'pending'
          )
            AND EXISTS (
              SELECT 1 FROM accounts
              WHERE id = ?2 AND status = 'active' AND email_verified_at IS NOT NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?2
                AND status = 'granted'
                AND starts_at < ?4
                AND ends_at > ?3
            )
            AND NOT EXISTS (
              SELECT 1 FROM processed_refund_events
              WHERE checkout_session_id = ?7
            )
        `).bind(
          input.entitlementId,
          input.accountId,
          input.startsAt,
          input.endsAt,
          input.eventId,
          input.processedAt,
          input.checkoutSessionId,
          input.amountJpy,
        ),
        db.prepare(`
          UPDATE processed_webhook_events
          SET
            outcome = CASE
              WHEN EXISTS (
                SELECT 1 FROM entitlements WHERE source_event_id = ?1
              ) THEN 'granted'
              WHEN EXISTS (
                SELECT 1 FROM processed_refund_events
                WHERE checkout_session_id = ?3
              ) THEN 'rejected_refunded'
              ELSE 'rejected_overlap'
            END,
            processed_at = ?2
          WHERE event_id = ?1 AND outcome = 'pending'
        `).bind(input.eventId, input.processedAt, input.checkoutSessionId),
        db.prepare(`
          UPDATE checkout_attempts
          SET
            state = 'completed',
            completed_at = COALESCE(completed_at, ?2),
            updated_at = ?2
          WHERE checkout_session_id = ?1
            AND state IN ('open', 'failed', 'completed')
        `).bind(input.checkoutSessionId, input.processedAt),
        db.prepare(`
          SELECT
            w.event_id,
            w.checkout_session_id,
            w.event_type,
            w.account_id,
            w.amount_jpy,
            w.currency,
            w.paid_at,
            w.outcome,
            e.id AS entitlement_id,
            e.starts_at AS entitlement_starts_at,
            e.ends_at AS entitlement_ends_at
          FROM processed_webhook_events AS w
          LEFT JOIN entitlements AS e ON e.source_event_id = w.event_id
          WHERE w.event_id = ?1 OR w.checkout_session_id = ?2
          ORDER BY CASE WHEN w.event_id = ?1 THEN 0 ELSE 1 END
          LIMIT 1
        `).bind(input.eventId, input.checkoutSessionId),
      ]);
      const receiptInserted = Number(results[0]?.meta?.changes || 0) > 0;
      const row = results[4]?.results?.[0] || null;
      return normalizePaymentResult(row, receiptInserted, input);
    },

    async revokeForVerifiedRefund(input) {
      const results = await db.batch([
        db.prepare(`
          INSERT OR IGNORE INTO processed_refund_events (
            event_id, event_type, checkout_session_id, refund_id, charge_id,
            refunded_at, outcome, received_at, processed_at
          ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, NULL)
        `).bind(
          input.eventId,
          input.eventType,
          input.checkoutSessionId,
          input.refundId,
          input.chargeId,
          input.refundedAt,
          input.processedAt,
        ),
        db.prepare(`
          UPDATE entitlements
          SET status = 'refunded', updated_at = ?2
          WHERE status = 'granted'
            AND source_event_id IN (
              SELECT event_id FROM processed_webhook_events
              WHERE checkout_session_id = ?1
            )
            AND EXISTS (
              SELECT 1 FROM processed_refund_events
              WHERE event_id = ?3 AND outcome = 'pending'
            )
        `).bind(input.checkoutSessionId, input.processedAt, input.eventId),
        db.prepare(`
          UPDATE processed_refund_events
          SET
            outcome = CASE
              WHEN EXISTS (
                SELECT 1
                FROM entitlements AS e
                JOIN processed_webhook_events AS w
                  ON w.event_id = e.source_event_id
                WHERE w.checkout_session_id = ?2
                  AND e.status = 'refunded'
              ) THEN 'refunded'
              ELSE 'not_found'
            END,
            processed_at = ?3
          WHERE event_id = ?1 AND outcome = 'pending'
        `).bind(input.eventId, input.checkoutSessionId, input.processedAt),
        db.prepare(`
          UPDATE checkout_attempts
          SET
            state = 'refunded',
            completed_at = COALESCE(completed_at, ?2),
            updated_at = ?2
          WHERE checkout_session_id = ?1
            AND state IN ('open', 'failed', 'completed', 'refunded')
        `).bind(input.checkoutSessionId, input.processedAt),
        db.prepare(`
          SELECT
            r.event_id,
            r.event_type,
            r.checkout_session_id,
            r.refund_id,
            r.charge_id,
            r.refunded_at,
            r.outcome,
            e.id AS entitlement_id,
            e.starts_at AS entitlement_starts_at,
            e.ends_at AS entitlement_ends_at,
            e.status AS entitlement_status
          FROM processed_refund_events AS r
          LEFT JOIN processed_webhook_events AS w
            ON w.checkout_session_id = r.checkout_session_id
          LEFT JOIN entitlements AS e ON e.source_event_id = w.event_id
          WHERE r.event_id = ?1
          LIMIT 1
        `).bind(input.eventId),
      ]);
      const receiptInserted = Number(results[0]?.meta?.changes || 0) > 0;
      const row = results[4]?.results?.[0] || null;
      return normalizeRefundResult(row, receiptInserted, input);
    },

    async reserveShareTrial({ accountId, requestId, reservedAt, expiresAt }) {
      const results = await db.batch([
        db.prepare(`
          UPDATE share_trial_operations
          SET state = 'expired', updated_at = ?2
          WHERE account_id = ?1 AND state = 'reserved' AND expires_at <= ?2
        `).bind(accountId, reservedAt),
        db.prepare(`
          INSERT OR IGNORE INTO share_trial_state (account_id, updated_at)
          VALUES (?1, ?2)
        `).bind(accountId, reservedAt),
        db.prepare(`
          INSERT OR IGNORE INTO share_trial_operations (
            request_id, account_id, state, reserved_at, expires_at,
            completed_at, released_at, updated_at
          )
          SELECT ?1, ?2, 'reserved', ?3, ?4, NULL, NULL, ?3
          WHERE EXISTS (
            SELECT 1 FROM share_trial_state
            WHERE account_id = ?2 AND used_at IS NULL
          )
            AND NOT EXISTS (
              SELECT 1
              FROM accounts AS retained_account
              JOIN share_trial_reuse_retention AS retained_trial
                ON retained_trial.email_lookup_hmac = retained_account.email_lookup_hmac
              WHERE retained_account.id = ?2
                AND retained_trial.expires_at > ?3
            )
            AND NOT EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?2
                AND status = 'granted'
                AND starts_at <= ?3
                AND ends_at > ?3
            )
            AND NOT EXISTS (
              SELECT 1 FROM share_trial_operations
              WHERE account_id = ?2 AND state = 'reserved' AND expires_at > ?3
            )
        `).bind(requestId, accountId, reservedAt, expiresAt),
        db.prepare(`
          SELECT
            t.used_at AS share_trial_used_at,
            EXISTS (
              SELECT 1
              FROM accounts AS retained_account
              JOIN share_trial_reuse_retention AS retained_trial
                ON retained_trial.email_lookup_hmac = retained_account.email_lookup_hmac
              WHERE retained_account.id = ?1
                AND retained_trial.expires_at > ?3
            ) AS share_trial_reuse_blocked,
            own.account_id AS request_owner,
            own.state AS request_state,
            own.expires_at AS request_expires_at,
            EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?1
                AND status = 'granted'
                AND starts_at <= ?3
                AND ends_at > ?3
            ) AS plus_active,
            (
              SELECT MAX(expires_at) FROM share_trial_operations
              WHERE account_id = ?1
                AND request_id <> ?2
                AND state = 'reserved'
                AND expires_at > ?3
            ) AS other_reservation_expires_at
          FROM share_trial_state AS t
          LEFT JOIN share_trial_operations AS own ON own.request_id = ?2
          WHERE t.account_id = ?1
          LIMIT 1
        `).bind(accountId, requestId, reservedAt),
      ]);
      const row = results[3]?.results?.[0] || null;
      return normalizeReserveResult(row, accountId, requestId);
    },

    async completeShareTrial({ accountId, requestId, now }) {
      const results = await db.batch([
        db.prepare(`
          UPDATE share_trial_operations
          SET state = 'expired', updated_at = ?2
          WHERE account_id = ?1 AND state = 'reserved' AND expires_at <= ?2
        `).bind(accountId, now),
        db.prepare(`
          INSERT OR IGNORE INTO share_trial_state (account_id, updated_at)
          VALUES (?1, ?2)
        `).bind(accountId, now),
        db.prepare(`
          UPDATE share_trial_operations
          SET state = 'completed', completed_at = ?3, updated_at = ?3
          WHERE request_id = ?1
            AND account_id = ?2
            AND state = 'reserved'
            AND expires_at > ?3
            AND EXISTS (
              SELECT 1 FROM share_trial_state
              WHERE account_id = ?2 AND used_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1
              FROM accounts AS retained_account
              JOIN share_trial_reuse_retention AS retained_trial
                ON retained_trial.email_lookup_hmac = retained_account.email_lookup_hmac
              WHERE retained_account.id = ?2
                AND retained_trial.expires_at > ?3
            )
            AND NOT EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?2
                AND status = 'granted'
                AND starts_at <= ?3
                AND ends_at > ?3
            )
        `).bind(requestId, accountId, now),
        db.prepare(`
          UPDATE share_trial_state
          SET used_at = ?3, completed_request_id = ?1, updated_at = ?3
          WHERE account_id = ?2
            AND used_at IS NULL
            AND EXISTS (
              SELECT 1 FROM share_trial_operations
              WHERE request_id = ?1
                AND account_id = ?2
                AND state = 'completed'
            )
        `).bind(requestId, accountId, now),
        db.prepare(`
          SELECT
            own.account_id AS request_owner,
            own.state AS request_state,
            t.used_at AS share_trial_used_at,
            t.completed_request_id,
            EXISTS (
              SELECT 1
              FROM accounts AS retained_account
              JOIN share_trial_reuse_retention AS retained_trial
                ON retained_trial.email_lookup_hmac = retained_account.email_lookup_hmac
              WHERE retained_account.id = ?1
                AND retained_trial.expires_at > ?3
            ) AS share_trial_reuse_blocked,
            EXISTS (
              SELECT 1 FROM entitlements
              WHERE account_id = ?1
                AND status = 'granted'
                AND starts_at <= ?3
                AND ends_at > ?3
            ) AS plus_active
          FROM share_trial_operations AS own
          LEFT JOIN share_trial_state AS t ON t.account_id = ?1
          WHERE own.request_id = ?2
          LIMIT 1
        `).bind(accountId, requestId, now),
      ]);
      const row = results[4]?.results?.[0] || null;
      return normalizeCompletionResult(row, accountId, requestId);
    },

    async releaseShareTrial({ accountId, requestId, now }) {
      const results = await db.batch([
        db.prepare(`
          UPDATE share_trial_operations
          SET state = 'expired', updated_at = ?2
          WHERE account_id = ?1 AND state = 'reserved' AND expires_at <= ?2
        `).bind(accountId, now),
        db.prepare(`
          UPDATE share_trial_operations
          SET state = 'released', released_at = ?3, updated_at = ?3
          WHERE request_id = ?1 AND account_id = ?2 AND state = 'reserved'
        `).bind(requestId, accountId, now),
        db.prepare(`
          SELECT account_id AS request_owner, state AS request_state
          FROM share_trial_operations
          WHERE request_id = ?1
          LIMIT 1
        `).bind(requestId),
      ]);
      const row = results[2]?.results?.[0] || null;
      return normalizeReleaseResult(row, accountId, requestId);
    },
  });
}
