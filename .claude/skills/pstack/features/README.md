# chmonitor validation feature map

This is the maintained source for choosing a CI proof for a user-facing
chmonitor change. Read the index, then open the matching feature file. The
project-local router is [`../SKILL.md`](../SKILL.md).

## Baseline and result labels

- Anchor every observation to the commit and PR under review.
- Start with `git status --short --branch`, `git diff --name-only origin/main...HEAD`, and `gh pr checks <PR> --watch=false`.
- Use the workflow and job named by the feature file. A path-filtered job that
  did not run is `not exercised`, not `verified`.
- Prefer required checks for merge claims. Non-required checks remain useful
  evidence but do not become a merge gate by repetition.
- Capture the expected state and the observed state. Do not substitute a
  cached response, a fixture, or a different route.
- Label the result `verified`, `verified-unreachable`, or `blocked`. Include
  the attempted entry point and the unmet prerequisite for the latter two.

## CI coverage at a glance

| ID | Surface | Primary CI owner | Live or feature prerequisite |
| --- | --- | --- | --- |
| `ui-shell` | Dashboard pages, navigation, responsive shell, a11y | `.github/workflows/test.yml` plus `.github/workflows/a11y.yml` | Authenticated browser state is not assumed. |
| `api-auth-security` | API boundaries, auth, SQL safety, SSRF, signatures, rate limits | `.github/workflows/test.yml` and `.github/workflows/cloudflare.yml` | Secrets are CI-injected only for deployment proof. |
| `peerdb` | PeerDB status, metrics, agent tool, insights and alerts | `.github/workflows/test.yml`; agent eval only on its path filter | A configured PeerDB service is not assumed. |
| `custom-webhooks` | Alert targets, D1/Helm precedence, previews, event bus | `.github/workflows/test.yml` and `.github/workflows/k8s-lint.yml` | External delivery is not assumed. |
| `helm-gitops` | Helm, Kustomize, chart release, probes, webhook render | `.github/workflows/k8s-lint.yml` and `.github/workflows/helm-release.yml` | Helm changes trigger the lint workflow. |
| `deploy-cli` | Cloudflare, Docker, Node deploy, `chm` CLI and local connections | `.github/workflows/ci.yml`, `.github/workflows/cloudflare.yml`, `.github/workflows/cli-rust-ci.yml`, `.github/workflows/cli-report.yml` | A live Worker or binary is optional and must be named. |

## Features

- [Dashboard UI](./dashboard-ui.md) covers route shells, navigation, host
  routing, loading/error states, responsive behavior, and accessibility.
- [API, auth, and security](./api-auth-security.md) covers the request
  boundary, ClickHouse safety, auth discovery, cloud isolation, signatures,
  SSRF, rate limits, and secret redaction.
- [PeerDB agent, metrics, and alerts](./peerdb.md) covers status, fleet
  metrics, read-only proxying, connection ownership, the gated agent tool,
  insights, and health-sweep participation.
- [Custom webhooks and event delivery](./custom-webhooks.md) covers alert
  settings, Helm/GitOps targets, D1 overrides, previews, outbound delivery,
  subscriptions, and alert events.
- [Helm and GitOps](./helm-gitops.md) covers chart rendering, Kustomize,
  kubeconform, probe contracts, chart release, and secret boundaries.
- [Deploy and CLI surfaces](./deploy-cli.md) covers Cloudflare/Docker deploys,
  post-deploy probes, the Rust CLI, TUI snapshots, local connections, and
  release artifacts.

## Feature entry contract

Each feature file starts with an H1 and one paragraph, then uses these four H2
sections in this order:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with CI`
4. `Gotchas`

Keep implementation details in the linked source files. Put user paths,
stable API shapes, workflow names, prerequisites, and observable results here.
