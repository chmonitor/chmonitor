# chm / chmonitor

Standalone terminal/TUI CLI for [chmonitor](https://github.com/chmonitor/chmonitor).

**Command names:** `chm` (short, preferred) and `chmonitor` (full alias). Same binary;
`cargo install chmonitor` installs both; `scripts/install.sh` installs `chm`
and symlinks `chmonitor` → `chm`.

**Default:** `chm` with no subcommand opens the live TUI (`chm tui` is the same
UI) on the Overview dashboard charts. `chm --help` / `chm help` / `chm -h`
still print help.

**Default API base:** `https://dash.chmonitor.dev` (`--base-url` / `CHM_BASE_URL`
/ `chm config set base_url` for self-hosted).

**Platforms:** prebuilt binaries for Linux/macOS × `x86_64`/`aarch64` only (no
Windows). Other targets: `cargo install chmonitor`.

## Install

```bash
# Stable (default)
curl -sSf https://chmonitor.dev/install.sh | bash

# Beta channel
CHM_CHANNEL=beta bash <(curl -sSf https://chmonitor.dev/install.sh)
```

Or from crates.io / source:

```bash
cargo install chmonitor --force
cargo build --release --manifest-path rust/ch-monitor-cli/Cargo.toml
```

## Usage

```bash
chm                  # live TUI (default)
chm --help
chm auth login
chm auth status
chm auth logout
chm config           # interactive dialog
chm config show
chm config set host_id 0
```

`chm tui` is an explicit alias of the default TUI. Dashboard API helpers
(`hosts`, `chart`, `table`, `dashboard`) and `chm doctor` / `chm update` remain
available; see `--help`.

## Auth

`chm auth login` probes public `GET /api/v1/auth/cli` and follows `method`
(`none` | `device` | `api_key`). There is **no** `auth_mode` in config — pass
`--api-key` / `CHM_API_KEY` when discovery says `api_key`, or complete the
browser device flow when it says `device`.

## Update

```bash
chm update                       # latest stable chm-v* release
chm update --check               # only report if a newer release exists (exit 1 if so)
chm update --beta                # install latest beta and save channel=beta
chm update --stable              # install latest stable and save channel=stable
chm update --version chm-v0.2.0  # pin a specific release
```

See [docs.chmonitor.dev/guide/guides/diagnostics-cli](https://docs.chmonitor.dev/guide/guides/diagnostics-cli)
for the full CLI reference.

## License

MIT
