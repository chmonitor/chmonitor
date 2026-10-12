# Query configs and ClickHouse SQL

Every table page and many charts run SQL from a `QueryConfig` under
`apps/dashboard/src/lib/query-config/**`, typed by
`apps/dashboard/src/types/query-config.ts`. The SQL runs on the user's own
ClickHouse, so a proof must show that the query parses and returns the
expected columns on a real server, not only that the config file type-checks.

## Sub-features

- `qc-versioned-sql` picks the highest `sql: [{ since, sql }]` variant that is
  at or below the server version.
- `qc-optional-table` marks configs with `optional: true` and `tableCheck` so
  a missing table such as `system.backup_log` renders a friendly state instead
  of an error.
- `qc-output-columns` keeps output column names unique and unqualified under
  both `enable_analyzer=1` and `enable_analyzer=0`.
- `qc-static-sql` covers the shipped-SQL validator, alias shadowing,
  `SELECT *` alias collisions, log-scan bounds, and SQL regression cases.
- `qc-background-bar` keeps each BackgroundBar column as a base, `readable_*`,
  and `pct_*` triple.

## How to get to it (user POV)

- Open a query-config page such as `/merges?host=0` or
  `/running-queries?host=0`. The table renders, its columns match the config,
  and the SQL dialog shows the query for the server's version.
- On a server without an optional table, the page shows the optional-table
  message rather than a raw ClickHouse error.

## Driving it with CI

Preconditions:

- `.github/workflows/test.yml` has no `paths:` filter, so both jobs below run
  on every pull request and on push to `main`.
- Check the column against `docs/clickhouse-schemas/tables/<table>.md` before
  claiming a column exists on a version.

- **Static contracts.** Job `unit-tests` (required) runs
  `pnpm run test:coverage:ci` (`bun test src/`). That includes
  `src/lib/query-config/__tests__/` (`shipped-sql-passes-validator`,
  `sql-regressions`, `alias-shadowing`, `select-star-alias-collision`,
  `log-scan-bounds`, `declarative-parity`), `version-compatibility.test.ts`,
  and `background-bar-companions.test.ts`. The live cases skip in this job,
  because it has no ClickHouse.
- **Live server.** Job `test-queries-config` (non-required) starts
  `clickhouse/clickhouse-server:26.7` and `clickhouse/clickhouse-keeper:26.7`.
  It runs `pnpm run test:query-config` with `CHM_LIVE_CLICKHOUSE=1`, then
  `pnpm run test:packages:ci`. It is the only job with a real ClickHouse.
  `output-columns-live.test.ts` fails there when the server is unreachable,
  instead of skipping.
- **Evidence.** Record the job, the ClickHouse version, and the config name.
  For a failure, quote the config name and the server error, not the whole
  result set.

## Gotchas

- CI runs one ClickHouse version, 26.7. A `since` branch for an older version
  is `not exercised` in CI. Prove it against that version with
  `clickhouse local` or a scratch server, or label it `verified-unreachable`.
- A green `unit-tests` run alone is not evidence that live SQL works. Without
  a reachable server, the live cases return early and pass.
- Locally, `CLICKHOUSE_HOST` from `.env` does not mean a server is listening.
  Set `CHM_LIVE_CLICKHOUSE=1` only when one is, so an unreachable server
  fails instead of skipping.
- A server that rejects a query is a SQL defect, not an environment gap. The
  live test collects those rejections as failures.
- The `.claude/hooks/validate-query-config.sh` post-edit hook only checks for
  required fields. It is not query-config test evidence.
