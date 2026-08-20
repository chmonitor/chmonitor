-- OAuth device-code grant store for `chm auth login` (RFC 8628).
-- Lives in CHM_CLOUD_D1 alongside conversations / slack installs.
-- Optional: without D1 the device-login endpoints return 503 and the CLI
-- falls back to a manually issued API key.

CREATE TABLE IF NOT EXISTS oauth_device_codes (
  device_code   TEXT PRIMARY KEY,
  user_code     TEXT NOT NULL UNIQUE,  -- stored UPPERCASE (e.g. ABCD-EFGH)
  client_id     TEXT NOT NULL,
  created_at    INTEGER NOT NULL,      -- unix ms
  expires_at    INTEGER NOT NULL,      -- unix ms
  interval_sec  INTEGER NOT NULL DEFAULT 5,
  approved_at   INTEGER,              -- unix ms when the user approved
  user_id       TEXT,                 -- Clerk/proxy subject that approved
  consumed_at   INTEGER               -- unix ms when token was issued
);

CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_user_code
  ON oauth_device_codes (user_code);

CREATE INDEX IF NOT EXISTS idx_oauth_device_codes_expires
  ON oauth_device_codes (expires_at);
