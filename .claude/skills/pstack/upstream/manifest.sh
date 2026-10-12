#!/usr/bin/env bash
# Print the content manifest SHA-256 of a pstack skills tree.
#
#   manifest.sh [DIR]   hash DIR (default: skills/ next to this script)
#   manifest.sh --check compare the vendored tree with SOURCE.md
#
# Recipe: from inside DIR, list regular files as `./<path>`, sort the paths
# bytewise (LC_ALL=C, NUL-separated), sha256 each file in that order, then
# sha256 the resulting `<hash>  ./<path>` lines. Pass an extracted upstream
# `plugins/pstack/skills` to hash the release the same way.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"

if command -v sha256sum >/dev/null 2>&1; then
  sha256=(sha256sum)
else
  sha256=(shasum -a 256) # macOS
fi

manifest_hash() {
  (
    cd "$1"
    find . -type f -print0 | LC_ALL=C sort -z | xargs -0 "${sha256[@]}"
  ) | "${sha256[@]}" | cut -d' ' -f1
}

if [ "${1:-}" = "--check" ]; then
  expected="$(sed -n 's/^- Upstream skills content manifest SHA-256: `\([0-9a-f]\{64\}\)`$/\1/p' "$here/SOURCE.md")"
  if [ -z "$expected" ]; then
    echo "manifest.sh: no manifest hash found in SOURCE.md" >&2
    exit 2
  fi
  actual="$(manifest_hash "$here/skills")"
  if [ "$actual" != "$expected" ]; then
    echo "manifest.sh: mismatch: SOURCE.md=$expected actual=$actual" >&2
    exit 1
  fi
  echo "ok $actual"
  exit 0
fi

manifest_hash "${1:-$here/skills}"
