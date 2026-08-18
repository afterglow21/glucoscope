PRAGMA foreign_keys = ON;

-- A completed Share Studio trial must not become available again merely
-- because a purchase-free account was deleted and recreated. Keep only the
-- irreversible email lookup HMAC and the minimum timing metadata for 90 days
-- from successful trial completion. Do not add a raw email address, display
-- name, CGM value, AI content, image, or purchase identifier to this table.
CREATE TABLE share_trial_reuse_retention (
  email_lookup_hmac TEXT PRIMARY KEY NOT NULL CHECK (
    length(email_lookup_hmac) = 43
  ),
  email_hmac_key_version INTEGER NOT NULL CHECK (
    email_hmac_key_version >= 1
  ),
  trial_used_at INTEGER NOT NULL CHECK (trial_used_at >= 0),
  expires_at INTEGER NOT NULL CHECK (
    expires_at - trial_used_at = 7776000000
  ),
  created_at INTEGER NOT NULL CHECK (
    created_at >= trial_used_at AND created_at < expires_at
  ),
  updated_at INTEGER NOT NULL CHECK (
    updated_at >= created_at AND updated_at < expires_at
  )
);

CREATE INDEX idx_share_trial_reuse_retention_expiry
  ON share_trial_reuse_retention(expires_at);
