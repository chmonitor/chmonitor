# Ops cockpit TUI

The default `chm` command (alias `chm tui`) is a live ratatui ops cockpit: health strip, Overview charts (`query-count`, `running-queries-count`, `database-count`, `table-count`, disk size), and a running-queries table. Non-TTY, CI, `--json`, and `--no-tui` print a one-shot snapshot instead of the alt-screen.

## Sub-features

- `tui-live` opens the alt-screen cockpit against a local `--ch-host` or the dashboard API.
- `tui-help` toggles the help overlay with `?`.
- `tui-quit` leaves the alt-screen with `q`.
- `tui-snapshot` prints the same Overview charts as JSON or text without entering alt-screen.
- `tui-keys` cycles hosts/connections (`h`/`l`), panes (`1`/`2`/`Tab`), doctor overlay (`3`), and refresh (`r`).

## How to get to it (user POV)

- Run `chm` with no subcommand.
- Run `chm tui`.
- Run `chm --ch-host http://127.0.0.1:8123` to talk to ClickHouse HTTP directly. <!-- pragma: allowlist secret -->
- Run `chm --no-tui` or `chm --json` (or pipe stdout, or set `CI` / `TERM=dumb`) for a snapshot.

## Driving it with chm

Preconditions:

- `scripts/launch.sh` has installed `$VERIFY_PREFIX/bin/chm`.
- `scripts/doctor.sh --cluster` passed (`http://127.0.0.1:8123/ping` is 200).
- Isolated `--config` scratch is empty or unused for this recipe.
- Parent shell may have `TERM=dumb`; the tmux session must not.

- **Snapshot JSON.** Run `.cursor/skills/verify-chmonitor/scripts/drive.sh tui-snapshot`. Exit code `0`. `$VERIFY_EVIDENCE/tui-snapshot.json` has `backend` = `clickhouse`, `dashboard` = `Overview`, and `charts` including `query-count`. <!-- pragma: allowlist secret -->
- **Live cockpit.** Run `.cursor/skills/verify-chmonitor/scripts/drive.sh tui-live`. A 120×36 tmux session starts `chm --ch-host http://127.0.0.1:8123`. Pane contains `chm` and `score` or `cockpit` before any keys.
- **Help overlay.** The live recipe sends `?`. Pane contains `chmonitor keys (ops cockpit)` or `q / Esc`. Artifact: `tui-live-help.txt`.
- **Quit.** The live recipe sends `q`. The tmux session exits (cleanup kills it if it remains).
- **Proof.** Keep `tui-snapshot.json` plus `tui-live-before-help.txt` and `tui-live-help.txt`. Snapshot is the resulting state; help capture is the action. `scripts/redact-check.sh` must pass.

## Gotchas

- `TERM=dumb`, `CI=1`, `CHM_NO_TUI=1`, `--json`, and `--no-tui` all skip alt-screen. A Cloud agent shell is usually `TERM=dumb` — live TUI **must** be tmux with `TERM=xterm-256color`.
- A leftover `CLICKHOUSE_HOST` env var hijacks bare `chm` onto that host. Helpers unset it and pass `--ch-host` explicitly. <!-- pragma: allowlist secret -->
- Combined cockpit layout needs ≥72×24. Smaller panes show `tab pane` instead of `1 charts  2 queries`.
- `Esc` clears an active `/` filter before it quits. Send `q` to quit.
- Postgres connections list in `chm ls` but PG TUI panes are not in this slice (`Postgres TUI is not in this slice` banner). Do not treat that banner as a TUI failure for a CH host.
- Dashboard-API TUI without login shows `Dashboard needs login — run chm auth login`. That is not a local `--ch-host` failure. Do not add a host on dash.chmonitor.dev to work around it.
