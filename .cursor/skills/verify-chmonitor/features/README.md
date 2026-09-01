# chmonitor verification map

This directory is the maintained source for verifying user-facing behavior of
chmonitor. Read the index before driving, then use the matching feature file.

Primary surface: **`chm` / `chmonitor`** (Rust CLI/TUI in `rust/ch-monitor-cli`).
Secondary: the dashboard at `apps/dashboard` / `https://dash.chmonitor.dev`.

## Baseline preconditions

- Run `.cursor/skills/verify-chmonitor/scripts/launch.sh` so `$VERIFY_PREFIX/bin/chm` is this checkout.
- Use `--config $VERIFY_SCRATCH/config.toml` (helpers do this). Never the operator's `~/.config/chm`.
- Unset `CLICKHOUSE_*`, `CHM_API_KEY`, `CHM_TOKEN`, `CI`, `GITHUB_ACTIONS`, `CHM_NO_TUI` unless a recipe passes `--ch-host` explicitly. <!-- pragma: allowlist secret -->
- `scripts/doctor.sh` must accept identity before any drive.
- For TUI / cluster-doctor recipes: `http://127.0.0.1:8123/ping` returns 200, then `scripts/doctor.sh --cluster`.
- Do not add a host on `dash.chmonitor.dev`.
- Do not use git worktrees.
- Put `scripts/` on the mental PATH; invoke them from the repo root as `.cursor/skills/verify-chmonitor/scripts/<name>.sh`.

## Driving conventions

- Start every recipe from a fresh `$VERIFY_SCRATCH` unless its preconditions say otherwise.
- Live TUI: tmux session, 120×36, `TERM=xterm-256color`. One-shot: `--json` / `--no-tui`.
- Treat commands as literal. Keep `--name verify-local` and `--ch-host http://127.0.0.1:8123` unchanged unless the feature file says otherwise.
- Restore scratch with `scripts/cleanup.sh`. Proof artifacts stay in `$VERIFY_EVIDENCE`.
- Never copy a `credentials` sidecar into evidence.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- CLI JSON proof: command, stdout, stderr, exit code.
- Live TUI proof: `tmux capture-pane` before and after the key.
- Mutation proof: a second read (`chm --json ls`, or reopen the TUI snapshot).
- Record the feature ID and entry point with every artifact.
- An unreachable path is `verified-unreachable` only with the attempted command and the unmet precondition (auth, no local CH, hosted healthz 503). Do not report it verified via a different path.

## Feature entry contract

Each feature file starts with an H1 and one paragraph. It then uses exactly four H2 sections in this order.

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with chm` (dashboard files: `Driving it with the dashboard`)
4. `Gotchas`

## Features

- [Ops cockpit TUI](./tui-ops-cockpit.md) — default `chm` live UI and `--no-tui` / `--json` snapshot.
- [Doctor](./doctor.md) — binary identity, dashboard connectivity, optional `--ch-host` cluster scan.
- [Local named connections](./local-connections.md) — `chm add` / `ls` / `use` / `rm` (no dashboard).
- [Dashboard Overview](./dashboard-overview.md) — secondary web surface; public demo, no add-host.
- [Sidebar heading customize](./sidebar-heading-customize.md) — secondary; group `+` dialog on dashboard sidebar.
