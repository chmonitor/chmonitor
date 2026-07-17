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

See [docs.chmonitor.dev/guide/guides/diagnostics-cli](https://docs.chmonitor.dev/guide/guides/diagnostics-cli)
for the full CLI reference.

## License

MIT
