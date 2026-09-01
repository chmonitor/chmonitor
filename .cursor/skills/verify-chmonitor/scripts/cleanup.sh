#!/usr/bin/env bash
# Tear down tmux sessions and scratch state this run created.
# Never deletes $VERIFY_EVIDENCE. Pass --purge to also remove $VERIFY_PREFIX.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

PURGE=0
if [[ "${1:-}" == "--purge" ]]; then
  PURGE=1
fi

if [[ -f "$SESSION_LIST" ]]; then
  while IFS= read -r session; do
    [[ -z "$session" ]] && continue
    if tmux_bin has-session -t "=$session" 2>/dev/null; then
      tmux_bin kill-session -t "$session"
      echo "verify-chmonitor cleanup: killed tmux session $session"
    fi
  done <"$SESSION_LIST"
fi

# Also reap leftover verify-chm-* sessions started with this RUN_ID.
while IFS= read -r session; do
  [[ -z "$session" ]] && continue
  case "$session" in
    verify-chm-*"${VERIFY_RUN_ID}"*)
      tmux_bin kill-session -t "$session" 2>/dev/null || true
      ;;
  esac
done < <(tmux_bin ls -F '#{session_name}' 2>/dev/null || true)

if [[ -d "$VERIFY_SCRATCH" ]]; then
  rm -rf "$VERIFY_SCRATCH"
  echo "verify-chmonitor cleanup: removed scratch $VERIFY_SCRATCH"
fi

if [[ "$PURGE" -eq 1 && -d "$VERIFY_PREFIX" ]]; then
  rm -rf "$VERIFY_PREFIX"
  echo "verify-chmonitor cleanup: purged prefix $VERIFY_PREFIX"
fi

if [[ -d "$VERIFY_EVIDENCE" ]]; then
  echo "verify-chmonitor cleanup: evidence kept at $VERIFY_EVIDENCE"
else
  echo "verify-chmonitor cleanup: WARNING evidence dir missing: $VERIFY_EVIDENCE" >&2
fi
