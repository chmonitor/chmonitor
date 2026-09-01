# Local named connections

`chm add` (alias `connect`), `chm ls`, `chm use`, and `chm rm` save named ClickHouse HTTP or Postgres URLs in the user config file. Add is local and does no dashboard network. Passwords go to the credentials helper, never to `ls` / JSON / `config.toml`. This is distinct from `chm hosts` (dashboard `/api/v1/hosts`). <!-- pragma: allowlist secret -->

## Sub-features

- `conn-add` saves a URL (`http://127.0.0.1:8123` or `--ch-host` style `host:8123`) with optional `--name`.
- `conn-ls` lists name, engine, host, and a `*` current marker (`--json` for agents).
- `conn-use` sets `current_connection`.
- `conn-rm` removes a name and its stored password.
- `conn-secrets` keeps passwords out of `ls`, JSON, and `config.toml`.

## How to get to it (user POV)

- Run `chm add http://127.0.0.1:8123`.
- Run `chm add http://127.0.0.1:8123 --name verify-local`.
- Run `chm connect …` (alias of `add`).
- Run `chm ls` (TTY opens a picker; `--json` / `--no-tui` prints the list).
- Run `chm use verify-local`.
- Run `chm rm verify-local`.

## Driving it with chm

Preconditions:

- `scripts/launch.sh` succeeded.
- `scripts/doctor.sh` accepted identity.
- Fresh `$VERIFY_SCRATCH` so `--config` does not reuse the operator's store.
- `CLICKHOUSE_PASSWORD` unset (otherwise `add` stores the env password). <!-- pragma: allowlist secret -->
- Local CH is **not** required for add/ls/use/rm (no network). Ping is only needed if a later TUI drive uses the saved connection.

- **Add.** Run `.cursor/skills/verify-chmonitor/scripts/drive.sh local-connections`. That runs `chm --no-tui add http://127.0.0.1:8123 --name verify-local`. Stderr contains `saved connection 'verify-local'` (or `updated`). Exit 0.
- **List after add.** `chm --json ls` writes `connections-ls-after-add.json`. `connections` has `name` = `verify-local`, `engine` = `clickhouse`, `host` = `127.0.0.1:8123`. JSON has **no** `password` key. Text `ls` would show `* verify-local` when it is current. <!-- pragma: allowlist secret -->
- **Use.** `chm --no-tui use verify-local` then `chm --json ls`. `current` is `verify-local`.
- **Config side effect.** Scratch `config.toml` contains `current_connection` and a `[[connections]]` table with `name = "verify-local"`. File contains no `password` key. Snapshot as `connections-config.toml` **before** rm. Do not copy any `credentials` sidecar into `$VERIFY_EVIDENCE`.
- **Rm.** `chm --no-tui rm verify-local`. Stderr contains `removed 'verify-local'`. `chm --json ls` writes `connections-ls-after-rm.json` with that name gone. `connections-config-after-rm.toml` must not contain `verify-local`.
- **Proof.** Keep add/use/rm stderr, the three ls JSON files, and both config snapshots. Run `scripts/redact-check.sh "$VERIFY_EVIDENCE"`. Cleanup deletes scratch (including any credentials file) and must leave these artifacts in `$VERIFY_EVIDENCE`.

## Gotchas

- TTY `chm ls` is a picker (`j/k`, Enter uses, q quits), not a printout. Always `--json` in agent drives.
- `--config` pointing at a dir other than `~/.config/chm` disables keyring (`use_keyring` is false). That is required for isolation. Setting `XDG_CONFIG_HOME` to the scratch parent **re-enables** keyring — do not do that.
- Env `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` fill host-style URLs via `--ch-user` defaults. Unset them for this recipe. <!-- pragma: allowlist secret -->
- First add becomes current automatically; a second add does not switch current until `chm use`.
- `chm hosts` is the dashboard API and will not show `verify-local`. Do not use it as proof of add.
- Postgres URLs parse and list; do not require TUI panes for this feature.
- Never evidence-dump `~/.config/chm/credentials` or the scratch credentials file.
