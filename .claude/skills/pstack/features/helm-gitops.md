# Helm and GitOps

chmonitor ships a Helm chart under `deploy/helm/chmonitor` and a raw Kustomize
base under `deploy/kubernetes/base`. Operators can deploy either path, so a
change to templates, values, probes, or webhook configuration needs both
rendered output and a clear secret boundary.

## Sub-features

- `helm-lint` validates chart metadata, templates, and values.
- `helm-template-kubeconform` renders the default chart and checks Kubernetes
  schemas at the CI-selected API version.
- `kustomize-kubeconform` renders the raw manifest base and checks the same
  schema contract.
- `helm-webhook-render` verifies custom webhook metadata, secret references,
  invalid format rejection, and HTTPS enforcement.
- `helm-release` packages a versioned chart to the chart repository and Pages
  site after a chart version change on `main`.
- `k8s-probes` keeps static liveness separate from ClickHouse-gated readiness.
- `gitops-secrets` keeps passwords and webhook credentials out of committed
  values and ConfigMaps.

## How to get to it (user POV)

- Install or upgrade with the commands documented in
  `deploy/helm/chmonitor/README.md`, or render an overlay with the commands in
  `deploy/kubernetes/README.md`.
- Review the rendered Deployment, Service, probes, environment references, and
  webhook ConfigMap before applying.
- Use Helm for templating, HPA, and Ingress. Use Kustomize when the cluster
  configuration is intentionally raw YAML in Git.
- Use a Secret manager, External Secrets, SOPS, or Sealed Secrets for real
  credentials. The committed `secret.yaml` password is a placeholder.

## Driving it with CI

Preconditions:

- A Helm or Kustomize change is present in the PR. The workflow is path
  filtered; an unchanged path produces no lint run.
- CI supplies Helm and kubeconform. Do not install those tools in this
  validation worktree.

- **Chart lint and render.** In `.github/workflows/k8s-lint.yml`, job `helm`,
  inspect `helm lint "$CHART_DIR"`, `helm template release "$CHART_DIR" | kubeconform`,
  and the custom webhook fixture step. The expected output is a valid chart and
  schema-valid rendered resources.
- **Raw Kubernetes path.** In the same workflow, job `kustomize`, inspect
  `kubectl kustomize "$KUSTOMIZE_DIR" | kubeconform -strict -summary` with the
  documented Kubernetes version.
- **Webhook values.** `deploy/helm/chmonitor/tests/test-alert-webhooks.sh` is
  the focused contract for custom targets. It checks ConfigMap redaction,
  `secretKeyRef`, invalid format rejection, and plain HTTP rejection.
- **Chart release.** `.github/workflows/helm-release.yml` is a `main` path-
  filtered release workflow. It uses `helm/chart-releaser-action` and then
  publishes the chart repository to Cloudflare Pages. A PR without a chart
  version bump does not prove a published chart.
- **Deployment artifact.** `.github/workflows/ci.yml` and
  `.github/workflows/base.yml` build and test the Docker artifact on relevant
  changes. This complements chart rendering but does not replace it.
- **Evidence.** Record the chart or overlay path, rendered resource kind,
  Kubernetes version, workflow job, and whether the run was a PR lint or a
  `main` release. Redact all values and secret references.

## Gotchas

- `/healthz` is static liveness. `/api/healthz` is readiness and can be `503`
  while ClickHouse is unavailable. A probe change must preserve that split.
- `helm template` proves rendering, not a live cluster rollout or probe
  behavior.
- The chart's webhook test intentionally uses placeholder values. Never copy a
  real password or credential URL into a fixture.
- `KUBECONFIG` and a running cluster are not assumed by this matrix. A chart
  proof is not a deployment proof.
- The chart release workflow is path-filtered and runs on `main`; a local
  `Chart.yaml` edit does not create a published repository entry.
- Kustomize and Helm are separate deployment paths. A change to one does not
  automatically validate the other.
- Keep the image tag and secret strategy explicit in GitOps. Do not add a
  plaintext secret to `values.yaml`, `secret.yaml`, or a ConfigMap to make a
  render pass.
