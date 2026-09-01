#!/usr/bin/env bash
# Drive one mapped feature through the isolated chm install.
#
#   scripts/drive.sh local-connections
#   scripts/drive.sh tui-snapshot
#   scripts/drive.sh tui-live
#   scripts/drive.sh cmd -- <chm args...>
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \?//'
  exit 2
}

feature="${1:-}"
if [[ -z "$feature" ]]; then
  usage
fi
shift || true

ensure_dirs
if [[ ! -x "$CHM_BIN" ]]; then
  echo "verify-chmonitor drive: run scripts/launch.sh first" >&2
  exit 1
fi

drive_local_connections() {
  local name="verify-local"
  chm --no-tui add "$VERIFY_CH_HOST" --name "$name" \
    >"$VERIFY_EVIDENCE/connections-add.stdout" \
    2>"$VERIFY_EVIDENCE/connections-add.stderr"
  chm --json ls >"$VERIFY_EVIDENCE/connections-ls-after-add.json"
  chm --no-tui use "$name" \
    >"$VERIFY_EVIDENCE/connections-use.stdout" \
    2>"$VERIFY_EVIDENCE/connections-use.stderr"
  chm --json ls >"$VERIFY_EVIDENCE/connections-ls-after-use.json"

  python3 - "$VERIFY_EVIDENCE" "$name" "$VERIFY_CH_HOST" "$CONFIG_PATH" <<'PY'
import json, os, sys, urllib.parse
evidence, name, url, config_path = sys.argv[1:]
host = urllib.parse.urlparse(url).hostname or "127.0.0.1"
port = urllib.parse.urlparse(url).port or 8123
after_add = json.load(open(os.path.join(evidence, "connections-ls-after-add.json")))
after_use = json.load(open(os.path.join(evidence, "connections-ls-after-use.json")))
conns = after_add.get("connections") or []
match = next((c for c in conns if c.get("name") == name), None)
assert match, after_add
assert match.get("engine") == "clickhouse", match  # pragma: allowlist secret
assert match.get("host") == f"{host}:{port}", match
assert "password" not in json.dumps(after_add)
assert after_use.get("current") == name, after_use
toml = open(config_path, encoding="utf-8").read()
assert name in toml, toml
assert "password" not in toml.lower(), toml
print(f"ok    local-connections    name={name} current={after_use.get('current')} host={match.get('host')}")
PY
  # Config is metadata-only (no passwords). Snapshot after use, before rm.
  cp "$CONFIG_PATH" "$VERIFY_EVIDENCE/connections-config.toml"

  chm --no-tui rm "$name" \
    >"$VERIFY_EVIDENCE/connections-rm.stdout" \
    2>"$VERIFY_EVIDENCE/connections-rm.stderr"
  grep -q "removed '$name'" "$VERIFY_EVIDENCE/connections-rm.stderr" \
    || grep -q "removed '$name'" "$VERIFY_EVIDENCE/connections-rm.stdout"
  chm --json ls >"$VERIFY_EVIDENCE/connections-ls-after-rm.json"
  cp "$CONFIG_PATH" "$VERIFY_EVIDENCE/connections-config-after-rm.toml"

  python3 - "$VERIFY_EVIDENCE" "$name" <<'PY'
import json, os, sys
evidence, name = sys.argv[1:]
after_rm = json.load(open(os.path.join(evidence, "connections-ls-after-rm.json")))
conns = after_rm.get("connections") or []
assert all(c.get("name") != name for c in conns), after_rm
assert after_rm.get("current") != name, after_rm
assert "password" not in json.dumps(after_rm)
toml = open(os.path.join(evidence, "connections-config-after-rm.toml"), encoding="utf-8").read()
assert name not in toml, toml
print(f"ok    local-connections-rm name={name} gone")
PY

  redact_check_file "$VERIFY_EVIDENCE/connections-ls-after-add.json"
  redact_check_file "$VERIFY_EVIDENCE/connections-ls-after-use.json"
  redact_check_file "$VERIFY_EVIDENCE/connections-ls-after-rm.json"
  redact_check_file "$VERIFY_EVIDENCE/connections-config.toml"
  redact_check_file "$VERIFY_EVIDENCE/connections-config-after-rm.toml"
  redact_check_file "$VERIFY_EVIDENCE/connections-add.stdout"
  redact_check_file "$VERIFY_EVIDENCE/connections-add.stderr"
  redact_check_file "$VERIFY_EVIDENCE/connections-use.stdout"
  redact_check_file "$VERIFY_EVIDENCE/connections-use.stderr"
  redact_check_file "$VERIFY_EVIDENCE/connections-rm.stdout"
  redact_check_file "$VERIFY_EVIDENCE/connections-rm.stderr"
}

