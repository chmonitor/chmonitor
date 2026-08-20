---
id: standalone-cli
title: Standalone CLI (Rust)
type: reference
status: active
updated: 2026-08-20
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

`rust/ch-monitor-cli` is the `chm` binary. By default it talks to **chmonitor
Cloud** at `https://dash.chmonitor.dev` (hosts / charts / tables / TUI / agent).
Self-hosted dashboards work the same way — point `--base-url` /
`CHM_BASE_URL` at your instance. A separate `diagnose` subcommand connects
**directly to a [REDACTED] host** with no chmonitor backend or account
(see [Zero-signup diagnostics](#zero-signup-diagnostics-diagnose) below).

## Config Loading

Priority order (highest wins):
1. CLI flags (`--base-url`, `--host-id`, `--api-key`, `--token`, `--channel`, …)
2. Environment (`CHM_BASE_URL`, `CHM_HOST_ID`, `CHM_API_KEY`, `CHM_TOKEN`, `CHM_CHANNEL`, …)
3. Project config: `./chm.toml` or `./.chm/config.toml`
4. User config: `~/.config/chm/config.toml`
5. Built-in defaults (`base_url = https://dash.chmonitor.dev`, `channel = stable`)

```toml
base_url = "https://dash.chmonitor.dev"
host_id = 0
api_key = "chm_xxx"
default_chart = "query-count"
channel = "stable" # or "beta"
```

Credentials (device-login token / API key) live in the OS keyring, with a
`0600` plaintext fallback at `~/.config/chm/credentials`.

## Command tree

```text
chm
├── auth
│   ├── login [--api-key]  # auto-detect none|device|api_key
│   ├── logout     # clear keyring credentials
│   ├── status     # whether a token / API key is present
│   └── token      # print stored bearer token (CI)
├── config         # show / edit local config
├── hosts          # GET /api/v1/hosts
├── link [path]    # open dashboard in browser
├── chart <name>   # GET /api/v1/charts/{name} (+ braille sparkline + min/max/avg)
├── table <name>   # GET /api/v1/tables/{name} (--explain for columns / SQL)
├── tui [chart]    # multi-pane TUI: 1=overview 2=chart 3=table (alt-screen)
├── chat [msg]     # stream AI agent reply (alt-screen when interactive)
├── agent [msg]    # alias of chat
├── doctor         # local + API connectivity checks
├── diagnose       # direct host health (no dashboard)
├── update|upgrade # self-update from GitHub Releases
└── completions    # shell completions
```

```bash
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- auth login
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- hosts
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- chart query-count --limit 50
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- table running-queries --limit 30
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- table running-queries --explain
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- tui query-count
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- doctor
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- agent "why are merges slow?"
```

## TUI (`chm tui`)

Multi-pane live UI (ratatui + crossterm). **Only** `chm tui` and interactive
`chm chat` enter the terminal alternate screen; other commands stay on the
normal screen.

| Key | Action |
|-----|--------|
| `1` | Overview — hosts summary + default chart sparkline |
| `2` | Chart — current chart sparkline + recent rows |
| `3` | Table — `/api/v1/tables/{name}` (default `running-queries`, `--table` / `--page-size`) |
| `h` / `l` or `[` / `]` | Decrement / increment session `host_id` (clamped ≥ 0) |
| `j` / `k` or ↑ / ↓ | Scroll table pane |
| `r` | Refresh now |
| `q` | Quit |

Header shows mode, host, channel, chart, and table name. Start in overview with
`--overview`.

## Channels

`--channel` / `CHM_CHANNEL` / config `channel`:

| Value | Self-update behaviour |
|-------|------------------------|
| `stable` (default) | Skip prereleases; prefer the latest stable `chm-v*` tag |
| `beta` | Include prereleases; prefer a prerelease when semver cores tie |

## Auth (auto-detect: none / device / API key)

`chm auth login` probes **`GET /api/v1/auth/cli`** (public) and branches on
`method` — there is **no** `auth_mode` in `chm.toml`:

| `method` | When | CLI behaviour |
|----------|------|----------------|
| `none` | `CHM_AUTH_PROVIDER=none` and no `CHM_API_KEY_SECRET` | Prints that the API is open; no credentials stored |
| `device` | Device login enabled (`resolveDeviceLogin`) | Existing RFC 8628 browser flow → store Bearer token |
| `api_key` | Secret set, device off (typical OSS without meta DB) | Prompt for a `chm_` key, or `--api-key` / `CHM_API_KEY` |

Older dashboards without `/auth/cli` fall back to `GET /api/v1/auth/device/status`
plus an anonymous `GET /api/v1/hosts` probe. `chm doctor` shows `auth_method`
from the same discovery; credentials are OK when `method=none`.
`chm auth token` prints the stored bearer token to stdout (CI).

Device login is still gated by **`CHM_DEVICE_LOGIN`** (`auto` | `true` | `false`,
default `auto`):

| Deployment | `auto` behaviour |
|------------|------------------|
| Cloud (`CHM_CLOUD_MODE` / `CHM_DEPLOYMENT_MODE=cloud`) | On when `CHM_API_KEY_SECRET` is set; `/device` requires a signed-in session |
| Self-hosted / OSS | **Off** — trusted LAN usually mints one key or leaves the API open |

Opt in on self-hosted with `CHM_DEVICE_LOGIN=true`. With
`CHM_AUTH_PROVIDER=none` that is **device-only** approve (no Clerk): anyone who
can reach `/device` completes the flow; minted tokens use subject
`CHM_DEVICE_LOGIN_SUBJECT` (default `self-hosted`). Codes persist in D1 when
bound, otherwise an in-memory store (single-node). Force off with
`CHM_DEVICE_LOGIN=false`.

Dashboard auth endpoints:

1. `GET /api/v1/auth/cli` — public discovery: `{ method, api, authProvider, deviceLogin, hint }`.
2. `GET /api/v1/auth/device/status` — device enablement only (legacy / UI).
3. `POST /api/v1/auth/device/code` — public when enabled; returns `{ data: { device_code, user_code, verification_uri, … } }` (also flattened for OAuth clients). 503 when disabled or missing `CHM_API_KEY_SECRET`.
4. Browser opens `/device?user_code=…` → approve via `POST /api/v1/auth/device/approve` (Clerk/proxy session, or device-only when auth=`none`).
5. CLI polls `POST /api/v1/auth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`. Pending → `{ error: "authorization_pending" }` (400). Success → `{ access_token }` (`chm_` key, 30 days, all scopes).

Programmatic requests may send **either** `Authorization: Bearer chm_…` **or**
`x-api-key: chm_…` (the CLI sends both when configured). The dashboard
`api-guard` and feature-permission layer accept both.

Server-side API-key protection is enabled when `CHM_API_KEY_SECRET` is set.
Mint a key:

```bash
# Admin issuance (secret as Bearer)
curl -X POST https://dash.chmonitor.dev/api/v1/auth/api-key \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $CHM_API_KEY_SECRET" \
  -d '{"label":"cli","days":30}'

# Or while signed in (session cookie / proxy identity) — user-scoped sub
curl -X POST https://dash.chmonitor.dev/api/v1/auth/api-key \
  -H 'content-type: application/json' \
  --cookie '__session=…' \
  -d '{"days":30,"scopes":["read:metrics","mcp:access"]}'
```

Response shape: `{ data: { apiKey, sub, scopes, expiresInDays } }`.

## Zero-signup diagnostics (`diagnose`)

`chm diagnose` is a **separate connection mode** from the rest of the CLI: it
talks straight to the [REDACTED] HTTP interface (`reqwest` + basic auth), not
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
- Every query forces `readonly=2` at the [REDACTED] settings level — this can
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

## Dependencies

| Library | Purpose |
|---------|---------|
| `clap` + `clap_complete` | CLI parser, env support, completions |
| `reqwest` + `tokio` | Async HTTP (JSON + SSE stream) |
| `keyring` | OS credential store |
| `comfy-table` / `indicatif` / `owo-colors` | Table + progress + color |
| `ratatui` + `crossterm` | TUI stack |

## Self-update (`chm update` / `chm upgrade`)

`chm upgrade` is a first-class alias of `chm update` (same `--check` /
`--version` flags, same `cli_run`/`update` telemetry). Both print
current -> target version, download the matching `chm-<target>` GitHub Release
asset, require a matching `.sha256`, and atomically replace the running
binary. They never invoke sudo. Homebrew-managed installs are refused
(`is_brew_managed`). Channel (`--channel` / `CHM_CHANNEL` / config):
`stable` skips prereleases; `beta` includes them and prefers a prerelease
when semver cores tie. Checksum, permission, download, and
unsupported-target failures print a copy-pasteable fallback (`scripts/install.sh`
or `cargo install ch-monitor-cli --force`; unsupported targets point at cargo
only). `--version` accepts `chm-v0.2.0`, `v0.2.0`, `0.2.0`, or `chm-0.2.0`.
Implementation: `src/update.rs`. Latest-tag lookup pages past dashboard/Helm
releases and ranks published `chm-v*` tags by semver.

```bash
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- upgrade --check
```

## CI & Release

- **CI**: `cli-rust-ci.yml` — fmt, clippy, build, test
- **Release**: Tag format `chm-v*` (e.g. `chm-v0.1.0`)
- **Release workflow**: `cli-rust-release.yml` builds 4 targets
  (`x86_64`/`aarch64` × `unknown-linux-gnu`/`apple-darwin`, no Windows) and
  uploads each binary plus a `.sha256` checksum file to the GitHub Release as
  `chm-<target>` / `chm-<target>.sha256`. Only runs the upload step on an
  actual tag push (`github.ref_type == 'tag'`); `workflow_dispatch` builds but
  doesn't publish.

## One-line install (`scripts/install.sh`)

```bash
curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash
```

- Detects OS (`Linux`/`Darwin`) + arch (`x86_64`/`aarch64`), maps to the
  release workflow's target triples, and refuses to run on anything else
  (no silent wrong-arch installs).
- Resolves the latest **published** `chm-v*` release via the GitHub releases
  API, ranking by semver (not first-match / created_at) and skipping
  drafts/prereleases. Dashboard/Helm tags share this API. Pin a specific
  release with `CHM_VERSION=chm-vX.Y.Z` (`vX.Y.Z` / `X.Y.Z` also work).
- Downloads the binary + its `.sha256` asset and verifies the checksum before
  installing; a missing or mismatched checksum is fatal (never installs an
  unverified binary). Fails loud (`set -euo pipefail`) on any
  download/verify/write failure rather than degrading silently.
- Installs to `$HOME/.local/bin` by default (override with
  `CHM_INSTALL_DIR`); never invokes `sudo` — if the target dir isn't
  writable it errors with `CHM_INSTALL_DIR` / `cargo install` fallback
  instead of escalating itself.
- `rust/ch-monitor-cli/Cargo.toml` carries `authors`/`repository`/`readme`/
  `keywords`/`categories`. `cargo-publish.yml` publishes the crate so
  `cargo install ch-monitor-cli` works as a self-update fallback. Homebrew
  is still out of scope.
