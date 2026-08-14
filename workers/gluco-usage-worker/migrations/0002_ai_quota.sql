PRAGMA foreign_keys = ON;

CREATE TABLE ai_quota_days (
  subject_key TEXT NOT NULL CHECK (length(subject_key) = 43),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('device_profile', 'account')),
  device_profile_id TEXT,
  day TEXT NOT NULL CHECK (length(day) = 10),
  success_count INTEGER NOT NULL DEFAULT 0
    CHECK (success_count BETWEEN 0 AND 5),
  last_completed_reservation_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (subject_key, day),
  CHECK (
    (subject_kind = 'device_profile' AND device_profile_id IS NOT NULL)
    OR (subject_kind = 'account' AND device_profile_id IS NULL)
  ),
  FOREIGN KEY (device_profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE ai_quota_attempts (
  subject_key TEXT NOT NULL CHECK (length(subject_key) = 43),
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('device_profile', 'account')),
  request_id TEXT NOT NULL CHECK (length(request_id) = 36),
  reservation_id TEXT NOT NULL UNIQUE CHECK (length(reservation_id) = 36),
  day TEXT NOT NULL CHECK (length(day) = 10),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'released')),
  tier_at_reserve TEXT NOT NULL CHECK (tier_at_reserve IN ('free', 'plus')),
  daily_limit INTEGER NOT NULL CHECK (daily_limit IN (1, 5)),
  analysis_mode TEXT NOT NULL CHECK (analysis_mode IN ('letter', 'deep')),
  reserved_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  release_reason TEXT CHECK (
    release_reason IS NULL OR release_reason IN (
      'provider_error',
      'quality_failed',
      'generation_incomplete',
      'cache_fallback',
      'request_aborted',
      'internal_error'
    )
  ),
  PRIMARY KEY (subject_key, request_id),
  FOREIGN KEY (subject_key, day)
    REFERENCES ai_quota_days(subject_key, day)
    ON DELETE CASCADE
);

CREATE INDEX idx_ai_quota_attempts_subject_day_status
  ON ai_quota_attempts(subject_key, day, status, expires_at);

CREATE INDEX idx_ai_quota_attempts_day_status
  ON ai_quota_attempts(day, status);

CREATE VIEW admin_ai_quota_daily_totals AS
SELECT
  day,
  COALESCE(SUM(success_count), 0) AS ai_generation_success_total,
  COUNT(CASE WHEN success_count > 0 THEN 1 END) AS active_subjects
FROM ai_quota_days
GROUP BY day;
