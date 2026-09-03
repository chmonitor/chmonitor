---
name: verify-chmonitor
description: >-
  Drive chmonitor the way a user does: the Rust CLI/TUI (`chm` / `chmonitor`
  in rust/ch-monitor-cli) is the primary surface; the dashboard at
  apps/dashboard and https://dash.chmonitor.dev is secondary. Use when proving
  CLI/TUI behavior, `chm doctor`, local `chm add`/`ls`/`use`/`rm`, or when a
  change needs launch → doctor → drive → evidence → cleanup.
---

# Verify chmonitor

Agent-facing control skill. Read this cold, then the matching file under
`features/`. Primary surface is the **standalone CLI** (`chm`, alias
`chmonitor`). The web dashboard is a second user surface — map it, do not
require adding a host on `dash.chmonitor.dev`.

Helpers live in `.cursor/skills/verify-chmonitor/scripts/` and are executable.
Source of truth for commands is those scripts plus this file — not remembered
flags.

## Launch

There is no long-lived CLI server. Launch means **build this checkout's
binary once**, then start each drive in an isolated process or tmux session.

```bash
.cursor/skills/verify-chmonitor/scripts/launch.sh
```

What it does:

1. Requires `rustc`/`cargo` **>= 1.85** (workspace lockfile pulls edition-2024
   crates; CI uses `dtolnay/rust-toolchain@stable`). This Cloud image shipped
   1.83 — `rustup toolchain install stable && rustup default stable` first.
2. `cargo build -p chmonitor --manifest-path rust/Cargo.toml` (debug profile;
   release enables LTO/`opt-level=z` and is too slow for verification).
3. Installs `rust/target/debug/chm` and `chmonitor` to
   `$VERIFY_PREFIX/bin/` (default `/tmp/verify-chmonitor/prefix/bin/`).
4. Writes `$VERIFY_PREFIX/identity.json` (`bin`, `crate_version`, `target`,
   `git_head`). Ready when `chm --version` prints
   `<crate version> (<target>)`, e.g. `chm 0.1.3 (x86_64-unknown-linux-gnu)`.

Teardown of the install is optional (`scripts/cleanup.sh --purge`). Scratch
config and tmux sessions are removed by `scripts/cleanup.sh` without `--purge`.

**Isolated config (required):** every `chm` invocation in this skill uses
`--config $VERIFY_SCRATCH/config.toml`. That parent dir is **not**
`~/.config/chm`, so the connection store does not touch the OS keyring.
Do **not** set `XDG_CONFIG_HOME` to the scratch dir — that would make
`user_config_dir()` match and enable keyring. Do not write to the operator's
`~/.config/chm`.

**Env that must be unset** unless a recipe passes an explicit `--ch-host`:
`CLICKHOUSE_HOST`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, <!-- pragma: allowlist secret -->
`CLICKHOUSE_DATABASE`, `CHM_API_KEY`, `CHM_TOKEN`, `CI`, `GITHUB_ACTIONS`, <!-- pragma: allowlist secret -->
`CHM_NO_TUI`. Cloud agent shells often have `TERM=dumb` and a real
`CLICKHOUSE_HOST`; both change CLI behavior (`wants_tui` is false when <!-- pragma: allowlist secret -->
`TERM=dumb` / `CI` / `--json` / `--no-tui`; a set `CLICKHOUSE_HOST` turns <!-- pragma: allowlist secret -->
`chm doctor` and bare `chm` into a direct cluster session).

Helpers already unset those. If you call `chm` by hand, wrap with the `chm`
function in `scripts/lib.sh` or copy that `env -u …` block.

Default dashboard API: `https://dash.chmonitor.dev` (`--base-url` /
`VERIFY_BASE_URL`). Local ClickHouse for cluster/TUI recipes: <!-- pragma: allowlist secret -->
`http://127.0.0.1:8123` (`VERIFY_CH_HOST`) when `/ping` returns 200. Never
add a host on the hosted product.

Do not use git worktrees for this skill.

## Doctor

```bash
.cursor/skills/verify-chmonitor/scripts/doctor.sh            # identity only (default)
.cursor/skills/verify-chmonitor/scripts/doctor.sh --http     # also dashboard HTTP (bounded)
.cursor/skills/verify-chmonitor/scripts/doctor.sh --cluster  # plus local CH scan
```

Run doctor before the first drive, on every fresh CLI session, and after any
failed drive. If doctor cannot see a wedged TUI, kill that tmux session and
start a new one — do not keep typing into a stuck pane.

