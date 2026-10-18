---
name: pstack
description: >-
  Project-local pstack validation router for chmonitor. Use when proving a
  dashboard, API, auth or security, PeerDB, alerts and webhooks, Helm and
  GitOps, deployment, or CLI change. Prefer CI checks and capture observable
  evidence instead of running heavy local builds.
---

# chmonitor pstack validation

A project adapter to the pstack method. The feature map is
[features/README.md](features/README.md); the inventory and CI matrix are in
[docs/knowledge/pstack-validation.md](../../../docs/knowledge/pstack-validation.md).
Provenance and the pinned upstream copy are in [README.md](README.md).

The default proof is the CI run for the commit under review. A file that
parses, a build that used to pass, or a cached proxy result proves nothing.

## Rules

- CI owns installs, lint, type checks, tests, builds, browser setup, Rust,
  Helm rendering, and deploy checks. Do not run a heavy local `pnpm`, `bun`,
  `cargo`, `helm`, `docker`, or browser command by default.
- Drive stable user entry points. An internal setter, another route, or a
  mocked response does not stand in for the mapped feature.
- A missing path-filtered job is not a pass. Name the absent workflow and
  prerequisite.
- Label each result `verified`, `verified-unreachable`, `blocked`, or
  `pending`. Never turn a skipped or non-required check into `verified`.
- Keep credentials, cookies, keys, private webhook URLs, and response bodies
  that carry them out of commands, logs, and evidence.
- Expected UI state comes from [product-design](../product-design/SKILL.md);
  cloud, auth, and per-user boundaries from
  [cloud-saas-mode](../cloud-saas-mode/SKILL.md). Do not fix a UI proof by
  editing `components/ui/`.

## Drive

1. Map changed paths to a feature file:
   `git diff --name-only origin/main...HEAD`.
2. Read the CI result for the exact commit: `gh pr checks <PR> --watch=false`.
   Check the run's job list before deciding a surface was not exercised.
3. Drive the smallest mapped path that can fail for the claimed behaviour.
4. On failure, read `gh run view <RUN_ID> --job <JOB_ID> --log-failed` and
   quote the assertion, not an environment dump.
5. After a fix, re-run the same observation.

Post-deploy smoke uses the existing harness. Name the base URL, since the
default is production. CI injects `CHM_API_KEY_SECRET` for the authenticated
half; never copy it into a local shell or transcript:

```sh
cd apps/dashboard
bun scripts/verify-deploy.ts --base-url https://preview.dash.chmonitor.dev --skip-auth
```

Health endpoints differ: `/healthz` is static liveness, `/api/health` is the
minimal public check, `/api/healthz` is ClickHouse-gated readiness and may
return `503`. See [verify-production](../verify-production/SKILL.md).

A CLI proof uses `.cursor/skills/verify-chmonitor/scripts/` (`launch.sh`,
`doctor.sh`, `drive.sh`, `cleanup.sh`, `redact-check.sh`). It builds the Rust
binary, so run it only for a requested CLI proof, never to validate docs.

## Evidence

Record per feature: commit SHA, PR, workflow, job, and check status; the
entry point driven; expected and observed state; the log or artifact
location; the result label. A passing compile, lint, or unit test is evidence
for that check only.

Do not cancel shared workflows, kill processes by name, or change a hosted
connection to make a proof pass. Clean up only scratch state you created
(never the operator's `~/.config/chm`), and keep the proof artifacts.

Update the feature map and the knowledge doc together when a route, workflow,
or verification contract changes.
