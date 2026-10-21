#!/usr/bin/env bash
# Read-only: runs `pnpm audit` against every tracked pnpm-lock.yaml and prints
# the advisory count by severity plus the packages with a fix available.
# Dependabot reports a stale lockfile only as `security_update_not_possible`;
# this shows what is actually vulnerable. See docs/knowledge/lockfile-security.md.
#
#   scripts/audit-lockfiles.sh            # every lockfile
#   scripts/audit-lockfiles.sh apps/blog  # one directory
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ "$#" -gt 0 ]; then
  DIRS=("$@")
else
  mapfile -t DIRS < <(git ls-files '*pnpm-lock.yaml' | xargs -n1 dirname)
fi

for d in "${DIRS[@]}"; do
  work="$TMP/$(echo "$d" | tr / _)"
  mkdir -p "$work"
  cp "$d/pnpm-lock.yaml" "$d/package.json" "$work/"
  # Outside the repo tree the root `packageManager` pin does not apply, and an
  # audit only reads the lockfile.
  (cd "$work" && pnpm audit --json >audit.json 2>/dev/null || true)
  python3 - "$d" "$work/audit.json" <<'PY'
import json, sys
d, path = sys.argv[1], sys.argv[2]
try:
    advisories = json.load(open(path)).get("advisories", {})
except Exception as e:
    print(f"{d}: audit failed ({e})")
    sys.exit(0)
sev = {}
for a in advisories.values():
    sev[a["severity"]] = sev.get(a["severity"], 0) + 1
fixable = sorted({a["module_name"] for a in advisories.values()
                  if a.get("patched_versions") not in (None, "<0.0.0")})
print(f"{d}: {len(advisories)} advisories {sev}" + (f"; fixable: {', '.join(fixable)}" if fixable else ""))
PY
done
