---
id: pstack-validation
title: Project-local pstack validation
type: workflow
status: active
updated: 2026-09-25
tags:
  - verification
  - pstack
  - ci
  - dashboard
  - api
  - peerdb
  - webhooks
  - helm
  - cli
related:
  - conventions
  - product-design
  - cloud-saas-mode
  - standalone-cli
  - deployment
  - component-ci-stability
  - api-hostid-validation
  - k8s-health-probes
---

# Project-local pstack validation

## Decision

chmonitor uses a project-local pstack adapter at
`.claude/skills/pstack/` and a feature map under
`.claude/skills/pstack/features/`. The adapter makes validation a repository
convention without vendoring the upstream plugin or changing the generated
end-user agent registry.

CI owns dependency installation, lint, type checks, unit tests, builds,
browser test setup, Rust checks, Helm/Kustomize rendering, and deployment
probes. Agents should inspect source, map changed paths to workflows, and read
CI evidence before starting a local application or running a heavy command.
A compile, a parser check, a fixture, or a cached response is evidence only
for the narrow thing it actually exercised.

The project skill is the agent-facing contract. This note is the durable
inventory and review record.

## Upstream pstack research

Researched against [`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude)
on 2026-09-25. The observed upstream `VERSION` was `0.9.44`; upstream `main`
continues to move.

- The supported portable boundary is
  `plugins/pstack/skills`, not the plugin root.
- The skills-only install carries skill directories, scripts, portable agent
  references, and license notices.
- The Claude SessionStart hook, Codex prompt stubs, and Claude native subagent
  registration are runtime/plugin concerns outside that boundary.
- OpenCode's shared discovery location is `~/.agents/skills`. The repository's
  tracked adapter lives under `.claude/skills/pstack` so it is visible with the
  checkout and stays out of `.agents/skills`, which is scanned for the
  dashboard's end-user agent skills.
- The upstream skills CLI install documented by the project is:

  ```bash
  npx skills add https://github.com/michael-denyer/pstack-claude/tree/main/plugins/pstack/skills --skill "*" --agent "*" --yes
  ```

This command is project-scoped by default with the current `skills` CLI and
can write agent-specific project directories such as `.claude/skills/` and
`.agents/skills/`. It was not run for this repository change. The project does
not regenerate or edit
`apps/dashboard/src/lib/ai/agent/skills/registry.ts`.

## Existing validation inventory

| Existing source | What it proves | Review result and gap |
| --- | --- | --- |
| `.cursor/skills/verify-chmonitor/SKILL.md` and `features/` | CLI/TUI identity, doctor, local named connections, snapshots, isolated config, evidence and cleanup | Strong CLI-first recipe. Its dashboard is secondary and its launch helper builds Rust. Keep it for explicit CLI drives; do not use it as the CI matrix. |
| `.cursor/skills/verify-chmonitor/scripts/launch.sh` | Builds this checkout's `chm` binary and writes identity metadata | Optional and heavy. CI Rust jobs are the default proof. |
| `.cursor/skills/verify-chmonitor/scripts/doctor.sh` | Binary identity by default; optional HTTP or cluster checks | Useful read-only helper. A failing hosted connectivity row is separate from identity. |
| `.cursor/skills/verify-chmonitor/scripts/drive.sh` | One local CLI/TUI feature at a time | Requires the isolated CLI setup. Useful only when a live CLI claim is requested. |
| `.cursor/skills/verify-chmonitor/scripts/cleanup.sh` and `redact-check.sh` | Removes helper-created sessions/scratch state and checks evidence for secrets | Reuse rather than reimplementing. Preserve evidence. |
| `.claude/skills/verify-deploy.md` | Intended post-deploy smoke instructions | Legacy. It names the old `apps/dashboard-tsr` and `dash-tsr` surfaces and old migration wording. The current source is `apps/dashboard/scripts/verify-deploy.ts`; the new skill points there. |
| `.claude/skills/ui-ux-audit/SKILL.md` and `scripts/` | Broad route discovery, console/network checks, overflow, skeletons, axe, screenshots, visual diffs, traces | Valuable manual harness. Its live defaults and account-specific login helper are legacy, and `setup.sh` installs an external toolchain. It is not the default CI proof. |
| `.agents/skills/plan-and-verify/SKILL.md` | Explicit planning and narrow-window verification discipline | The requested `.claude/skills/plan-and-verify` path does not exist. The real file is under `.agents/skills` and is allowlisted in the generated registry. Do not move or duplicate it for this task. |
| `.claude/skills/product-design/SKILL.md` and `docs/knowledge/product-design.md` | Stable UI states, tokens, responsive behavior, navigation, loading/error/empty conventions | Use as the expected-state contract for UI proof. It is not an executable test harness. |
| `.claude/skills/cloud-saas-mode/SKILL.md` and `docs/knowledge/cloud-saas-mode.md` | Cloud versus OSS auth, demo-host visibility, per-user connections, guest agent boundaries | Use when interpreting API/auth and dashboard states. It has no independent live driver. |
| `apps/dashboard/scripts/verify-deploy.ts` | Live Worker health, page shell, client bundle, anonymous auth gate, optional CI-injected authenticated ClickHouse proof | Current post-deploy helper and the source used by `cloudflare.yml`. It is not a full UI or PeerDB sweep. |
| `scripts/smoke-test.ts` | Chart-level live smoke across discovered hosts | CI runs it as an informational chart smoke with an explicit base URL. Its script default is not the canonical project proof. |
| `apps/dashboard/scripts/page-sweep-parity.test.ts` and `cypress/e2e/page-render-sweep.cy.ts` | Route-list parity and broad dashboard shell rendering | Strong CI coverage for route crashes. It does not prove live data or complete visual quality. |
| `apps/landing/scripts/verify-landing-structure.ts` and `apps/docs/scripts/smoke-crawl.mjs` | Ancillary landing/docs structural or browser smoke | Separate app surfaces. They are not substitutes for dashboard UI proof. |
| `deploy/helm/chmonitor/tests/test-alert-webhooks.sh` | Helm custom-webhook rendering, secret references, format and HTTPS rejection | Focused GitOps contract, run by `k8s-lint.yml`; it does not send a live webhook. |
| `scripts/peerdb-mock-server.ts` | Static read-only PeerDB fixture for local UI exploration | Explicit test double. It does not validate auth or a real PeerDB deployment. |
| `.claude/hooks/validate-query-config.sh` | Lightweight post-edit warning for `name` and `sql` fields | Heuristic only. It is not a substitute for query-config CI tests. |
| `.github/workflows/ci.yml` and `base.yml` | Build, lint, dependency boundaries, Docker build and release container checks | Core artifact proof. It does not cover Helm or CLI unless its path/job runs. |
| `.github/workflows/test.yml` | Unit coverage, query-config integration, Postgres integration, Cypress E2E, API smoke | `unit-tests` is the repository's required test owner; the other jobs are supporting or service-dependent evidence. |
| `.github/workflows/cloudflare.yml` | Dashboard/worker build, test type-check, deploy, secret ordering, verify-deploy, chart smoke | Deployment owner. PR and production bases and path filters must be recorded. |
| `.github/workflows/a11y.yml` | Representative-route WCAG 2 A/AA axe scan | Useful supporting evidence; explicitly non-required and only five routes. |
| `.github/workflows/bundle-size.yml` | Cloudflare gzip budget from a Wrangler dry run | Informational artifact check; not a behavior proof. |
| `.github/workflows/agent-eval.yml` | Live promptfoo agent behavior and safety eval | Path-filtered and informational; may skip without live secrets. |
| `.github/workflows/cli-rust-ci.yml` | Rust fmt, clippy, workspace build/tests, publish dry run | Path-filtered CLI proof. |
| `.github/workflows/cli-report.yml` and `cli-rust-release.yml` | CLI target size/version/help metrics and release artifacts | Release evidence, not a live dashboard proof. |
| `.github/workflows/k8s-lint.yml` and `helm-release.yml` | Helm/Kustomize schema/render checks and chart publication | Path-filtered; chart release runs on `main`, not as a PR substitute. |
| `docs.yml`, `landing.yml`, `blog.yml`, `release.yml`, `release-please.yml`, `cargo-publish.yml`, `pr-title.yml`, `labeler.yml`, `claude*.yml` | Ancillary app, release, metadata, and automation checks | Reviewed for routing; they are not dashboard feature proof unless the changed surface is theirs. |

## Gaps closed by the project-local adapter

- There was no single CI-first feature map spanning dashboard, API/auth,
  PeerDB, webhooks, Helm/GitOps, deployment, and CLI behavior.
- The current CI has strong structural/unit coverage but no configured live
  PeerDB or external webhook delivery proof. The new map labels those paths
  `verified-unreachable` unless an approved environment is named.
- UI coverage is split between a broad shell sweep, five-route axe scan, and
  a legacy manual browser harness. The new map states what each proves and
  does not prove.
- Deployment and CLI evidence were in separate helpers and workflows. The new
  deploy/CLI feature records the artifact, job, and live boundary together.
- The old `verify-deploy` and `ui-ux-audit` instructions contain historical
  app names. The new adapter points to current paths and keeps the old skills
  as legacy references rather than silently copying their assumptions.

## Validation matrix

| Surface | CI owner and trigger | Evidence to record | Boundary |
| --- | --- | --- | --- |
| Dashboard shell and navigation | `test.yml` `e2e-test` on PR/push; `unit-tests` route parity | Route list, `?host=0` state, no uncaught exception, URL transition | Loading/error shells are valid; no live data guarantee |
| Dashboard accessibility | `a11y.yml` `axe-core` on PR/push | Checked routes and WCAG findings | Non-required; representative routes only |
| API/auth/security | `test.yml` `unit-tests`; `cloudflare.yml` `dashboard` verify step | Route, method, status class, auth posture, redacted response shape | Mocked unit evidence is not an external service proof |
| PeerDB | `test.yml` `unit-tests`; `agent-eval.yml` only on its path filter | Mocked versus live source, tool gate, status/metrics shape, ownership/cache result | No real PeerDB is assumed |
| Custom webhooks | `test.yml` `unit-tests`; `k8s-lint.yml` `helm` fixture | Preview/send distinction, masked target, SSRF/auth result, Helm render | No third-party delivery is assumed |
| Helm/GitOps | `k8s-lint.yml` on `deploy/helm/**` or `deploy/kubernetes/**`; `helm-release.yml` on `main` | Chart/overlay path, rendered kinds, Kubernetes version, release result | Render is not cluster rollout |
| Cloudflare/Docker deploy | `cloudflare.yml` `dashboard`; `ci.yml` Docker jobs | Base URL or artifact, build/deploy conclusion, verify step | Build/deploy is not proof of every user feature |
| Rust CLI | `cli-rust-ci.yml` on `rust/**`; `cli-report.yml` | Job conclusion, target metrics, version/help output | Artifact proof is not live TUI proof |
| Agent behavior | `agent-eval.yml` on its path filter | Eval tags, skip reason or result artifact | Informational and secret-dependent |

## Agent handoff

Read `.claude/skills/pstack/SKILL.md` first, then the matching file in
`.claude/skills/pstack/features/`. Update this note and the feature map when a
route, workflow, security boundary, or external prerequisite changes. Keep
product behavior fixes separate from validation-doc drift: a real product
regression is reported with its evidence, not hidden by changing the map.