**Identity (fail closed).** The binary on `PATH` for this run must be the
launch install: realpath matches `identity.json`, `--version` contains
`rust/ch-monitor-cli/Cargo.toml`'s `version` **and** a compile-time target
(`env!("CHM_TARGET")`), path is under `$VERIFY_PREFIX`. This is the
"is this binary ours?" check. A crates.io or `~/.local/bin` `chm` is not
ours. Default `doctor.sh` is **identity-only**: it writes `doctor-identity.json`
and `doctor-version.txt` and **does not** call dash.chmonitor.dev. Hosted
`GET /api/healthz` is cluster-gated and can hang for minutes — it is **not**
the prove. Connectivity is opt-in (`--http` / `VERIFY_DOCTOR_HTTP=1`) and
wrapped in `timeout --foreground --kill-after=1s`
(`VERIFY_DOCTOR_HTTP_TIMEOUT`, default **5s**). Never wait on that HTTP.

**Connectivity (`chm doctor` with `CLICKHOUSE_*` unset).** JSON array of <!-- pragma: allowlist secret -->
`{check, ok, detail}`:

| check | meaning |
| --- | --- |
| `cli_version` | must match crate version + target |
| `base_url` | default `https://dash.chmonitor.dev` |
| `auth_method` | discovery via `GET /api/v1/auth/cli` (cloud is `device`) |
| `credentials` | fail-open only when `method=none`; cloud device login is **not** required for CLI-local features |
| `dashboard_health` | `GET {base}/api/healthz` — **ClickHouse-gated**. Hosted cloud often returns **503** while `GET /api/health` and `GET /api/v1/hosts` are 200 | <!-- pragma: allowlist secret -->
| `hosts_api` | `GET /api/v1/hosts` |

`chm doctor` exits non-zero if any row is not ok. That does **not** mean the
wrong binary. Identity can pass while cloud `dashboard_health` / `credentials`
fail. Do not `chm auth login` unless the feature under test needs the
dashboard API as a signed-in user. Never mint hosts on dash.chmonitor.dev.

**Cluster (`chm doctor --ch-host http://127.0.0.1:8123`).** Required before
driving the live TUI or `--no-tui` snapshot against a CH HTTP interface.
`curl $VERIFY_CH_HOST/ping` must be 200. The scan is read-only (`readonly=2`).
`--json` prints `score`, `grade`, `findings`, `version`. Exit `1` only means a
critical finding, not a bad binary.

Global `--json` and `doctor --json` both select JSON (`args.json || cfg.json`).

## Drive

Harness: isolated `chm` (one-shot) or tmux (live TUI). Prefer the helper:

```bash
.cursor/skills/verify-chmonitor/scripts/drive.sh local-connections
.cursor/skills/verify-chmonitor/scripts/drive.sh tui-snapshot
.cursor/skills/verify-chmonitor/scripts/drive.sh tui-live
.cursor/skills/verify-chmonitor/scripts/drive.sh cmd -- ls --json
```

**One-shot (TTY-safe):** pass `--json` and/or `--no-tui`. `chm ls` opens a
ratatui picker when stdin+stdout are a TTY; `--json` prints the store instead.
Bare `chm` enters alt-screen unless `--no-tui` / `--json` / `CI` / `TERM=dumb`.

**Live TUI:** fresh tmux session, 120×36 (combined cockpit needs ≥72×24),
`TERM=xterm-256color`, `CI`/`CHM_NO_TUI` unset. Session name
`verify-chm-tui-$VERIFY_RUN_ID`. Wait for pane text containing `chm` and
`score` / `cockpit` / `query-count` before sending keys.

Stable handles (not coordinates):

| Surface | Handle |
| --- | --- |
| Live TUI header | `chm`, `score`, backend `CH 127.0.0.1:8123` or `API dash.chmonitor.dev` |
| Combined layout | footer `q quit  r refresh  1 charts  2 queries  3 doctor` |
| Help overlay | `?` then pane contains `chmonitor keys (ops cockpit)` / `q / Esc     quit` |
| Quit | `q` or `Esc` (Esc first clears an active `/` filter) |
| Host / local conn cycle | `h` / `l` |
| Doctor overlay | `3` |
| Snapshot JSON | `backend`, `dashboard` (`Overview`), `charts[].name` (`query-count`, …) |
| Local store JSON | `chm --json ls` → `current`, `connections[].name`, **no `password` key** |
| Add | `chm add http://127.0.0.1:8123 --name verify-local` (alias `connect`) |
| Dashboard Overview | `https://dash.chmonitor.dev/overview?host=0` |
| Sidebar heading customize | `[data-testid=group-customize-button][data-group=Queries]`, `aria-label="Customize Queries"` |

Read `features/` for the recipe. Drive the entry points the map lists for that
feature, not a convenient substitute.

