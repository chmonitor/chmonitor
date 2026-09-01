#!/usr/bin/env bash
# Read-only check: is this the binary we built, and is it worth driving?
#
#   scripts/doctor.sh              identity only (default — no dash HTTP)
#   scripts/doctor.sh --http       also dashboard connectivity (bounded timeout)
#   scripts/doctor.sh --cluster    plus local cluster scan at $VERIFY_CH_HOST
#
# Identity is fail-closed. Hosted /api/healthz is cluster-gated and can hang;
# it is not part of identity. Default skips that HTTP. `VERIFY_DOCTOR_HTTP=1`
# or `--http` enables it with `timeout --kill-after` (default 5s).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

CLUSTER=0
WANT_HTTP=0
for arg in "$@"; do
  case "$arg" in
    --cluster) CLUSTER=1 ;;
    --http) WANT_HTTP=1 ;;
    --identity) WANT_HTTP=0 ;;
    *)
      echo "verify-chmonitor doctor: unknown argument '$arg'" >&2
      exit 2
      ;;
  esac
done
if [[ "${VERIFY_DOCTOR_HTTP:-}" == "1" || "${VERIFY_DOCTOR_SKIP_HTTP:-1}" == "0" ]]; then
  WANT_HTTP=1
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

# Persist identity before any network. dash.chmonitor.dev /api/healthz can hang.
printf '%s\n' "$identity" >"$VERIFY_EVIDENCE/doctor-identity.json"
echo "$version_line" >"$VERIFY_EVIDENCE/doctor-version.txt"

if [[ "$fail" -ne 0 ]]; then
  echo "verify-chmonitor doctor: identity failed" >&2
  exit 1
fi

if [[ "$WANT_HTTP" -eq 0 ]]; then
  echo "info  dashboard_http       skipped (identity-only; set VERIFY_DOCTOR_HTTP=1 or pass --http)"
else
  # MUST unset CLICKHOUSE_HOST or this becomes a cluster scan.  # pragma: allowlist secret
  conn_json="$VERIFY_EVIDENCE/doctor-connectivity.json"
  conn_timeout="${VERIFY_DOCTOR_HTTP_TIMEOUT:-5}"
  set +e
  if command -v timeout >/dev/null; then
    # SIGTERM then SIGKILL so a stuck healthz cannot block the helper.
    chm_env timeout --foreground --kill-after=1s "$conn_timeout" \
      "$CHM_BIN" --config "$CONFIG_PATH" --base-url "$VERIFY_BASE_URL" --json doctor \
      >"$conn_json" 2>"$VERIFY_EVIDENCE/doctor-connectivity.stderr"
    conn_rc=$?
  else
    echo "verify-chmonitor doctor: GNU timeout missing; skipping dashboard HTTP" >&2
    conn_rc=124
  fi
  set -e

  python3 - "$conn_json" "$crate" "$conn_rc" <<'PY'
import json, sys
path, crate, rc = sys.argv[1], sys.argv[2], int(sys.argv[3])
timed_out = rc in (124, 137)
try:
    data = json.load(open(path))
except Exception as e:
    print(f"info  connectivity_json    {e} (rc={rc})")
    sys.exit(0)
if not isinstance(data, list):
    print(f"info  connectivity_json    expected array (rc={rc})")
    sys.exit(0)
by = {row.get("check"): row for row in data if isinstance(row, dict)}
cli = by.get("cli_version") or {}
detail = str(cli.get("detail") or "")
if crate not in detail and not timed_out:
    print(f"FAIL  cli_version          {detail!r} does not contain {crate}", file=sys.stderr)
    sys.exit(1)
if crate in detail:
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
  redact_check_file "$conn_json" || true
fi

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
  if command -v timeout >/dev/null; then
    chm_env timeout --foreground --kill-after=1s 20 \
      "$CHM_BIN" --config "$CONFIG_PATH" --json doctor --ch-host "$VERIFY_CH_HOST" \
      >"$cluster_json" 2>"$VERIFY_EVIDENCE/doctor-cluster.stderr"
    cluster_rc=$?
  else
    chm --json doctor --ch-host "$VERIFY_CH_HOST" >"$cluster_json" 2>"$VERIFY_EVIDENCE/doctor-cluster.stderr"
    cluster_rc=$?
  fi
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

echo "verify-chmonitor doctor: this binary is ours"