drive_tui_snapshot() {
  chm --no-tui --json --ch-host "$VERIFY_CH_HOST" \
    >"$VERIFY_EVIDENCE/tui-snapshot.json" \
    2>"$VERIFY_EVIDENCE/tui-snapshot.stderr"
  python3 - "$VERIFY_EVIDENCE/tui-snapshot.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1]))
backend = data.get("backend")
dashboard = data.get("dashboard")
charts = data.get("charts") or []
names = [c.get("name") for c in charts]
assert backend == "clickhouse", data  # pragma: allowlist secret
assert dashboard == "Overview", data
assert "query-count" in names, names
print(f"ok    tui-snapshot         backend={backend} dashboard={dashboard} charts={names}")
PY
  redact_check_file "$VERIFY_EVIDENCE/tui-snapshot.json"
}

drive_tui_live() {
  local session="verify-chm-tui-${VERIFY_RUN_ID}"
  record_session "$session"
  tmux_bin has-session -t "=$session" 2>/dev/null && tmux_bin kill-session -t "$session"

  tmux_bin new-session -d -s "$session" -x 120 -y 36 -- \
    env -u CI -u GITHUB_ACTIONS -u CHM_NO_TUI -u CHM_API_KEY -u CHM_TOKEN -u CLICKHOUSE_HOST -u CLICKHOUSE_USER -u CLICKHOUSE_PASSWORD -u CLICKHOUSE_DATABASE PATH="$VERIFY_PREFIX/bin:$PATH" TERM=xterm-256color "$CHM_BIN" --config "$CONFIG_PATH" --ch-host "$VERIFY_CH_HOST" # pragma: allowlist secret

  # Wait for the ops-cockpit header (not a fixed sleep).
  python3 - "$session" <<'PY'
import subprocess, sys, time
session = sys.argv[1]
conf = ["/exec-daemon/tmux.portal.conf"]
tmux = ["tmux", "-f", conf[0]] if __import__("os").path.isfile(conf[0]) else ["tmux"]
deadline = time.time() + 20
last = ""
while time.time() < deadline:
    last = subprocess.check_output(tmux + ["capture-pane", "-pt", session], text=True, errors="replace")
    if "chm" in last and ("cockpit" in last or "score" in last or "Overview" in last or "query-count" in last):
        break
    time.sleep(0.25)
else:
    sys.stderr.write(last)
    sys.exit(1)
open("/dev/stdout", "w").write("ok    tui-live-ready\n")
PY

  tmux_bin capture-pane -pt "$session" >"$VERIFY_EVIDENCE/tui-live-before-help.txt"
  tmux_bin send-keys -t "$session:0.0" "?"
  python3 - "$session" <<'PY'
import os, subprocess, sys, time
session = sys.argv[1]
tmux = ["tmux", "-f", "/exec-daemon/tmux.portal.conf"] if os.path.isfile("/exec-daemon/tmux.portal.conf") else ["tmux"]
deadline = time.time() + 8
last = ""
while time.time() < deadline:
    last = subprocess.check_output(tmux + ["capture-pane", "-pt", session], text=True, errors="replace")
    if "chmonitor keys" in last or "ops cockpit" in last or "q / Esc" in last:
        break
    time.sleep(0.2)
else:
    sys.stderr.write(last)
    sys.exit(1)
PY
  tmux_bin capture-pane -pt "$session" >"$VERIFY_EVIDENCE/tui-live-help.txt"
  tmux_bin send-keys -t "$session:0.0" "q"
  sleep 0.4
  if tmux_bin has-session -t "=$session" 2>/dev/null; then
    tmux_bin kill-session -t "$session"
  fi
  grep -E -q 'chmonitor keys|ops cockpit|q / Esc' "$VERIFY_EVIDENCE/tui-live-help.txt"
  echo "ok    tui-live             help overlay captured"
  redact_check_file "$VERIFY_EVIDENCE/tui-live-help.txt"
}

drive_cmd() {
  if [[ "${1:-}" == "--" ]]; then
    shift
  fi
  chm "$@" | tee "$VERIFY_EVIDENCE/cmd.stdout"
}

case "$feature" in
  local-connections) drive_local_connections ;;
  tui-snapshot) drive_tui_snapshot ;;
  tui-live) drive_tui_live ;;
  cmd) drive_cmd "$@" ;;
  -h|--help) usage ;;
  *)
    echo "verify-chmonitor drive: unknown feature '$feature'" >&2
    usage
    ;;
esac

echo "verify-chmonitor drive: evidence in $VERIFY_EVIDENCE"
