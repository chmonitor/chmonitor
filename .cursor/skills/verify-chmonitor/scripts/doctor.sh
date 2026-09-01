#!/usr/bin/env bash
# Read-only check: is this the binary we built, and is it worth driving?
#
#   scripts/doctor.sh            identity + dashboard connectivity (CLICKHOUSE_* unset)  # pragma: allowlist secret
#   scripts/doctor.sh --cluster  plus local cluster scan at $VERIFY_CH_HOST
#
# Identity is fail-closed. Cloud /api/healthz is ClickHouse-gated and may 503  # pragma: allowlist secret
# while /api/v1/hosts is 200 — that is not a wrong-binary signal.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

CLUSTER=0
if [[ "${1:-}" == "--cluster" ]]; then
  CLUSTER=1
fi

ensure_dirs

if [[ ! -x "$CHM_BIN" || ! -f "$IDENTITY_FILE" ]]; then
  echo "verify-chmonitor doctor: launch has not succeeded ($CHM_BIN / $IDENTITY_FILE)" >&2
  exit 1
fi

identity="$(cat "$IDENTITY_FILE")"
version_line="$("$CHM_BIN" --version)"
crate="$(crate_version)"
real_bin="$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$CHM_BIN")"
ident_bin="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["bin"])' "$IDENTITY_FILE")"

fail=0
if [[ "$real_bin" != "$ident_bin" ]]; then
  echo "verify-chmonitor doctor: binary path mismatch  now=$real_bin  launch=$ident_bin" >&2
  fail=1
fi
if [[ "$version_line" != *"$crate"* ]]; then
  echo "verify-chmonitor doctor: version is not this crate ($version_line vs $crate)" >&2
  fail=1
fi
if [[ "$version_line" != *"("*")"* ]]; then
  echo "verify-chmonitor doctor: version line missing compile-time target: $version_line" >&2
  fail=1
fi
if [[ "$real_bin" != "$VERIFY_PREFIX"* ]]; then
  echo "verify-chmonitor doctor: $real_bin is not under $VERIFY_PREFIX (not our install)" >&2
  fail=1
fi

echo "ok    identity             $version_line"
echo "ok    bin                  $real_bin"

# Persist identity *before* dashboard HTTP. dash.chmonitor.dev /api/healthz can
# hang; wrapping doctor.sh with `timeout` must still leave these files.
printf '%s\n' "$identity" >"$VERIFY_EVIDENCE/doctor-identity.json"
echo "$version_line" >"$VERIFY_EVIDENCE/doctor-version.txt"

if [[ "$fail" -ne 0 ]]; then
  echo "verify-chmonitor doctor: identity failed" >&2
  exit 1
fi

# Connectivity doctor: MUST unset CLICKHOUSE_HOST or this becomes a cluster scan.  # pragma: allowlist secret
# Bound HTTP so a hung healthz cannot block the rest of the helper.
conn_json="$VERIFY_EVIDENCE/doctor-connectivity.json"
conn_timeout="${VERIFY_DOCTOR_HTTP_TIMEOUT:-45}"
set +e
# timeout cannot wrap a bash function; invoke the binary with the same isolated env as chm().
if command -v timeout >/dev/null; then
  chm_env timeout "$conn_timeout" "$CHM_BIN" --config "$CONFIG_PATH" --base-url "$VERIFY_BASE_URL" --json doctor \
    >"$conn_json" 2>"$VERIFY_EVIDENCE/doctor-connectivity.stderr"
  conn_rc=$?
else
  chm --json doctor >"$conn_json" 2>"$VERIFY_EVIDENCE/doctor-connectivity.stderr"
  conn_rc=$?
fi
set -e

python3 - "$conn_json" "$crate" "$conn_rc" <<'PY'
import json, sys
path, crate, rc = sys.argv[1], sys.argv[2], int(sys.argv[3])
timed_out = rc in (124, 137)
try:
    data = json.load(open(path))
except Exception as e:
    mark = "info" if timed_out else "FAIL"
    print(f"{mark}  connectivity_json    {e} (rc={rc})", file=sys.stderr)
    sys.exit(0 if timed_out else 1)
if not isinstance(data, list):
    mark = "info" if timed_out else "FAIL"
    print(f"{mark}  connectivity_json    expected array (rc={rc})", file=sys.stderr)
    sys.exit(0 if timed_out else 1)
by = {row.get("check"): row for row in data if isinstance(row, dict)}
cli = by.get("cli_version") or {}
detail = str(cli.get("detail") or "")
if crate not in detail:
    print(f"FAIL  cli_version          {detail!r} does not contain {crate}", file=sys.stderr)
    sys.exit(1)
print(f"ok    cli_version          {detail}")
for name in ("base_url", "auth_method", "credentials", "dashboard_health", "hosts_api"):
    row = by.get(name) or {}
    mark = "ok" if row.get("ok") else "info"
    print(f"{mark:4}  {name:<20} {row.get('detail','')}")
if timed_out:
    print("info  doctor_exit          timeout (cloud healthz can hang; identity already recorded)")
elif rc != 0:
    print("info  doctor_exit          non-zero (cloud healthz/credentials often fail without login)")
PY

# Cluster scan is the health check before driving TUI against a CH HTTP host.
if [[ "$CLUSTER" -eq 1 ]]; then
  ping_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$VERIFY_CH_HOST/ping" || true)"
  if [[ "$ping_code" != "200" ]]; then
    echo "verify-chmonitor doctor: $VERIFY_CH_HOST/ping returned $ping_code (need 200 before TUI drive)" >&2
    exit 1
  fi
  echo "ok    clickhouse_ping      $VERIFY_CH_HOST/ping $ping_code"  # pragma: allowlist secret
  cluster_json="$VERIFY_EVIDENCE/doctor-cluster.json"
  set +e
  chm --json doctor --ch-host "$VERIFY_CH_HOST" >"$cluster_json" 2>"$VERIFY_EVIDENCE/doctor-cluster.stderr"
  cluster_rc=$?
  set -e
  python3 - "$cluster_json" "$cluster_rc" <<'PY'
import json, sys
path, rc = sys.argv[1], int(sys.argv[2])
data = json.load(open(path))
score = data.get("score")
grade = data.get("grade")
findings = data.get("findings") or []
print(f"ok    cluster_report       score={score} grade={grade} findings={len(findings)} exit={rc}")
if rc not in (0, 1):
    sys.exit(1)
PY
  redact_check_file "$cluster_json"
fi

redact_check_file "$conn_json" || true
echo "verify-chmonitor doctor: this binary is ours"