Do not double-drive the operator's `~/.config/chm`. Scratch `--config` is the
isolation boundary. Two verification runs may share `$VERIFY_PREFIX` (the
binary) but must use distinct `$VERIFY_SCRATCH` / `$VERIFY_RUN_ID`.

## Evidence

Directory: **`$VERIFY_EVIDENCE`** (default
`/tmp/verify-chmonitor/evidence/$VERIFY_RUN_ID`). Cleanup never deletes it.
After cleanup, confirm the files still exist at that path.

Proof standards:

- Exercise the real `chm` binary from launch, not unit tests or internal
  setters. `cargo test -p chmonitor` is complementary, not a substitute.
- Capture the **action and the resulting state** (e.g. `add` stderr + `ls --json`).
- Side effects: `config.toml` under scratch contains `[[connections]]` and
  **no password**. Credentials, if any, live in the scratch `credentials`
  sidecar (0600) — **never copy that file into evidence**.
- `--json` / `--no-tui` snapshots are the agent-safe TUI proof. Live tmux
  `capture-pane` is required when the claim is about alt-screen keys.
- Mocks: none for CLI. Dashboard recipes may use the public demo host; do not
  stub `/api/v1/hosts`.
- Secrets: run `scripts/redact-check.sh "$VERIFY_EVIDENCE"`. Fail the proof if
  a dump contains `"password":`, `CLICKHOUSE_PASSWORD`, or `api_key =`. <!-- pragma: allowlist secret -->

Typical artifacts for the canonical drive (`local-connections`):

- `doctor-identity.json`, `doctor-version.txt` (identity-only; no connectivity JSON unless `--http`)
- `connections-add.stderr` (success line `saved connection 'verify-local'`)
- `connections-ls-after-add.json`, `connections-ls-after-use.json`, `connections-ls-after-rm.json`
- `connections-rm.stderr` (success line `removed 'verify-local'`)
- `connections-config.toml` (metadata only, after use), `connections-config-after-rm.toml`

## Cleanup

```bash
.cursor/skills/verify-chmonitor/scripts/cleanup.sh           # tmux + scratch
.cursor/skills/verify-chmonitor/scripts/cleanup.sh --purge   # also drop $VERIFY_PREFIX
```

Kills tmux sessions recorded in `$VERIFY_SCRATCH/tmux-sessions.txt` and
`verify-chm-*$VERIFY_RUN_ID*` by **session name**, never `pkill -f chm`.
Deletes `$VERIFY_SCRATCH` (config + any credentials sidecar). Does **not**
delete `$VERIFY_EVIDENCE`. Run cleanup after failed iterations too.

## Helpers

All under `.cursor/skills/verify-chmonitor/scripts/`. `chmod +x` is set in git.

| Script | Invocation |
| --- | --- |
| `lib.sh` | sourced by the others (`VERIFY_*`, `chm`, `tmux_bin`) |
| `launch.sh` | `.cursor/skills/verify-chmonitor/scripts/launch.sh` |
| `doctor.sh` | `.cursor/skills/verify-chmonitor/scripts/doctor.sh` `[--http] [--cluster]` |
| `drive.sh` | `.cursor/skills/verify-chmonitor/scripts/drive.sh` `<feature>` |
| `cleanup.sh` | `.cursor/skills/verify-chmonitor/scripts/cleanup.sh` `[--purge]` |
| `redact-check.sh` | `.cursor/skills/verify-chmonitor/scripts/redact-check.sh` `[dir]` |
| `dashboard-sidebar.mjs` | `VERIFY_DASH_URL=http://localhost:3000 node .cursor/skills/verify-chmonitor/scripts/dashboard-sidebar.mjs` (headless Chrome + `puppeteer-core` under `VERIFY_PUPPETEER_DIR`) |

Override paths with `VERIFY_PREFIX`, `VERIFY_SCRATCH`, `VERIFY_EVIDENCE`,
`VERIFY_RUN_ID`, `VERIFY_CH_HOST`, `VERIFY_BASE_URL`, `VERIFY_DASH_URL`,
`VERIFY_DASH_MULTIHOST_URL`, `VERIFY_CHROME`, `VERIFY_PUPPETEER_DIR`.

## Secondary surface (dashboard)

`apps/dashboard` (TanStack Start) and live `https://dash.chmonitor.dev`.
Local `pnpm run dev` on port 3000 is optional and not required for CLI
proofs. Feature map lists Overview, sidebar heading customize, and sidebar
navigation; those recipes must not add a host. Public demo is `?host=0`.
The sidebar navigation recipe is scripted (`scripts/dashboard-sidebar.mjs`)
and writes `sidebar-navigation.json` + screenshots into `$VERIFY_EVIDENCE`.

## Feature map

Index: [`features/README.md`](features/README.md).
