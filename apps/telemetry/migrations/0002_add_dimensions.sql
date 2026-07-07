-- Add additional privacy-safe telemetry dimensions for better insights.
-- All fields are optional and use safe enums or validated country codes.

ALTER TABLE ping_daily ADD COLUMN ch_flavor TEXT; -- oss/altinity/cloud/unknown
ALTER TABLE ping_daily ADD COLUMN country TEXT;   -- ISO 3166-1 alpha-2 or NULL
ALTER TABLE ping_daily ADD COLUMN platform TEXT;  -- windows/macos/linux/android/ios/unknown

-- Create indexes for common summary queries
CREATE INDEX IF NOT EXISTS idx_ping_daily_country ON ping_daily (country);
CREATE INDEX IF NOT EXISTS idx_ping_daily_platform ON ping_daily (platform);
CREATE INDEX IF NOT EXISTS idx_ping_daily_ch_flavor ON ping_daily (ch_flavor);
