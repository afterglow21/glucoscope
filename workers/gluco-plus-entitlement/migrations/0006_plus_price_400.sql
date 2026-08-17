PRAGMA foreign_keys = ON;

-- This migration is intentionally fail-closed. Plus has not been sold yet, so
-- both price-constrained tables must still be empty before changing JPY 300 to
-- JPY 400. If a payment row exists, stop and reconcile it manually instead of
-- silently rewriting accounting history.
CREATE TABLE plus_price_400_migration_guard (
  row_count INTEGER NOT NULL CHECK (row_count = 0)
);

INSERT INTO plus_price_400_migration_guard (row_count)
SELECT
  (SELECT COUNT(*) FROM processed_webhook_events)
  + (SELECT COUNT(*) FROM entitlements);

DROP TABLE entitlements;
DROP TABLE processed_webhook_events;

CREATE TABLE processed_webhook_events (
  event_id TEXT PRIMARY KEY NOT NULL CHECK (length(event_id) BETWEEN 1 AND 255),
  checkout_session_id TEXT UNIQUE NOT NULL CHECK (
    length(checkout_session_id) BETWEEN 16 AND 255
    AND substr(checkout_session_id, 1, 8) IN ('cs_test_', 'cs_live_')
    AND substr(checkout_session_id, 9) NOT GLOB '*[^A-Za-z0-9]*'
  ),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded'
    )
  ),
  account_id TEXT NOT NULL,
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy = 400),
  currency TEXT NOT NULL CHECK (currency = 'jpy'),
  paid_at INTEGER NOT NULL CHECK (paid_at >= 0),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (
    outcome IN ('pending', 'granted', 'rejected_overlap', 'rejected_refunded')
  ),
  received_at INTEGER NOT NULL CHECK (received_at >= 0),
  processed_at INTEGER CHECK (processed_at IS NULL OR processed_at >= received_at),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

CREATE TABLE entitlements (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  account_id TEXT NOT NULL,
  product_code TEXT NOT NULL CHECK (product_code = 'plus_30d'),
  purchase_kind TEXT NOT NULL CHECK (purchase_kind = 'one_time'),
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy = 400),
  currency TEXT NOT NULL CHECK (currency = 'jpy'),
  starts_at INTEGER NOT NULL CHECK (starts_at >= 0),
  ends_at INTEGER NOT NULL CHECK (ends_at - starts_at = 2592000000),
  status TEXT NOT NULL DEFAULT 'granted' CHECK (
    status IN ('granted', 'refunded', 'revoked')
  ),
  source_event_id TEXT UNIQUE NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_event_id)
    REFERENCES processed_webhook_events(event_id) ON DELETE RESTRICT
);

CREATE INDEX idx_entitlements_account_window
  ON entitlements(account_id, status, starts_at, ends_at);
CREATE INDEX idx_processed_webhook_received_at
  ON processed_webhook_events(received_at);

DROP TABLE plus_price_400_migration_guard;
