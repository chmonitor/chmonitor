#!/usr/bin/env bash
# Scan evidence files for leaked secrets. Exit 1 if a dump looks unsafe.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

dir="${1:-$VERIFY_EVIDENCE}"
if [[ ! -d "$dir" ]]; then
  echo "verify-chmonitor redact-check: not a directory: $dir" >&2
  exit 1
fi

fail=0
while IFS= read -r -d '' file; do
  if ! redact_check_file "$file"; then
    fail=1
  fi
done < <(find "$dir" -type f -print0)

if [[ "$fail" -ne 0 ]]; then
  echo "verify-chmonitor redact-check: failed" >&2
  exit 1
fi
echo "verify-chmonitor redact-check: ok  $dir"
