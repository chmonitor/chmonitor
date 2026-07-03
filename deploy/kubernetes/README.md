# Kubernetes manifests (kustomize base)

Raw Kubernetes manifests for the [chmonitor](https://github.com/chmonitor/chmonitor)
dashboard. This is the no-Helm `kubectl apply -k` path — it ships the same
image, ports, probes, security context, and environment as the
[Helm chart](../helm/chmonitor) but with plain YAML you can read,
diff, and patch with [kustomize](https://kustomize.io/).

Prefer the Helm chart if you want templating, an HPA, and an Ingress out of the
box. Prefer these manifests if you keep your cluster config in Git as raw YAML.

## Layout

```
deploy/kubernetes/
└── base/
    ├── configmap.yaml      # CLICKHOUSE_HOST / CLICKHOUSE_USER / CLICKHOUSE_MAX_EXECUTION_TIME
    ├── secret.yaml         # CLICKHOUSE_PASSWORD placeholder (stringData)
    ├── service.yaml        # ClusterIP on port 3000
    ├── deployment.yaml     # 1 replica, /healthz + /api/healthz probes, non-root 1001
    └── kustomization.yaml  # ties the four resources together, pins the image tag
```

## Quick start

Edit `base/configmap.yaml` (host/user) and set the password, then apply:

```bash
kubectl apply -k deploy/kubernetes/base
```

Render without applying to review the output first:

```bash
kubectl kustomize deploy/kubernetes/base
```

Port-forward to reach the dashboard locally:

```bash
kubectl port-forward svc/chmonitor 3000:3000
# open http://localhost:3000
```

## Configuration

| Resource | Key | Default | Purpose |
|---|---|---|---|
| ConfigMap | `CLICKHOUSE_HOST` | `http://localhost:8123` | Comma-separated ClickHouse host URLs. |
| ConfigMap | `CLICKHOUSE_USER` | `default` | Comma-separated usernames. |
| ConfigMap | `CLICKHOUSE_MAX_EXECUTION_TIME` | `60` | Query timeout in seconds. |
| Secret | `CLICKHOUSE_PASSWORD` | `""` | Comma-separated passwords. |

### Secrets

`base/secret.yaml` ships an **empty placeholder** password. Do not commit a real
password. Instead, layer one of these on top in an environment overlay:

```bash
# One-off: create the Secret out of band, then drop secret.yaml from resources.
kubectl create secret generic chmonitor \
  --from-literal=CLICKHOUSE_PASSWORD='change-me'
```

For GitOps, use [External Secrets](https://external-secrets.io/),
[SOPS](https://github.com/getsops/sops), or
[Sealed Secrets](https://sealed-secrets.netlify.app/) so plaintext never lands
in Git.

## Customizing with overlays

Create an overlay that references this base and patches what differs per
environment — namespace, replicas, image tag, resources:

```yaml
# deploy/kubernetes/overlays/prod/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: monitoring
resources:
  - ../../base
images:
  - name: ghcr.io/chmonitor/chmonitor
    newTag: v1.2.3
replicas:
  - name: chmonitor
    count: 2
```

```bash
kubectl apply -k deploy/kubernetes/overlays/prod
```

## Custom queries (queries.d)

Add your own monitoring queries without forking the image: mount a ConfigMap
of `*.yaml` declarative query configs at `CHM_CONFIG_DIRECTORY` (default
`/etc/chmonitor/queries.d`) and the dashboard picks them up at startup. Invalid
files are skipped and logged; a missing directory is a silent no-op — this
needs a local filesystem, so it only applies to Docker/Kubernetes, not the
Cloudflare Worker deploy.

```yaml
# deploy/kubernetes/overlays/custom-queries/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../base
configMapGenerator:
  - name: chmonitor-queries
    files:
      - my-query.yaml # declarative schema — see docs/content/reference/catalog-contributing.mdx
patches:
  - target:
      kind: Deployment
      name: chmonitor
    patch: |-
      - op: add
        path: /spec/template/spec/containers/0/env/-
        value:
          name: CHM_CONFIG_DIRECTORY
          value: /etc/chmonitor/queries.d
      - op: add
        path: /spec/template/spec/containers/0/volumeMounts
        value:
          - name: queries-d
            mountPath: /etc/chmonitor/queries.d
            readOnly: true
      - op: add
        path: /spec/template/spec/volumes
        value:
          - name: queries-d
            configMap:
              name: chmonitor-queries
```

```bash
kubectl apply -k deploy/kubernetes/overlays/custom-queries
```

## Health probes

- **Liveness** — `GET /healthz` (static, always `200` while the process runs).
- **Readiness** — `GET /api/healthz` (returns `503` when no configured
  ClickHouse host is reachable, so traffic is only routed once a host is up).

## Security

Pods run as the non-root `app` user (uid/gid `1001`) baked into the Docker
runner stage, with `allowPrivilegeEscalation: false` and all Linux capabilities
dropped.

## Validation

These manifests are linted in CI by
[`.github/workflows/k8s-lint.yml`](../../.github/workflows/k8s-lint.yml) with
[kubeconform](https://github.com/yannh/kubeconform). Validate locally:

```bash
kubectl kustomize deploy/kubernetes/base | kubeconform -strict -summary
```
