#!/usr/bin/env bash
# Shared paths and isolated env for verify-chmonitor helpers.
# Source from other scripts in this directory. Do not execute directly.

set -euo pipefail

: "${VERIFY_RUN_ID:=$(date +%Y%m%dT%H%M%S)-$$}"
: "${VERIFY_ROOT:=/tmp/verify-chmonitor}"
: "${VERIFY_PREFIX:=$VERIFY_ROOT/prefix}"
: "${VERIFY_SCRATCH:=$VERIFY_ROOT/scratch-$VERIFY_RUN_ID}"
: "${VERIFY_EVIDENCE:=$VERIFY_ROOT/evidence/$VERIFY_RUN_ID}"
: "${VERIFY_CH_HOST:=http://127.0.0.1:8123}"
: "${VERIFY_BASE_URL:=https://dash.chmonitor.dev}"

SKILL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_ROOT/../../.." && pwd)"
CHM_MANIFEST="$REPO_ROOT/rust/Cargo.toml"
CHM_CRATE="$REPO_ROOT/rust/ch-monitor-cli/Cargo.toml"
CHM_BIN="$VERIFY_PREFIX/bin/chm"
CHM_ALIAS="$VERIFY_PREFIX/bin/chmonitor"
IDENTITY_FILE="$VERIFY_PREFIX/identity.json"
SESSION_LIST="$VERIFY_SCRATCH/tmux-sessions.txt"
CONFIG_PATH="$VERIFY_SCRATCH/config.toml"

crate_version() {
  awk -F'"' '/^version = / { print $2; exit }' "$CHM_CRATE"
}

tmux_bin() {
  if [[ -f /exec-daemon/tmux.portal.conf ]]; then
    tmux -f /exec-daemon/tmux.portal.conf "$@"
  else
    tmux "$@"
  fi
}

ensure_dirs() {
  mkdir -p "$VERIFY_PREFIX/bin" "$VERIFY_SCRATCH" "$VERIFY_EVIDENCE"
}

# Isolated CLI env: disposable --config, no user ~/.config/chm, no env CH secrets.
# Live TUI needs a real TERM and must not inherit CI / CHM_NO_TUI / TERM=dumb.
chm_env() {
  # Drop Cloud-image cluster env so add/doctor/TUI do not inherit it. pragma: allowlist secret
  env -u CI -u GITHUB_ACTIONS -u CHM_NO_TUI -u CHM_CONFIG -u CHM_API_KEY -u CHM_TOKEN -u CLICKHOUSE_HOST -u CLICKHOUSE_USER -u CLICKHOUSE_PASSWORD -u CLICKHOUSE_DATABASE PATH="$VERIFY_PREFIX/bin:$PATH" TERM="${VERIFY_TERM:-xterm-256color}" DO_NOT_TRACK=1 CHM_TELEMETRY=off "$@" # pragma: allowlist secret
}

chm() {
  if [[ ! -x "$CHM_BIN" ]]; then
    echo "verify-chmonitor: $CHM_BIN missing — run scripts/launch.sh first" >&2
    return 127
  fi
  chm_env "$CHM_BIN" --config "$CONFIG_PATH" --base-url "$VERIFY_BASE_URL" "$@"
}

record_session() {
  mkdir -p "$(dirname "$SESSION_LIST")"
  printf '%s\n' "$1" >>"$SESSION_LIST"
}

# Fail if a file looks like it captured secrets. Used on evidence, never on
# the scratch credentials sidecar (that file is deleted in cleanup).
redact_check_file() {
  local file="$1"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  if grep -Eiq 'CLICKHOUSE_PASSWORD|api_key[[:space:]]*=' "$file"; then  # pragma: allowlist secret
    echo "verify-chmonitor: evidence $file looks like it contains secrets" >&2
    return 1
  fi
  if grep -Eq '"password"[[:space:]]*:' "$file"; then
    echo "verify-chmonitor: evidence $file contains a JSON password field" >&2
    return 1
  fi
}
