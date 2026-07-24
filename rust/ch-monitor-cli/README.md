# ch-monitor-cli

Standalone terminal/TUI CLI (`chm`) for [chmonitor](https://github.com/chmonitor/chmonitor).

Two ways to use it:

- `chm hosts` / `chm chart` / `chm table` / `chm tui` — talk to a running chmonitor dashboard's API.
- `chm diagnose` — **zero-signup** health scan that connects straight to a ClickHouse
  host's HTTP interface (no chmonitor account or backend needed) and prints a
  scored, read-only report.

## Install

```bash
curl -sSf https://raw.githubusercontent.com/chmonitor/chmonitor/main/scripts/install.sh | bash
```

Downloads and verifies the right prebuilt binary for your OS/arch from
[GitHub Releases](https://github.com/chmonitor/chmonitor/releases) (tag format `chm-v*`).

Or build from source:

```bash
cargo build --release --manifest-path rust/ch-monitor-cli/Cargo.toml
```

## Usage

```bash
CLICKHOUSE_HOST=http://localhost:8123 CLICKHOUSE_USER=default chm diagnose
```

## Update

`chm` self-updates from GitHub Releases (downloads the matching binary, verifies
its sha256, and atomically replaces itself — no sudo):

```bash
chm update                       # install the latest chm-v* release
chm update --check               # only report if a newer release exists (exit 1 if so)
chm update --version chm-v0.2.0  # pin a specific release
```

After a `chm diagnose` run, a one-line "update available" hint is printed to
stderr when a newer release exists (best-effort, sub-second timeout). Silence it
with `CHM_NO_UPDATE_CHECK=1`. Installed via `cargo install`? Upgrade with
`cargo install ch-monitor-cli` instead.

See [docs.chmonitor.dev/guide/guides/diagnostics-cli](https://docs.chmonitor.dev/guide/guides/diagnostics-cli)
for the full CLI reference.

## Anonymous telemetry

The CLI sends a best-effort, anonymous usage ping (a random install id, CLI
version, command name, and OS/arch) to `telemetry.chmonitor.dev` — a separate
stream from the dashboard's telemetry, with **no** ClickHouse host, query text,
arguments, paths, or IPs. It runs on a background thread with a sub-second
timeout and never blocks or fails a command.

Opt out with any of `CHM_TELEMETRY=off`, `DO_NOT_TRACK=1`, or
`CHM_TELEMETRY_ENDPOINT=""`. See
[the telemetry docs](https://docs.chmonitor.dev/operate/advanced/telemetry#cli-telemetry-a-separate-stream)
and `src/telemetry.rs`.

## License

MIT
