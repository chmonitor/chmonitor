-- Per-user external MCP server registrations (plan 43). Lets a signed-in user
-- register external Model Context Protocol servers (URL + transport + optional
-- auth) that are loaded alongside the built-in agent tools at conversation
-- start. See lib/ai/agent/mcp/registration-store.ts and
-- plans/43-mcp-custom-server-registry.md.
--
-- The store also creates this table lazily (`CREATE TABLE IF NOT EXISTS`) on
-- first use, mirroring the weekly-report / insights D1 store pattern — this
-- migration just gives the deployed CHM_CLOUD_D1 schema an explicit, tracked
-- record. Both are safe together: IF NOT EXISTS is idempotent, and the store's
-- DDL string is kept byte-for-byte in sync with this file.
--
-- Every row is scoped to user_id (the mandatory isolation key); reads and
-- writes always filter `WHERE user_id = ?`. `auth_secret` holds the bearer
-- token / header value ENCRYPTED at rest (AES-256-GCM, see registry-crypto.ts)
-- — never a plaintext credential.
--
-- NOTE: numbered 0015 to sit above the highest migration checked in at the time
-- this was written (0014_weekly_reports.sql). Wrangler applies migrations in
-- filename order, not by the numeric prefix alone.

CREATE TABLE IF NOT EXISTS mcp_server_registrations (
  id                 TEXT PRIMARY KEY,             -- uuid / crypto.randomUUID()
  user_id            TEXT NOT NULL,                -- Clerk user id (or 'guest' self-hosted); isolation key
  name               TEXT NOT NULL,                -- display name; sanitised into the tool-key prefix
  url                TEXT NOT NULL,                -- MCP endpoint URL (SSRF-guarded before every connect)
  transport          TEXT NOT NULL DEFAULT 'http', -- 'http' | 'sse'
  auth_kind          TEXT NOT NULL DEFAULT 'none', -- 'none' | 'bearer' | 'header'
  auth_secret        TEXT,                         -- ENCRYPTED bearer token / header value (never plaintext); null for 'none'
  auth_header_name   TEXT,                         -- custom header name when auth_kind = 'header'
  enabled            INTEGER NOT NULL DEFAULT 1,   -- 1 = loaded at conversation start, 0 = registered but off
  capabilities_json  TEXT,                         -- cached tool list from the last successful validate (JSON string)
  last_validated_at  INTEGER,                      -- unix epoch ms of the last successful validate
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_server_registrations_user_id
  ON mcp_server_registrations (user_id);
