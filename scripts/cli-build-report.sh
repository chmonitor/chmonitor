#!/usr/bin/env bash
# Build only the chm CLI crate (optionally --target) and emit JSON metrics,
# or assemble a markdown report from those JSON files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/rust"

usage() {
  echo "usage: $0 [--target TRIPLE] [--out DIR] [--assemble DIR] [--report PATH]" >&2
  exit 2
}

target=""
out_dir="${CLI_METRICS_DIR:-$ROOT/cli-report-metrics}"
assemble_dir=""
report="${CLI_REPORT_PATH:-$ROOT/cli-report.md}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) target="${2:-}"; shift 2 ;;
    --out) out_dir="${2:-}"; shift 2 ;;
    --assemble) assemble_dir="${2:-}"; shift 2 ;;
    --report) report="${2:-}"; shift 2 ;;
    -h|--help) usage ;;
    *) usage ;;
  esac
done

host_triple() {
  rustc -vV | awk '/^host:/{print $2}'
}

now_s() {
  python3 -c 'import time; print(f"{time.time():.3f}")'
}

elapsed() {
  python3 -c 'import sys; print(f"{float(sys.argv[2])-float(sys.argv[1]):.2f}")' "$1" "$2"
}

file_size() {
  python3 -c 'import os,sys; print(os.path.getsize(sys.argv[1]))' "$1"
}

if [[ -n "$assemble_dir" ]]; then
  python3 - "$assemble_dir" "$report" <<'PY'
import json, os, sys
from pathlib import Path

src, dest = Path(sys.argv[1]), Path(sys.argv[2])
files = sorted(src.rglob("*.json"))
if not files:
    raise SystemExit(f"no metrics json in {src}")
rows = [json.loads(p.read_text()) for p in files]
rows.sort(key=lambda r: r.get("target") or "")
head = rows[0]
sha = os.environ.get("GITHUB_SHA") or head.get("sha") or ""
short = sha[:12]
ref = os.environ.get("GITHUB_HEAD_REF") or os.environ.get("GITHUB_REF_NAME") or "local"
version = head.get("version", "?")

def cell(v, suffix=""):
    if v is None or v == "":
        return "—"
    return f"{v}{suffix}"

lines = [
    "<!-- cli-build-report -->",
    f"## CLI build report (`chm` {version})",
    "",
    "_Always rebuilt on each push. This comment is updated in place (latest only)._",
    "",
    f"Ref `{ref}` @ `{short}`. CLI crate only — Linux + macOS release targets.",
    "",
    "| Target | Runner | Bytes | MiB | Build s | Tests s | `--version` p50 | `--help` p50 | vs last stable |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
]
for r in rows:
    bytes_ = int(r.get("bytes") or 0)
    mib = bytes_ / 1024 / 1024
    delta = r.get("delta_line") or "—"
    lines.append(
        "| `{target}` | {runner} | {bytes:,} | {mib:.2f} | {build} | {tests} | {vp} | {hp} | {delta} |".format(
            target=r.get("target") or "",
            runner=r.get("runner") or "",
            bytes=bytes_,
            mib=mib,
            build=cell(r.get("build_s")),
            tests=cell(r.get("test_s")),
            vp=cell(r.get("version_p50_ms"), " ms"),
            hp=cell(r.get("help_p50_ms"), " ms"),
            delta=delta,
        )
    )
ver = next((r.get("chm_version") for r in rows if r.get("chm_version")), "")
if ver:
    lines += ["", f"`chm --version` (native): `{ver}`"]
lines += [
    "",
    "Cross-compiled targets skip tests and startup benches. Network snapshot (`chm --no-tui`) is not timed in CI.",
    "",
]
text = "\n".join(lines)
dest.write_text(text)
summary = os.environ.get("GITHUB_STEP_SUMMARY")
if summary:
    with open(summary, "a", encoding="utf-8") as fh:
        fh.write(text)
        fh.write("\n")
print(f"Wrote {dest}")
PY
  exit 0
fi

host="$(host_triple)"
if [[ -z "$target" ]]; then
  target="$host"
fi

