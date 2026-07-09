---
id: standalone-cli
title: Standalone CLI (Rust)
type: reference
status: active
updated: 2026-07-10
tags:
  - rust
  - cli
  - tui
  - tools
  - diagnostics
related:
  - rust-wasm-performance
  - mcp-server
---

# Standalone chmonitor CLI (Rust)

`rust/ch-monitor-cli` provides a standalone CLI that talks to the existing API
(`hosts`/`chart`/`table`/`tui`), plus a `diagnose` subcommand that connects
**directly to a ClickHouse host** with no chmonitor backend or account
(see [Zero-signup diagnostics](#zero-signup-diagnostics-diagnose) below).

## Config Loading

Priority order:
1. `--config /path/to/config.toml`
2. `CHM_CONFIG` env var
3. Default `~/.config/chm/config.toml`
4. Direct flags/env override file values

```toml
base_url = "http://localhost:3000"
host_id = 0
api_key = "chm_xxx"
default_chart = "query-count"
```

## Commands

```bash
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- hosts
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- chart query-count --limit 50
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- table running-queries --limit 30
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- tui query-count
```

## Zero-signup diagnostics (`diagnose`)

`chm diagnose` is a **separate connection mode** from the rest of the CLI: it
talks straight to the ClickHouse HTTP interface (`reqwest` + basic auth), not
through the dashboard's `/api/v1/*` (no `base_url`/`api_key`/`host_id`, no
account, no chmonitor backend required at all). Implementation:
`rust/ch-monitor-cli/src/diagnose.rs`.

```bash
CLICKHOUSE_HOST=http://localhost:8123 CLICKHOUSE_USER=default \
  cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- diagnose

cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- diagnose \
  --ch-host http://localhost:8123 --ch-user default --ch-password secret --json
```

- Reuses the `CLICKHOUSE_HOST`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/
  `CLICKHOUSE_DATABASE` env var names the dashboard uses (or `--ch-*` flags).
  A comma-separated multi-host `CLICKHOUSE_HOST` diagnoses only the first host
  (prints a note) — multi-host clusters belong in the full dashboard.
- Every query forces `readonly=2` at the ClickHouse settings level — this can
  never mutate the target cluster no matter what a future check adds.
- Runs 12 independent read-only checks against `system.query_log`,
  `system.parts`, `system.replicas`, `system.mutations`, `system.processes`,
  `system.merges`, `system.dictionaries`, and `system.disks`. Each check is
  best-effort (`.ok()?` short-circuit): a missing table or permission error
  skips just that finding, mirroring
  `apps/dashboard/src/lib/insights/collectors.ts`'s "collectors never throw".
- Thresholds are pure functions (`classify_*`) unit-tested in
  `diagnose.rs`'s `#[cfg(test)]` module — no network needed to test scoring.
  They intentionally match the **static-threshold** path of the dashboard's
  operational insight checks (`operational-checks.ts` /
  `ai-insights.md`) rather than its statistical baseline path, since a
  one-shot CLI run has no history to fit a baseline against.
- `score_report` starts at 100 and deducts per finding (critical −20,
  warning −8, notice −2, floored at 0); `grade()` buckets into A–F.
- `--json` prints the machine-readable `Report` (also useful in CI); the
  process exits `1` if any finding is `critical`, `0` otherwise.
- Docs page: `docs/content/guide/guides/diagnostics-cli.mdx`.

## API Key Support

- CLI sends `x-api-key` header when `api_key` is configured
- Server-side API key protection enabled when `CHM_API_KEY_SECRET` is set
- Generate key via API:

```bash
curl -X POST http://localhost:3000/api/v1/auth/api-key \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CHM_API_KEY_SECRET" \
  -d '{"label":"cli","days":30}'
```

## Dependencies

| Library | Purpose |
|---------|---------|
| `clap` | CLI parser with env support |
| `reqwest` + `tokio` | Async HTTP |
| `comfy-table` | Table rendering |
| `ratatui` + `crossterm` | TUI stack |

## CI & Release

- **CI**: `cli-rust-ci.yml` — fmt, clippy, build, test
- **Release**: Tag format `chm-v*` (e.g. `chm-v0.1.0`)
- **Release workflow**: `cli-rust-release.yml` builds Linux/macOS binaries
