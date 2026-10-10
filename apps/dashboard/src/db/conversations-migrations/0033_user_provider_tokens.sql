-- Per-user model-provider tokens ("Sign in with AnyRouter"), encrypted at rest
-- with AES-256-GCM (see src/lib/ai/agent/user-token-store.ts). One row per
-- (owner, provider). The plaintext token is never stored.

CREATE TABLE IF NOT EXISTS user_provider_tokens (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  expires_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, provider)
);
