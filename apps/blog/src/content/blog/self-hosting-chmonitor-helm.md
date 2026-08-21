---
title: "Deploy chmonitor on Kubernetes with Helm"
description: "Install the vendored chmonitor Helm chart, point it at ClickHouse, and confirm the pod is ready — no SaaS, the dashboard stays in your cluster."
date: 2026-08-21
tag: How-to
---

This is for teams that already run ClickHouse on Kubernetes and want the dashboard in the same cluster. The Helm chart is vendored with the app: same image as Docker, non-root uid `1001`, port `3000`. By the end you can `port-forward` to it (or hit an ingress) and see your cluster.

If you only have a single node, start with [Docker](/clickhouse-self-hosting-docker/) instead.

## Prerequisites

- A Kubernetes cluster and a working `kubectl` context.
- Helm 3.
- A reachable ClickHouse HTTP endpoint and a **read-only monitoring user** (`SELECT` / `SHOW` on the databases you monitor). Do **not** assign ClickHouse's `readonly=1` profile — the dashboard sets `max_execution_time` as a session setting, and that profile forbids it (readiness then stays 503).

## Steps

### 1. Add the chart repo and install

```bash
helm repo add chmonitor https://charts.chmonitor.dev
helm repo update

helm install my-chm chmonitor/chmonitor \
  --set clickhouse.host="https://clickhouse.example.com:8443" \
  --set clickhouse.user="monitoring" \
  --set clickhouse.password="change-me"
```

`--set` is fine for a smoke test. For anything that lives, use a values file and a Secret (steps 2–3).

OCI instead of the Helm repo:

```bash
helm install my-chm oci://ghcr.io/chmonitor/chmonitor --version vX.Y.Z \
  --set clickhouse.host="https://clickhouse.example.com:8443" \
  --set clickhouse.user="monitoring" \
  --set clickhouse.password="change-me"
```

Replace `vX.Y.Z` with a [release tag](https://github.com/chmonitor/chmonitor/releases). Pin it — do not rely on `:latest`.

### 2. Prefer a values file

```yaml
# values.yaml — do not commit real passwords
image:
  tag: "vX.Y.Z"

clickhouse:
  host: "https://clickhouse.example.com:8443"
  user: "monitoring"
  password: "change-me"

ingress:
  enabled: false

resources:
  requests:
    cpu: 100m
    memory: 256Mi
  limits:
    cpu: 500m
    memory: 512Mi
```

```bash
helm install my-chm chmonitor/chmonitor -f values.yaml
```

Upgrade later with the same file:

```bash
helm upgrade my-chm chmonitor/chmonitor -f values.yaml
```

### 3. Put the password in a Secret

```bash
kubectl create secret generic chmonitor-clickhouse \
  --from-literal=CLICKHOUSE_PASSWORD='change-me'
```

Then point the chart at it instead of `clickhouse.password`:

```yaml
clickhouse:
  host: "https://clickhouse.example.com:8443"
  user: "monitoring"
  existingSecret: chmonitor-clickhouse   # key: CLICKHOUSE_PASSWORD
```

GitOps: External Secrets, SOPS, or Sealed Secrets — not a password in git.

### 4. Expose it (optional)

```yaml
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: chmonitor.example.com
      paths:
        - path: /
          pathType: Prefix
```

Until then, port-forward is enough.

## Verifying it worked

The chart wires two probes. Mix them up and you get CrashLoopBackOff when ClickHouse blips:

| Probe | Path | Meaning |
|---|---|---|
| Liveness | `GET /healthz` | Process is up. Always 200 while the app runs. Never gate this on ClickHouse. |
| Readiness | `GET /api/healthz` | Can reach ClickHouse (`SELECT 1`). 503 keeps the pod out of the Service. |

```bash
kubectl rollout status deploy/my-chm-chmonitor
kubectl port-forward svc/my-chm-chmonitor 3000:3000
curl -sf http://localhost:3000/api/healthz && echo OK
```

Open `http://localhost:3000`. A 200 on `/api/healthz` means the dashboard can talk to ClickHouse, not only that the container started.

Uninstall:

```bash
helm uninstall my-chm
```

## Related

- Docs: [Kubernetes](https://docs.chmonitor.dev/operate/deploy/k8s) — full values, autoscaling, kustomize.
- [Self-hosting on Docker](/clickhouse-self-hosting-docker/) — the single-container path.
- [Self-hosting on Kubernetes](/clickhouse-monitoring-kubernetes/) — Helm plus kustomize, same probes.
- [We're selling a commercial license](/self-hosted-licenses/) — invoice if procurement needs one; the chart stays GPL-3.0.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] helm repo / OCI / --set / values.yaml match docs/content/operate/deploy/k8s.mdx
- [x] existingSecret key CLICKHOUSE_PASSWORD matches deploy/helm/chmonitor/README.md
- [x] readonly=1 / max_execution_time warning matches helm README
- [x] /healthz vs /api/healthz matches docs/knowledge/k8s-health-probes.md
- [x] image ghcr.io/chmonitor/chmonitor, port 3000, uid 1001
- [x] Self-hosted only; no Cloud-only claims
-->
