-- Separate tracking stream for the `chm` CLI (rust/ch-monitor-cli) and its
-- install.sh installer. Kept in its own table so CLI telemetry never mixes with
-- the dashboard's install ping (ping_daily) or aggregate events (events) —
-- distinct source dimension, distinct analytics.
--
-- Privacy contract mirrors ping_daily: install_id is an opaque SHA-256 hex
-- digest of a random local UUID persisted under ~/.config/chmonitor/. No IPs,
-- hostnames, paths, or free-text. One deduped row per (install, day, event,
-- command) so a chatty CLI collapses to at most a handful of rows per day.

CREATE TABLE IF NOT EXISTS cli_daily (
  day         TEXT NOT NULL,            -- 'YYYY-MM-DD' (UTC)
  install_id  TEXT NOT NULL,            -- opaque SHA-256 install id (or ephemeral for installs)
  event       TEXT NOT NULL,            -- cli_install | cli_run | cli_diagnose
  command     TEXT NOT NULL DEFAULT '', -- subcommand name (hosts/chart/tui/diagnose/...) or ''
  cli_version TEXT,                     -- semver-like CLI version or NULL
  os          TEXT,                     -- linux/macos/windows/unknown
  arch        TEXT,                     -- x86_64/aarch64/unknown
  PRIMARY KEY (day, install_id, event, command)
);

CREATE INDEX IF NOT EXISTS idx_cli_daily_day ON cli_daily (day);
CREATE INDEX IF NOT EXISTS idx_cli_daily_event ON cli_daily (event);
CREATE INDEX IF NOT EXISTS idx_cli_daily_command ON cli_daily (command);
