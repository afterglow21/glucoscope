PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  email_lookup_hmac TEXT UNIQUE NOT NULL CHECK (length(email_lookup_hmac) = 43),
  email_ciphertext TEXT NOT NULL CHECK (
    length(email_ciphertext) BETWEEN 16 AND 4096
  ),
  email_key_version INTEGER NOT NULL CHECK (email_key_version >= 1),
  email_verified_at INTEGER NOT NULL CHECK (email_verified_at >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'suspended', 'deleted')
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  account_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL CHECK (length(token_hash) = 43),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

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
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy = 300),
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
  amount_jpy INTEGER NOT NULL CHECK (amount_jpy = 300),
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

CREATE TABLE share_trial_state (
  account_id TEXT PRIMARY KEY NOT NULL,
  used_at INTEGER CHECK (used_at IS NULL OR used_at >= 0),
  completed_request_id TEXT UNIQUE,
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  CHECK (
    (used_at IS NULL AND completed_request_id IS NULL)
    OR (used_at IS NOT NULL AND completed_request_id IS NOT NULL)
  ),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE TABLE share_trial_operations (
  request_id TEXT PRIMARY KEY NOT NULL CHECK (length(request_id) = 36),
  account_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('reserved', 'completed', 'released', 'expired')
  ),
  reserved_at INTEGER NOT NULL CHECK (reserved_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > reserved_at),
  completed_at INTEGER CHECK (completed_at IS NULL OR completed_at >= reserved_at),
  released_at INTEGER CHECK (released_at IS NULL OR released_at >= reserved_at),
  updated_at INTEGER NOT NULL CHECK (updated_at >= reserved_at),
  CHECK (
    (state = 'completed' AND completed_at IS NOT NULL AND released_at IS NULL)
    OR (state = 'released' AND completed_at IS NULL AND released_at IS NOT NULL)
    OR (state IN ('reserved', 'expired') AND completed_at IS NULL AND released_at IS NULL)
  ),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_account_id ON sessions(account_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_entitlements_account_window
  ON entitlements(account_id, status, starts_at, ends_at);
CREATE INDEX idx_processed_webhook_received_at
  ON processed_webhook_events(received_at);
CREATE INDEX idx_share_trial_operations_expiry
  ON share_trial_operations(state, expires_at);
CREATE UNIQUE INDEX idx_share_trial_one_live_reservation
  ON share_trial_operations(account_id)
  WHERE state = 'reserved';
