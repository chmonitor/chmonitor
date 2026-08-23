#!/usr/bin/env bash
# Build only the chm CLI crate and write a markdown report (size / time / startup).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/rust"

BIN_DIR="${CARGO_TARGET_DIR:-$ROOT/rust/target}/release"
REPORT="${CLI_REPORT_PATH:-$ROOT/cli-report.md}"
mkdir -p "$(dirname "$BIN_DIR")"

version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' ch-monitor-cli/Cargo.toml | head -n1)"
rustc_v="$(rustc --version)"
cargo_v="$(cargo --version)"
host="$(uname -m)-$(uname -s)"

start_ns="$(date +%s%N)"
cargo build --release -p chmonitor
end_ns="$(date +%s%N)"
build_s="$(awk -v s="$start_ns" -v e="$end_ns" 'BEGIN { printf "%.2f", (e-s)/1000000000 }')"

chm="$BIN_DIR/chm"
if [[ ! -x "$chm" ]]; then
  echo "missing release binary $chm" >&2
  exit 1
fi

bytes="$(stat -c '%s' "$chm" 2>/dev/null || stat -f '%z' "$chm")"
kib="$(awk -v b="$bytes" 'BEGIN { printf "%.1f", b/1024 }')"
mib="$(awk -v b="$bytes" 'BEGIN { printf "%.2f", b/1024/1024 }')"
file_out="$(file -b "$chm" | tr '\n' ' ')"
chm_ver="$("$chm" --version | head -n1)"

start_ns="$(date +%s%N)"
cargo test --release -p chmonitor -- --test-threads=4
end_ns="$(date +%s%N)"
test_s="$(awk -v s="$start_ns" -v e="$end_ns" 'BEGIN { printf "%.2f", (e-s)/1000000000 }')"

bench="$(python3 - "$chm" <<'PY'
import json, statistics, subprocess, sys, time
chm = sys.argv[1]

def run(args, n=25):
    times = []
    for _ in range(n):
        t = time.perf_counter()
        subprocess.run([chm, *args], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        times.append((time.perf_counter() - t) * 1000)
    times.sort()
    return {
        "n": n,
        "min": round(times[0], 2),
        "p50": round(statistics.median(times), 2),
        "p95": round(times[int(0.95 * (n - 1))], 2),
    }

print(json.dumps({"version": run(["--version"]), "help": run(["--help"])}))
PY
)"
ver_p50="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["version"]["p50"])' "$bench")"
ver_p95="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["version"]["p95"])' "$bench")"
help_p50="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["help"]["p50"])' "$bench")"
help_p95="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["help"]["p95"])' "$bench")"

prev_line="_No previous stable linux-gnu asset found._"
if command -v gh >/dev/null 2>&1; then
  prev="$(gh api "repos/${GITHUB_REPOSITORY:-chmonitor/chmonitor}/releases" --paginate \
    --jq '[.[] | select(.tag_name|test("^chm-v[0-9]+\\.[0-9]+\\.[0-9]+$")) | {tag:.tag_name, size:(.assets[] | select(.name=="chm-x86_64-unknown-linux-gnu") | .size)}] | .[0]' \
    2>/dev/null || true)"
  if [[ -n "${prev:-}" && "$prev" != "null" ]]; then
    prev_tag="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("tag") or "")' "$prev")"
    prev_size="$(python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get("size"); print(v if v is not None else "")' "$prev")"
    if [[ -n "$prev_tag" && -n "$prev_size" ]]; then
      delta=$((bytes - prev_size))
      sign="+"
      if [[ "$delta" -lt 0 ]]; then sign=""; fi
      prev_line="vs \`${prev_tag}\` linux-gnu **${prev_size} B** → **${sign}${delta} B**"
    fi
  fi
fi

sha="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"
short="${sha:0:12}"
ref="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-local}}"

cat > "$REPORT" <<EOF
<!-- cli-build-report -->
## CLI build report (\`chm\` ${version})

_Always rebuilt on each push. This comment is updated in place (latest only)._

| | |
|---|---|
| Ref | \`${ref}\` @ \`${short}\` |
| Host | \`${host}\` |
| Toolchain | \`${rustc_v}\` / \`${cargo_v}\` |
| Command | \`cargo build --release -p chmonitor\` (CLI crate only) |
| Build wall | **${build_s} s** |
| Tests | \`cargo test --release -p chmonitor\` **${test_s} s** |
| Binary | **${bytes} B** (${kib} KiB / ${mib} MiB) |
| File | ${file_out} |
| \`chm --version\` | \`${chm_ver}\` |
| Startup \`--version\` | p50 **${ver_p50} ms** · p95 ${ver_p95} ms (n=25) |
| Startup \`--help\` | p50 **${help_p50} ms** · p95 ${help_p95} ms (n=25) |
| Size delta | ${prev_line} |

Network snapshot (\`chm --no-tui\`) is not timed in CI (flaky / dashboard-bound).
EOF

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  cat "$REPORT" >> "$GITHUB_STEP_SUMMARY"
fi

echo "Wrote $REPORT (${bytes} bytes, build ${build_s}s)"