mkdir -p "$out_dir"
version="$(sed -n 's/^version = "\([^"]*\)"/\1/p' ch-monitor-cli/Cargo.toml | head -n1)"
rustc_v="$(rustc --version)"
cargo_v="$(cargo --version)"
sha="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD)}"
runner="${RUNNER_OS:-$(uname -s)}/${RUNNER_ARCH:-$(uname -m)}"

bin_dir="$ROOT/rust/target/${target}/release"
chm="$bin_dir/chm"
if [[ "$target" == *windows* ]]; then
  chm="${chm}.exe"
fi

t0="$(now_s)"
cargo build --release -p chmonitor --target "$target"
t1="$(now_s)"
build_s="$(elapsed "$t0" "$t1")"

if [[ ! -f "$chm" ]]; then
  echo "missing release binary $chm" >&2
  exit 1
fi
bytes="$(file_size "$chm")"

can_run=0
chm_ver=""
test_s=""
ver_p50=""
help_p50=""
if [[ "$target" == "$host" ]]; then
  can_run=1
elif [[ "$(uname -s)" == Darwin && "$target" == "x86_64-apple-darwin" ]]; then
  if "$chm" --version >/dev/null 2>&1; then
    can_run=1
  fi
fi

if [[ "$can_run" -eq 1 ]]; then
  chm_ver="$("$chm" --version | head -n1)"
  t0="$(now_s)"
  cargo test --release -p chmonitor --target "$target" -- --test-threads=4
  t1="$(now_s)"
  test_s="$(elapsed "$t0" "$t1")"
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
    return {"p50": round(statistics.median(times), 2)}

print(json.dumps({"version": run(["--version"]), "help": run(["--help"])}))
PY
)"
  ver_p50="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["version"]["p50"])' "$bench")"
  help_p50="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["help"]["p50"])' "$bench")"
fi

delta_line=""
if command -v gh >/dev/null 2>&1; then
  asset="chm-${target}"
  prev="$(gh api "repos/${GITHUB_REPOSITORY:-chmonitor/chmonitor}/releases" --paginate \
    --jq "[.[] | select(.tag_name|test(\"^chm-v[0-9]+\\\\.[0-9]+\\\\.[0-9]+$\")) | {tag:.tag_name, size:(.assets[]? | select(.name==\"${asset}\") | .size)}] | map(select(.size != null)) | .[0]" \
    2>/dev/null || true)"
  if [[ -n "${prev:-}" && "$prev" != "null" ]]; then
    prev_tag="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1]).get("tag") or "")' "$prev" 2>/dev/null || true)"
    prev_size="$(python3 -c 'import json,sys; v=json.loads(sys.argv[1]).get("size"); print("" if v is None else v)' "$prev" 2>/dev/null || true)"
    if [[ -n "${prev_tag:-}" && -n "${prev_size:-}" ]]; then
      delta=$((bytes - prev_size))
      sign="+"
      if [[ "$delta" -lt 0 ]]; then sign=""; fi
      delta_line="\`${prev_tag}\` ${sign}${delta} B"
    fi
  fi
fi

export METRICS_PATH="$out_dir/${target}.json"
export METRICS_TARGET="$target"
export METRICS_VERSION="$version"
export METRICS_SHA="$sha"
export METRICS_RUNNER="$runner"
export METRICS_HOST="$host"
export METRICS_RUSTC="$rustc_v"
export METRICS_CARGO="$cargo_v"
export METRICS_BYTES="$bytes"
export METRICS_BUILD_S="$build_s"
export METRICS_TEST_S="$test_s"
export METRICS_CHM_VER="$chm_ver"
export METRICS_VER_P50="$ver_p50"
export METRICS_HELP_P50="$help_p50"
export METRICS_DELTA="$delta_line"
export METRICS_CAN_RUN="$can_run"

python3 <<'PY'
import json, os
from pathlib import Path

def num(v):
    if v is None or v == "":
        return None
    try:
        if "." in v:
            return float(v)
        return int(v)
    except ValueError:
        return v

payload = {
    "target": os.environ["METRICS_TARGET"],
    "version": os.environ["METRICS_VERSION"],
    "sha": os.environ["METRICS_SHA"],
    "runner": os.environ["METRICS_RUNNER"],
    "host": os.environ["METRICS_HOST"],
    "rustc": os.environ["METRICS_RUSTC"],
    "cargo": os.environ["METRICS_CARGO"],
    "bytes": int(os.environ["METRICS_BYTES"]),
    "build_s": os.environ["METRICS_BUILD_S"],
    "test_s": os.environ["METRICS_TEST_S"] or None,
    "chm_version": os.environ["METRICS_CHM_VER"] or None,
    "version_p50_ms": num(os.environ["METRICS_VER_P50"]),
    "help_p50_ms": num(os.environ["METRICS_HELP_P50"]),
    "delta_line": os.environ["METRICS_DELTA"] or None,
    "can_run": os.environ["METRICS_CAN_RUN"] == "1",
}
path = Path(os.environ["METRICS_PATH"])
path.write_text(json.dumps(payload, indent=2) + "\n")
print(f"wrote {path} {payload['bytes']} bytes build {payload['build_s']}s")
PY
