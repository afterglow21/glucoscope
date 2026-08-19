PRAGMA foreign_keys = ON;

-- This migration is intentionally fail-closed. No production or staging
-- Checkout history may exist while replacing the original test-only Stripe
-- Checkout Session ID constraints. If any row exists, stop and reconcile it
-- manually instead of dropping payment or refund history.
CREATE TABLE live_stripe_checkout_ids_migration_guard (
  row_count INTEGER NOT NULL CHECK (row_count = 0)
);

INSERT INTO live_stripe_checkout_ids_migration_guard (row_count)
SELECT
  (SELECT COUNT(*) FROM checkout_attempts)
  + (SELECT COUNT(*) FROM processed_checkout_failure_events)
  + (SELECT COUNT(*) FROM processed_checkout_expiry_events)
  + (SELECT COUNT(*) FROM processed_refund_events);

DROP TABLE processed_refund_events;
DROP TABLE processed_checkout_expiry_events;
DROP TABLE processed_checkout_failure_events;
DROP TABLE checkout_attempts;

CREATE TABLE checkout_attempts (
  account_id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  state TEXT NOT NULL CHECK (
    state IN ('reserved', 'open', 'completed', 'refunded', 'failed', 'expired')
  ),
  checkout_session_id TEXT UNIQUE CHECK (
    checkout_session_id IS NULL OR (
      length(checkout_session_id) BETWEEN 16 AND 255
      AND substr(checkout_session_id, 1, 8) IN ('cs_test_', 'cs_live_')
      AND substr(checkout_session_id, 9) NOT GLOB '*[^A-Za-z0-9]*'
    )
  ),
  reserved_at INTEGER NOT NULL CHECK (reserved_at >= 0),
  reservation_expires_at INTEGER NOT NULL CHECK (
    reservation_expires_at > reserved_at
  ),
  checkout_expires_at INTEGER CHECK (
    checkout_expires_at IS NULL OR checkout_expires_at > reserved_at
  ),
  completed_at INTEGER CHECK (
    completed_at IS NULL OR completed_at >= reserved_at
  ),
  updated_at INTEGER NOT NULL CHECK (updated_at >= reserved_at),
  CHECK (
    (state = 'reserved' AND checkout_session_id IS NULL
      AND checkout_expires_at IS NULL AND completed_at IS NULL)
    OR (state = 'open' AND checkout_session_id IS NOT NULL
      AND checkout_expires_at IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('completed', 'refunded') AND checkout_session_id IS NOT NULL
      AND checkout_expires_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (state IN ('failed', 'expired') AND completed_at IS NULL)
  ),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_checkout_attempts_state_expiry
  ON checkout_attempts(state, reservation_expires_at, checkout_expires_at);

CREATE TABLE processed_checkout_failure_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (
    length(event_id) BETWEEN 12 AND 255
    AND substr(event_id, 1, 4) = 'evt_'
    AND substr(event_id, 5) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  checkout_session_id TEXT UNIQUE NOT NULL CHECK (
    length(checkout_session_id) BETWEEN 16 AND 255
    AND substr(checkout_session_id, 1, 8) IN ('cs_test_', 'cs_live_')
    AND substr(checkout_session_id, 9) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  event_type TEXT NOT NULL CHECK (
    event_type = 'checkout.session.async_payment_failed'
  ),
  account_id TEXT NOT NULL CHECK (length(account_id) = 36),
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  failed_at INTEGER NOT NULL CHECK (failed_at >= 0),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (
    outcome IN ('pending', 'failed', 'final_state_preserved', 'not_found')
  ),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= received_at),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE processed_checkout_expiry_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (
    length(event_id) BETWEEN 12 AND 255
    AND substr(event_id, 1, 4) = 'evt_'
    AND substr(event_id, 5) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  checkout_session_id TEXT UNIQUE NOT NULL CHECK (
    length(checkout_session_id) BETWEEN 16 AND 255
    AND substr(checkout_session_id, 1, 8) IN ('cs_test_', 'cs_live_')
    AND substr(checkout_session_id, 9) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  event_type TEXT NOT NULL CHECK (event_type = 'checkout.session.expired'),
  account_id TEXT NOT NULL CHECK (length(account_id) = 36),
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  expired_at INTEGER NOT NULL CHECK (expired_at >= 0),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (
    outcome IN ('pending', 'expired', 'final_state_preserved', 'not_found')
  ),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= received_at),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE processed_refund_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (
    length(event_id) BETWEEN 12 AND 255
    AND substr(event_id, 1, 4) = 'evt_'
    AND substr(event_id, 5) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  event_type TEXT NOT NULL CHECK (
    event_type IN ('refund.created', 'refund.updated', 'charge.refunded')
  ),
  checkout_session_id TEXT NOT NULL CHECK (
    length(checkout_session_id) BETWEEN 16 AND 255
    AND substr(checkout_session_id, 1, 8) IN ('cs_test_', 'cs_live_')
    AND substr(checkout_session_id, 9) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  refund_id TEXT CHECK (
    refund_id IS NULL OR (
      length(refund_id) BETWEEN 11 AND 255
      AND substr(refund_id, 1, 3) = 're_'
      AND substr(refund_id, 4) NOT GLOB '*[^A-Za-z0-9]*'
    )
  ),
  charge_id TEXT NOT NULL CHECK (
    length(charge_id) BETWEEN 11 AND 255
    AND substr(charge_id, 1, 3) = 'ch_'
    AND substr(charge_id, 4) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  refunded_at INTEGER NOT NULL CHECK (refunded_at >= 0),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (
    outcome IN ('pending', 'refunded', 'not_found')
  ),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= received_at)
);

CREATE INDEX idx_processed_refund_checkout_session
  ON processed_refund_events(checkout_session_id, processed_at);

DROP TABLE live_stripe_checkout_ids_migration_guard;
