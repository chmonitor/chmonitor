-- Analytics views for D1-primary telemetry.
-- These views power the /v1/summary endpoint and the public analytics dashboard.
-- They replace the Analytics Engine hot store with D1-native SQL aggregation.

-- Raw events table (replaces AE event storage)
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  day         TEXT NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  event       TEXT NOT NULL,            -- event name (app_loaded, cluster_connected, etc.)
  deploy_target TEXT,
  ch_version  TEXT,
  ch_flavor   TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_day ON events (day);
CREATE INDEX IF NOT EXISTS idx_events_event ON events (event);

-- Event counts by name (last 30 days)
CREATE VIEW IF NOT EXISTS v_events_by_name AS
SELECT event, COUNT(*) AS count
FROM events
WHERE day >= date('now', '-30 days')
GROUP BY event
ORDER BY count DESC;

-- Total distinct installs (all time)
CREATE VIEW IF NOT EXISTS v_total_installs AS
SELECT COUNT(DISTINCT instance_hash) AS total
FROM ping_daily;

-- Installs by deploy target (all time)
CREATE VIEW IF NOT EXISTS v_by_deploy_target AS
SELECT deploy_target, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
GROUP BY deploy_target;

-- Installs by CH version (all time)
CREATE VIEW IF NOT EXISTS v_by_ch_version AS
SELECT COALESCE(ch_version, 'unknown') AS ch_version, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
GROUP BY ch_version
ORDER BY installs DESC;

-- Installs by CH flavor (all time)
CREATE VIEW IF NOT EXISTS v_by_ch_flavor AS
SELECT COALESCE(ch_flavor, 'unknown') AS ch_flavor, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
GROUP BY ch_flavor
ORDER BY installs DESC;

-- Installs by country (top 10)
CREATE VIEW IF NOT EXISTS v_by_country AS
SELECT COALESCE(country, 'unknown') AS country, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
GROUP BY country
ORDER BY installs DESC
LIMIT 10;

-- Installs by platform (all time)
CREATE VIEW IF NOT EXISTS v_by_platform AS
SELECT COALESCE(platform, 'unknown') AS platform, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
GROUP BY platform
ORDER BY installs DESC;

-- Installs by CHM version (all time)
CREATE VIEW IF NOT EXISTS v_by_chm_version AS
SELECT COALESCE(chm_version, 'unknown') AS chm_version, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
GROUP BY ch_version
ORDER BY installs DESC;

-- Total distinct install places (environments)
CREATE VIEW IF NOT EXISTS v_total_places AS
SELECT COUNT(DISTINCT install_place) AS total
FROM ping_daily
WHERE install_place IS NOT NULL;

-- Daily install trend (last 30 days)
CREATE VIEW IF NOT EXISTS v_daily_trend AS
SELECT day, COUNT(DISTINCT instance_hash) AS installs
FROM ping_daily
WHERE day >= date('now', '-30 days')
GROUP BY day
ORDER BY day DESC;

-- Active installs in last 30 days
CREATE VIEW IF NOT EXISTS v_active_installs_30d AS
SELECT COUNT(DISTINCT instance_hash) AS active_installs
FROM ping_daily
WHERE day >= date('now', '-30 days');
