#!/usr/bin/env bash
set -euo pipefail

chart_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
values="$chart_dir/tests/alert-webhooks-values.yaml"
rendered="$(mktemp)"
configmap="$(mktemp)"
trap 'rm -f "$rendered" "$configmap"' EXIT

helm lint "$chart_dir" -f "$values" >/dev/null
helm template test "$chart_dir" -f "$values" >"$rendered"
helm template test "$chart_dir" -f "$values" --show-only templates/configmap.yaml >"$configmap"

grep -Eq 'HEALTH_ALERT_WEBHOOK_TARGETS' "$configmap"
grep -Eq 'HEALTH_ALERT_WEBHOOK_TARGET_0_URL' "$rendered"
grep -Eq 'HEALTH_ALERT_WEBHOOK_TARGET_1_HEADERS' "$rendered"
grep -Eq 'secretKeyRef:' "$rendered"
grep -Fq 'repeat\":false' "$configmap"

if grep -Eq 'matrix\.example\.com|hooks\.slack\.com/services|Authorization:' "$configmap"; then
  echo 'secret-bearing webhook data leaked into ConfigMap' >&2
  exit 1
fi

if helm template test "$chart_dir" -f "$values" \
  --set alertWebhooks.targets[0].format=not-a-format >/dev/null 2>&1; then
  echo 'invalid custom webhook format unexpectedly rendered' >&2
  exit 1
fi

if helm template test "$chart_dir" -f "$values" \
  --set alertWebhooks.targets[1].url=http://insecure.example/hook >/dev/null 2>&1; then
  echo 'plain HTTP custom webhook unexpectedly rendered' >&2
  exit 1
fi

grep -Eq 'HEALTH_ALERT_INSTANCE_NAME: "prod-eu"' "$configmap"
grep -Eq 'HEALTH_ALERT_DASHBOARD_URL: "https://chm\.example\.com"' "$configmap"
grep -Fq 'HEALTH_ALERT_METADATA: "{\"region\":\"eu\",\"team\":\"db\"}"' "$configmap"
grep -Eq 'name: HEALTH_ALERT_METADATA' "$rendered"

defaults_cm="$(helm template test "$chart_dir" --set clickhouse.host=https://ch.example.com \
  --show-only templates/configmap.yaml)"
if grep -Eq 'HEALTH_ALERT_(INSTANCE_NAME|DASHBOARD_URL|METADATA)' <<<"$defaults_cm"; then
  echo 'alert identity env rendered with default (empty) values' >&2
  exit 1
fi

if helm template test "$chart_dir" -f "$values" \
  --set alerting.dashboardUrl=ftp://chm.example.com >/dev/null 2>&1; then
  echo 'non-http(s) alerting.dashboardUrl unexpectedly rendered' >&2
  exit 1
fi

echo 'custom alert webhook Helm render passed'
