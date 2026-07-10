-- Add the source-engine dimension to per-user connections (Postgres RFC phase 1,
-- plan #2448). Orthogonal to the storage-origin `source` — this says WHAT kind
-- of database the connection points at. Additive + fail-closed: existing rows
-- default to 'clickhouse', so no ClickHouse behaviour changes. Everything that
-- reads a non-'clickhouse' value is gated behind CHM_FEATURE_POSTGRES_SOURCE.
ALTER TABLE user_connections
  ADD COLUMN engine TEXT NOT NULL DEFAULT 'clickhouse';
