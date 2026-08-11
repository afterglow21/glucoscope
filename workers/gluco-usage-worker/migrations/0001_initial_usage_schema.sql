PRAGMA foreign_keys = ON;

CREATE TABLE profiles (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT UNIQUE NOT NULL CHECK (length(token_hash) = 43),
  display_name TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 30),
  collection_enabled INTEGER NOT NULL DEFAULT 1 CHECK (collection_enabled IN (0, 1)),
  notice_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  request_day TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);

CREATE TABLE usage_daily (
  profile_id TEXT NOT NULL,
  day TEXT NOT NULL CHECK (length(day) = 10),
  visit_day_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_day_count IN (0, 1)),
  ai_generation_success_count INTEGER NOT NULL DEFAULT 0
    CHECK (ai_generation_success_count BETWEEN 0 AND 30),
  ordinary_gluco_memory_count INTEGER NOT NULL DEFAULT 0
    CHECK (ordinary_gluco_memory_count BETWEEN 0 AND 50),
  last_ai_event_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, day),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE TABLE event_receipts (
  profile_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'visit_day',
      'ai_generation_success',
      'ordinary_gluco_memory_count'
    )
  ),
  outcome TEXT NOT NULL DEFAULT 'pending' CHECK (
    outcome IN ('pending', 'accepted', 'daily_limit')
  ),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, event_id),
  FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX idx_usage_daily_day ON usage_daily(day);
CREATE INDEX idx_profiles_last_seen_at ON profiles(last_seen_at);
CREATE INDEX idx_event_receipts_expires_at ON event_receipts(expires_at);

CREATE VIEW admin_device_usage AS
SELECT
  p.id AS profile_id,
  p.display_name,
  p.collection_enabled AS sharing_enabled,
  p.created_at,
  p.last_seen_at,
  COALESCE(SUM(CASE WHEN u.visit_day_count = 1 THEN 1 ELSE 0 END), 0) AS active_days,
  COALESCE(SUM(u.ai_generation_success_count), 0) AS ai_generation_success_total,
  COALESCE(MAX(u.ordinary_gluco_memory_count), 0) AS ordinary_gluco_memory_count
FROM profiles AS p
LEFT JOIN usage_daily AS u ON u.profile_id = p.id
GROUP BY
  p.id,
  p.display_name,
  p.collection_enabled,
  p.created_at,
  p.last_seen_at;
