-- Optional Polar checkout id from CHM_LICENSE_KEY on instance / CLI pings.
-- Honor system: not used for feature gates. Null when unset. Not exposed by
-- GET /v1/summary (purchase identifiers stay off the public aggregate).

ALTER TABLE ping_daily ADD COLUMN license_key TEXT;
ALTER TABLE cli_daily ADD COLUMN license_key TEXT;

CREATE INDEX IF NOT EXISTS idx_ping_daily_license_key ON ping_daily (license_key);
CREATE INDEX IF NOT EXISTS idx_cli_daily_license_key ON cli_daily (license_key);
