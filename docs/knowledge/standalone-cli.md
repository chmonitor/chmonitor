---
id: standalone-cli
title: Standalone CLI (Rust)
type: reference
status: active
updated: 2026-08-27
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

`rust/ch-monitor-cli` ships two command names for the same binary: **`chm`**
(short, preferred) and **`chmonitor`** (full alias). Release assets stay
`chm-<target>`; `scripts/install.sh` installs `chm` and symlinks `chmonitor`.
`cargo install chmonitor` installs both binaries.

**`chm` with no subcommand opens the live TUI** (`chm tui` is an explicit alias
of the same UI) showing the **ops cockpit** (health strip, charts, running
queries). `chm --ch-host` talks **directly to ClickHouse** (read-only) instead
of the dashboard API. When stdout/stdin is not a TTY, or `CI` / `CHM_NO_TUI` /
`--no-tui` / `--json` / `TERM=dumb` is set, it prints a one-shot snapshot
(agents and CI) instead of entering the alt-screen. `chm --help` /
`chm help` / `chm -h` still print help.

By default it talks to **chmonitor
Cloud** at `https://dash.chmonitor.dev` (hosts / charts / tables / TUI / agent).
Self-hosted dashboards work the same way — point `--base-url` /
`CHM_BASE_URL` / `chm config set base_url` at your instance. `chm doctor --ch-host`
connects **directly to a ClickHouse host** with no chmonitor backend or account
(see [Zero-signup cluster health](#zero-signup-cluster-health-doctor) below).

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
`0600` plaintext fallback at `~/.config/chm/credentials`. Local connection
passwords use the same helper (`connection.<name>` keys) and are never written
into `config.toml`.

## Local connections (`chm add` / `ls` / `use`)

P0 local store — no dashboard, no network on add:

```bash
chm add http://localhost:8123
chm add http://user:pass@ch.example:8123/analytics --name prod
chm add localhost:8123 --ch-user default          # --ch-host style
chm add postgres://user:pass@localhost:5432/app
chm ls                 # name, engine, host, current marker; `--json`
chm use prod
chm rm prod            # optional
```

`connect` is an alias of `add`. Names default to a short host/db slug. The
active name is `current_connection` in user `config.toml`. `chm hosts` still
lists **dashboard** `/api/v1/hosts` only. The live TUI opens against the active
local ClickHouse connection; `h`/`l` cycles local connections without restart. <!-- pragma: allowlist secret -->
Postgres add/use/ls works; PG TUI panes are a later slice.

## Command tree

```text
chm                # live TUI (default; same as `chm tui`)
├── tui [chart]    # explicit TUI alias (alt-screen)
├── add <url>      # save a local named connection (alias: connect)
├── ls             # list local connections (`--json`; TTY picker to use)
├── use <name>     # set the active local connection
├── rm <name>      # remove a local named connection
├── auth
│   ├── login [--api-key]
│   ├── logout
│   ├── status
│   └── token
├── config         # interactive dialog (no subcommand)
│   ├── show
│   ├── path
│   └── set KEY VALUE
├── dashboard
│   ├── list
│   └── open <name>
├── hosts          # dashboard API hosts (not the local store)
├── link [path]
├── chart <name>
├── table <name>
├── chat [msg]
├── agent [msg]
├── doctor         # cluster scan with --ch-host; else connectivity
└── update         # self-update from GitHub Releases
```

```bash
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- tui
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- dashboard list
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- config show
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- auth login
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- hosts
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- chart query-count --limit 50
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- table running-queries --limit 30
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- table running-queries --explain
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- doctor
```

## CI report (size / time)

`.github/workflows/cli-report.yml` builds **only** `-p chmonitor` on rust
PRs (including the rolling release-please CLI PR) for the four release
targets: linux gnu x86_64/aarch64 and macOS x86_64/aarch64. It posts one
sticky comment (`header: cli-build-report`) and recreates it on each push
so only the latest numbers stay. Local:

```bash
bash scripts/cli-build-report.sh --target x86_64-unknown-linux-gnu
```

## TUI (`chm` / `chm tui`)

Live UI (ratatui + crossterm). Bare `chm` and `chm tui` are the same command
(telemetry `cli_run` / `tui`). The default view is the **Overview dashboard**:
`query-count`, `running-queries-count`, `database-count`, `table-count`, and
`disk-size-single` (or `disk-size-all`) via
`GET /api/v1/charts/{name}` with `hostId`, a one-day `lastHours` window, and
hourly `interval`.
Live tiles refresh every fifteen seconds; query-log charts refresh every two
minutes so the TUI cannot hammer the cluster. Chart JSON is capped (sparkline
points plus the latest row). HTTP 404 charts are skipped. The running-queries
table stays a secondary pane (page size plus string truncation). `chm dashboard
list` (and `chm dashboard open <name>`) open the same TUI bound to Overview or a
saved dashboard's `layout.widgets[].chartName`. All interactive surfaces use
ratatui on the alternate screen: live TUI, `chm chat`, `chm config`, and the
`dashboard list` picker. One-shot commands stay on the normal screen.

One screen: hosts + chart grid **and** the table together when the terminal is
tall/wide enough (`≥72×24`). Smaller terminals collapse to a focused pane with
a visible `overview | table` switcher.

| Key | Action |
|-----|--------|
| `q` / `Esc` | Quit (`Esc` first clears an active table filter) |
| `r` | Refresh now |
| `?` | Help overlay |
| `a` | Open interactive agent chat (returns to the TUI on exit) |
| `h` / `l` or ← / → or `[` / `]` | Previous / next host (dashboard `/api/v1/hosts`, or local `chm add` connections) |
| `j` / `k` or ↑ / ↓ | Scroll table |
| `Tab` | Switch pane (small terminals) |
| `1` | Overview pane |
| `2` / `3` | Table pane |
| `/` | Filter table rows |

Header shows dashboard name, host name, short base URL, channel, and live/refresh
age. Footer lists the keys above. Auth failures (HTTP 401/403) show
`chm auth login` in the TUI instead of panicking. Default focus is the overview
chart grid (`--overview` still accepted).

## Dashboards (`chm dashboard list`)

Always lists built-in **Overview** first. When signed in, also fetches
`GET /api/dashboards/list` and uses each `layout.widgets[].chartName` where
`type=chart`. HTTP 401/403/501 still lists Overview plus a one-line reason.
Interactive TTY: ratatui picker (j/k/arrows, Enter opens the TUI, q/Esc
cancels). `--json` or piped stdout prints names (no picker).
`chm dashboard open <name>` opens by name.

## Config (`chm config` / `chm config show`)

Bare `chm config` opens an interactive dialog (alt-screen) for `base_url`,
`host_id`, `channel`, `default_chart` and writes `~/.config/chm/config.toml`.
API key / token are not edited as plaintext in the form (`chm config set` /
`chm auth login`). Esc cancels; Enter/s saves. `chm config set KEY VALUE`
stays for scripts.

`chm config show` prints layering (highest file layer wins among files; flags/env
beat files):

1. User `~/.config/chm/config.toml` — path, exists, full content (`api_key` /
   `token` redacted as `(set)`)
2. Project `./chm.toml` and `./.chm/config.toml`
3. Env / flags that overrode
4. Resolved config (including default `base_url = https://dash.chmonitor.dev`)

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

## Zero-signup cluster health (`doctor`)

`chm doctor --ch-host` is a **separate connection mode** from the rest of the CLI: it
talks straight to the ClickHouse HTTP interface (`reqwest` + basic auth), not
through the dashboard's `/api/v1/*` (no `base_url`/`api_key`/`host_id`, no
account, no chmonitor backend required at all). Without a host, `chm doctor` keeps the local
CLI + dashboard connectivity check. Implementation:
`rust/ch-monitor-cli/src/diagnose.rs` (scan) and `src/commands/doctor.rs`
(connectivity).

```bash
CLICKHOUSE_HOST=http://localhost:8123 CLICKHOUSE_USER=default \
  cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- doctor

cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- doctor \
  --ch-host http://localhost:8123 --ch-user default --ch-password secret --json
```

- Reuses the `CLICKHOUSE_HOST`/`CLICKHOUSE_USER`/`CLICKHOUSE_PASSWORD`/
  `CLICKHOUSE_DATABASE` env var names the dashboard uses (or `--ch-*` flags).
  A comma-separated multi-host `CLICKHOUSE_HOST` scans only the first host
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
| `clap` | CLI parser, env support |
| `reqwest` + `tokio` | Async HTTP (JSON + SSE stream) |
| `keyring` | OS credential store |
| `comfy-table` / `indicatif` / `owo-colors` | Table + progress + color |
| `ratatui` + `crossterm` | TUI stack |

## Self-update (`chm update`)

`chm update` prints current -> target version, downloads the matching `chm-<target>` GitHub Release
asset, requires a matching `.sha256`, and atomically replaces the running
binary. It never invokes sudo. Homebrew-managed installs are refused
(`is_brew_managed`). Channel (`--channel` / `CHM_CHANNEL` / config):
`stable` skips prereleases; `beta` includes them and prefers a prerelease
when semver cores tie. `chm update --beta` writes `channel = "beta"` to the
user config **then** installs from beta; `--stable` does the inverse. The
process always `exit`s after the command (reqwest keep-alives must not stall
after “already up to date”). Checksum, permission, download, and
unsupported-target failures print a copy-pasteable fallback (`scripts/install.sh`
or `cargo install chmonitor --force`; unsupported targets point at cargo
only). `--version` accepts `chm-v0.2.0`, `v0.2.0`, `0.2.0`, or `chm-0.2.0`.
Implementation: `src/update.rs`. Latest-tag lookup pages past dashboard/Helm
releases and ranks published `chm-v*` tags by semver.

```bash
cargo run --manifest-path rust/ch-monitor-cli/Cargo.toml -- update --check
```

## CI & Release

- **CI**: `cli-rust-ci.yml` — fmt, clippy, build, test
- **Platforms**: Linux + macOS × `x86_64` + `aarch64` only (no Windows yet).
  Asset names: `chm-<target>` and `chm-<target>.sha256` for each of
  `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`,
  `x86_64-apple-darwin`, `aarch64-apple-darwin` (8 files per release).
- **Release workflow** (`cli-rust-release.yml`): split into `meta` → `build`
  (matrix, upload-artifact per target) → `publish` (download all artifacts,
  softprops **once**, assert all 8 assets before and after upload).
  Concurrency group `cli-rust-release-${{ inputs.tag || github.ref }}`
  (`cancel-in-progress: false`).

### Beta (prerelease from `main`)

Every push to `main` that touches CLI paths
(`rust/ch-monitor-cli/**`, `rust/Cargo.lock`, `rust/Cargo.toml`,
`.github/workflows/cli-rust-release.yml`, `scripts/install.sh`) publishes a
**prerelease** tag `chm-vX.Y.Z-beta.N` where `X.Y.Z` is
`rust/ch-monitor-cli/Cargo.toml`’s version and `N` is `github.run_number`.
`make_latest=false`. Versions outside `0.1.x` are refused.

### Stable (release-please + dispatch)

1. release-please opens `chore(main): release cli chm-vX.Y.Z` when CLI commits
   warrant a stable bump.
2. Merging that PR tags `chm-vX.Y.Z` and dispatches `cli-rust-release.yml`
   with `tag=` (GITHUB_TOKEN-created tags do not fire `on: push: tags`).
3. Direct `workflow_dispatch` with a tag, or a human-pushed stable
   `chm-vX.Y.Z` tag, also publish. `prerelease=false`, `make_latest=true`.

## One-line install (`scripts/install.sh`)

```bash
# Stable (default)
curl -sSf https://chmonitor.dev/install.sh | bash

# Beta channel
CHM_CHANNEL=beta bash <(curl -sSf https://chmonitor.dev/install.sh)
```

If curl gets a Cloudflare Bot Fight Mode 403, see
[install-sh-bot-fight.md](install-sh-bot-fight.md).

- Detects OS (`Linux`/`Darwin`) + arch (`x86_64`/`aarch64`), maps to the
  release workflow's target triples, and refuses to run on anything else
  (no silent wrong-arch installs).
- Resolves the latest **published** `chm-v*` release via the GitHub Releases
  API for `CHM_CHANNEL` (`stable` | `beta`). Stable skips drafts/prereleases;
  beta prefers prereleases (falls back to stable if none). Ranking is by
  semver, not first-match / created_at. Pin with
  `CHM_VERSION=chm-vX.Y.Z` (`vX.Y.Z` / `X.Y.Z` also work).
- Downloads the binary + its `.sha256` asset and verifies the checksum before
  installing; a missing or mismatched checksum is fatal (never installs an
  unverified binary). Fails loud (`set -euo pipefail`) on any
  download/verify/write failure rather than degrading silently.
- Installs to `$HOME/.local/bin` by default (override with
  `CHM_INSTALL_DIR`); never invokes `sudo` — if the target dir isn't
  writable it errors with `CHM_INSTALL_DIR` / `cargo install` fallback
  instead of escalating itself.
- Also installs a `chmonitor` symlink/alias pointing at `chm`.
- Self-update: `chm update` (`--channel stable|beta`, or
  `CHM_CHANNEL` / config `channel`) pull from the same GitHub Releases.
- `rust/ch-monitor-cli/Cargo.toml` carries `authors`/`repository`/`readme`/
  `keywords`/`categories`. `cargo-publish.yml` publishes the crate so
  `cargo install chmonitor` works as a self-update fallback. Homebrew
  is still out of scope.
