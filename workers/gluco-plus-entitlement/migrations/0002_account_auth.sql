PRAGMA foreign_keys = ON;

-- The original local-only foundation reserved these two columns for encrypted
-- email. Account auth intentionally stores no recoverable email instead. Keep a
-- fixed marker so older local databases can migrate without rebuilding the
-- accounts table or its entitlement foreign keys.
UPDATE accounts
SET email_ciphertext = 'email-not-stored-v1', email_key_version = 1;

CREATE TRIGGER accounts_reject_email_ciphertext_insert
BEFORE INSERT ON accounts
WHEN NEW.email_ciphertext <> 'email-not-stored-v1'
BEGIN
  SELECT RAISE(ABORT, 'recoverable email storage is disabled');
END;

CREATE TRIGGER accounts_reject_email_ciphertext_update
BEFORE UPDATE OF email_ciphertext ON accounts
WHEN NEW.email_ciphertext <> 'email-not-stored-v1'
BEGIN
  SELECT RAISE(ABORT, 'recoverable email storage is disabled');
END;

CREATE TABLE account_auth_challenges (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
  email_lookup_hmac TEXT NOT NULL CHECK (length(email_lookup_hmac) = 43),
  email_hmac_key_version INTEGER NOT NULL DEFAULT 1 CHECK (
    email_hmac_key_version >= 1
  ),
  code_hmac TEXT NOT NULL CHECK (length(code_hmac) = 43),
  verification_grant_hash TEXT NOT NULL CHECK (
    length(verification_grant_hash) = 43
  ),
  contact_role TEXT NOT NULL CHECK (contact_role IN ('self', 'guardian')),
  send_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    send_state IN ('pending', 'sent', 'failed')
  ),
  attempts_remaining INTEGER NOT NULL CHECK (
    attempts_remaining BETWEEN 0 AND 10
  ),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  sent_at INTEGER CHECK (sent_at IS NULL OR sent_at >= created_at),
  consumed_at INTEGER CHECK (consumed_at IS NULL OR consumed_at >= created_at),
  invalidated_at INTEGER CHECK (
    invalidated_at IS NULL OR invalidated_at >= created_at
  ),
  CHECK (consumed_at IS NULL OR invalidated_at IS NULL)
);

CREATE INDEX idx_account_auth_challenges_email_created
  ON account_auth_challenges(email_lookup_hmac, created_at DESC);
CREATE INDEX idx_account_auth_challenges_expiry
  ON account_auth_challenges(expires_at);
