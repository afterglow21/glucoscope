PRAGMA foreign_keys = ON;

-- One opaque reservation is kept for each attempted verification email so the
-- provider's free daily allowance cannot be exhausted by rotating addresses.
-- It contains no email address, email HMAC, verification code, or provider ID.
CREATE TABLE account_email_send_reservations (
  challenge_id TEXT PRIMARY KEY NOT NULL CHECK (length(challenge_id) = 36),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    delivery_state IN ('pending', 'sent', 'failed')
  ),
  reserved_at INTEGER NOT NULL CHECK (reserved_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= reserved_at)
);

CREATE INDEX idx_account_email_send_reservations_reserved
  ON account_email_send_reservations(reserved_at);
