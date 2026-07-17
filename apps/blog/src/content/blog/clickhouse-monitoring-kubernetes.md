---
title: "Self-hosting chmonitor on Kubernetes"
description: "Deploy the chmonitor ClickHouse dashboard on Kubernetes with the vendored Helm chart, including secrets, health probes, and an ingress."
date: 2026-07-10
tag: How-to
---

This is for anyone running ClickHouse on Kubernetes who wants the monitoring dashboard living in the same cluster instead of an external SaaS. chmonitor ships a vendored Helm chart and raw kustomize manifests — same image, same health probes, same non-root user, whichever you pick. By the end you'll have it reachable via `kubectl port-forward` (or an ingress) and connected to your cluster.

## Prerequisites

- A Kubernetes cluster and a working `kubectl` context.
- Helm 3 (for the chart) or `kubectl` with kustomize (for raw manifests).
- A reachable ClickHouse endpoint and a monitoring user.

## Steps

### 1. Install the Helm chart

```bash
helm repo add chmonitor https://charts.chmonitor.dev
helm repo update

helm install my-chm chmonitor/chmonitor \
  --set clickhouse.host="https://clickhouse.example.com:8443" \
  --set clickhouse.user="monitoring" \
  --set clickhouse.password="change-me"
```

Passing credentials directly on the CLI is fine for a quick test; for anything longer-lived use a Kubernetes `Secret` (see step 3) or a `values.yaml` you don't commit with real passwords in it.

The chart is also published as an OCI artifact if you'd rather not add a Helm repo: `helm install my-chm oci://ghcr.io/chmonitor/chmonitor --version vX.Y.Z`.

### 2. Or apply the kustomize manifests directly

```bash
# Review rendered output first
kubectl kustomize deploy/kubernetes/base

# Apply
kubectl apply -k deploy/kubernetes/base

kubectl port-forward svc/chmonitor 3000:3000
```

Keep environment differences (namespace, replica count, image tag) in an overlay rather than editing the base:

```yaml
# deploy/kubernetes/overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: monitoring
resources:
  - ../../base
images:
  - name: ghcr.io/chmonitor/chmonitor
    newTag: vX.Y.Z
replicas:
  - name: chmonitor
    count: 2
```

### 3. Put credentials in a Secret, not a ConfigMap

ClickHouse credentials are passwords — always a `Secret`:

```bash
kubectl create secret generic chmonitor-clickhouse \
  --from-literal=CLICKHOUSE_HOST='https://clickhouse.example.com:8443' \
  --from-literal=CLICKHOUSE_USER='monitoring' \
  --from-literal=CLICKHOUSE_PASSWORD='change-me'
```

Reference the secret's keys as environment variables in your Deployment (via `envFrom` or per-key `secretKeyRef`) rather than inlining values in a manifest that gets committed.

### 4. Expose it with an ingress (optional)

If you're using the Helm chart, an ingress is one values-file addition:

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

## Verifying it worked

```bash
kubectl port-forward svc/my-chm-chmonitor 3000:3000
# open http://localhost:3000
```

The pod runs as the non-root `app` user (uid/gid `1001`) on port `3000` regardless of which install method you used, and wires the same liveness/readiness probes as the Docker image (`/healthz` for liveness, `/api/healthz` for readiness — the latter is gated on ClickHouse connectivity, so a passing readiness probe means the dashboard can actually reach your cluster).

## Related

- Docs: [Kubernetes deployment](https://docs.chmonitor.dev/operate/deploy/k8s) — full chart values reference, autoscaling, and secrets management.
- Docs: [Docker deployment](https://docs.chmonitor.dev/operate/deploy/docker) — the single-container path, if you don't need Kubernetes yet.
- Docs: [Production checklist](https://docs.chmonitor.dev/operate/deploy/production-checklist) — before exposing a self-hosted instance publicly.

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] Helm repo/OCI install commands, kustomize commands, and Secret creation copied and checked against docs/content/operate/deploy/k8s.mdx.
- [x] Non-root app user (uid/gid 1001) and port 3000 checked against docs/content/operate/deploy/k8s.mdx intro paragraph.
- [x] Liveness (/healthz) vs readiness (/api/healthz, ClickHouse-gated) distinction checked against docs/knowledge/k8s-health-probes.md.
- [x] Ingress values snippet checked against docs/content/operate/deploy/k8s.mdx example values.yaml.
- [x] Self-hosted-only content, no Cloud-mode claims made.
- [x] Docs cross-links (k8s.mdx, docker.mdx, production-checklist.mdx) confirmed present in docs/content/operate/deploy/.
-->
