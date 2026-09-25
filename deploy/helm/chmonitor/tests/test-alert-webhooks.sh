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

if grep -Eq 'matrix\.example\.com|hooks\.slack\.com/services|Authorization:' "$configmap"; then
  echo 'secret-bearing webhook data leaked into ConfigMap' >&2
  exit 1
fi

if helm template test "$chart_dir" -f "$values" \
  --set alertWebhooks.targets[0].format=not-a-format >/dev/null 2>&1; then
  echo 'invalid custom webhook format unexpectedly rendered' >&2
  exit 1
fi

echo 'custom alert webhook Helm render passed'
