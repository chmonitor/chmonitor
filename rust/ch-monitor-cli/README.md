# chm / chmonitor

Standalone terminal/TUI CLI for [chmonitor](https://github.com/chmonitor/chmonitor).

**Command names:** `chm` (short, preferred) and `chmonitor` (full alias). Same binary;
`cargo install chmonitor` installs both; `scripts/install.sh` installs `chm`
and symlinks `chmonitor` → `chm`.

**Default API base:** `https://dash.chmonitor.dev` (`--base-url` / `CHM_BASE_URL`
for self-hosted).

**Platforms:** prebuilt binaries for Linux/macOS × `x86_64`/`aarch64` only (no
Windows). Other targets: `cargo install chmonitor`.

Two ways to use it:

- `chm hosts` / `chm chart` / `chm table` / `chm tui` — talk to a running chmonitor dashboard's API.
- `chm diagnose` — **zero-signup** health scan that connects straight to a cluster
  HTTP interface (no chmonitor account or backend needed) and prints a
  scored, read-only report.

## Install

```bash
# Stable (default)
curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash

# Beta channel
CHM_CHANNEL=beta bash <(curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh)
```

Downloads and verifies the right prebuilt binary for your OS/arch from
[GitHub Releases](https://github.com/chmonitor/chmonitor/releases) (tag format
`chm-v*`). Stable skips prereleases; `CHM_CHANNEL=beta` prefers them.

Or from crates.io / source:

```bash
cargo install chmonitor --force
# installs both `chm` and `chmonitor` into ~/.cargo/bin

cargo build --release --manifest-path rust/ch-monitor-cli/Cargo.toml
```

## Auth

`chm auth login` probes public `GET /api/v1/auth/cli` and follows `method`
(`none` | `device` | `api_key`). There is **no** `auth_mode` in config — pass
`--api-key` / `CHM_API_KEY` when discovery says `api_key`, or complete the
browser device flow when it says `device`.

## Usage

```bash
CLICKHOUSE_HOST=http://localhost:8123 CLICKHOUSE_USER=default chm diagnose # pragma: allowlist secret
# same as: chmonitor diagnose
```

## Update

`chm update` and `chm upgrade` are the same command (`upgrade` is a first-class
alias). Both print current -> target version, download the matching GitHub
Release binary, verify sha256, and atomically replace the running executable.
They never invoke sudo: checksum, permission, and unsupported-target failures
print a copy-pasteable fallback (`scripts/install.sh` or
`cargo install chmonitor --force`).

```bash
chm upgrade                      # alias of update — latest stable chm-v* release
chm update                       # same behaviour
chm update --check               # only report if a newer release exists (exit 1 if so)
chm update --channel beta        # prefer prereleases (or CHM_CHANNEL=beta)
chm upgrade --version chm-v0.2.0 # pin a specific release (`0.2.0` / `v0.2.0` also work)
```

After a `chm diagnose` run, a one-line "update available" hint is printed to
stderr when a newer release exists (best-effort, sub-second timeout). Silence it
with `CHM_NO_UPDATE_CHECK=1`. Installed via `cargo install`? Upgrade with
`cargo install chmonitor --force` instead.

See [docs.chmonitor.dev/guide/guides/diagnostics-cli](https://docs.chmonitor.dev/guide/guides/diagnostics-cli)
for the full CLI reference.

## Anonymous telemetry

The CLI sends a best-effort, anonymous usage ping (a random install id, CLI
version, command name, and OS/arch) to `telemetry.chmonitor.dev` — a separate
stream from the dashboard's telemetry, with **no** cluster host, query text,
arguments, paths, or IPs. It runs on a background thread with a sub-second
timeout and never blocks or fails a command.

Opt out with any of `CHM_TELEMETRY=off`, `DO_NOT_TRACK=1`, or
`CHM_TELEMETRY_ENDPOINT=""`. See
[the telemetry docs](https://docs.chmonitor.dev/operate/advanced/telemetry#cli-telemetry-a-separate-stream)
and `src/telemetry.rs`.

## License

MIT
