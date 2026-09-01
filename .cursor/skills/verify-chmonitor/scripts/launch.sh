#!/usr/bin/env bash
# Build chm / chmonitor from this checkout and install into $VERIFY_PREFIX.
# Ready: identity.json exists and `$VERIFY_PREFIX/bin/chm --version` prints
# "<crate version> (<target>)".
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

need_rustc() {
  if ! command -v rustc >/dev/null || ! command -v cargo >/dev/null; then
    echo "verify-chmonitor launch: rustc/cargo missing. Install stable Rust (>= 1.85, edition 2024)." >&2
    echo "  rustup toolchain install stable && rustup default stable" >&2
    exit 1
  fi
  local minor
  minor="$(rustc --version | awk '{ print $2 }' | awk -F. '{ print $2 }')"
  if [[ "${minor:-0}" -lt 85 ]]; then
    echo "verify-chmonitor launch: rustc $(rustc --version) is too old (need >= 1.85 for edition 2024 crates)." >&2
    echo "  rustup toolchain install stable && rustup default stable" >&2
    exit 1
  fi
}

need_rustc
ensure_dirs

if [[ ! -f "$CHM_MANIFEST" ]]; then
  echo "verify-chmonitor launch: missing $CHM_MANIFEST" >&2
  exit 1
fi

echo "verify-chmonitor launch: cargo build -p chmonitor (debug) from $REPO_ROOT"
cargo build -p chmonitor --manifest-path "$CHM_MANIFEST"

debug_bin="$REPO_ROOT/rust/target/debug/chm"
debug_alias="$REPO_ROOT/rust/target/debug/chmonitor"
if [[ ! -x "$debug_bin" ]]; then
  echo "verify-chmonitor launch: expected $debug_bin after cargo build" >&2
  exit 1
fi

install -m 0755 "$debug_bin" "$CHM_BIN"
install -m 0755 "$debug_alias" "$CHM_ALIAS"

version="$("$CHM_BIN" --version)"
crate="$(crate_version)"
target="$(printf '%s\n' "$version" | sed -n 's/.*(\([^)]*\)).*/\1/p')"
git_head="$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo unknown)"

if [[ "$version" != *"$crate"* ]]; then
  echo "verify-chmonitor launch: version mismatch: binary='$version' crate='$crate'" >&2
  exit 1
fi
if [[ -z "$target" || "$target" == "unknown" ]]; then
  echo "verify-chmonitor launch: binary version missing CHM_TARGET: $version" >&2
  exit 1
fi

python3 - "$IDENTITY_FILE" "$CHM_BIN" "$crate" "$target" "$version" "$git_head" "$REPO_ROOT" <<'PY'
import json, os, sys
path, bin_path, crate, target, version, git_head, repo = sys.argv[1:]
payload = {
    "bin": os.path.realpath(bin_path),
    "alias": os.path.realpath(os.path.join(os.path.dirname(bin_path), "chmonitor")),
    "crate_version": crate,
    "target": target,
    "version_line": version,
    "git_head": git_head,
    "repo_root": repo,
    "profile": "debug",
}
with open(path, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)
    f.write("\n")
print(json.dumps(payload, indent=2))
PY

echo "verify-chmonitor launch: ready  bin=$CHM_BIN  $version"
