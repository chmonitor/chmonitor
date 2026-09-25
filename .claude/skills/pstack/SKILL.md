---
name: pstack
description: >-
  Project-local pstack validation router for chmonitor. Use when proving a
  dashboard, API, auth or security, PeerDB, alerts and webhooks, Helm and
  GitOps, deployment, or CLI change. Prefer CI checks and capture observable
  evidence instead of running heavy local builds.
---

# chmonitor pstack validation

This is a project-local adapter to the pstack method from
[`michael-denyer/pstack-claude`](https://github.com/michael-denyer/pstack-claude).
The adapter adds chmonitor's CI-first validation contract and feature map; it
also has a pinned, supplemental copy of the upstream skills-only tree at
[`upstream/`](upstream/). The source, loading boundary, and provenance are
documented in [README.md](README.md) and [`upstream/SOURCE.md`](upstream/SOURCE.md).
The maintained feature map starts at [features/README.md](features/README.md),
and the inventory and CI matrix are in
[`docs/knowledge/pstack-validation.md`](../../../docs/knowledge/pstack-validation.md).

Use this skill as the project rule for validation. The default proof is the
CI run for the commit under review. Do not infer that a change works because a
local file parses, a build used to pass, or a proxy reports a cached result.

## Operating rules

- CI owns dependency installation, lint, type checks, unit tests, builds,
  browser test setup, Rust builds, Helm rendering, and deployment checks.
- Do not start a local app, install a QA toolchain, or run a heavy
  `pnpm`, `bun`, `cargo`, `helm`, `docker`, or browser command by default.
  Use the matching workflow and capture its job result instead.
- Use stable user entry points and observable state. Do not use internal
  setters, a different route, or a mocked response as a substitute for the
  mapped feature.
- A missing path-filtered job is not a pass. Record the exact workflow, trigger,
  and prerequisite that were absent.
- Use `verified`, `verified-unreachable`, or `blocked` as the result. Never
  silently turn a skipped or non-required check into `verified`.
- Keep credentials, cookies, API keys, passwords, private webhook URLs, and
  full response bodies containing them out of commands, logs, and evidence.
- The parent OpenCode runtime owns the model choice. This skill does not
  override the configured model or add Claude-only slash commands.

## UI and mode contracts

Use the product-design and cloud-saas-mode skills as the expected-state
reference while reviewing CI evidence. In particular, a dashboard proof should
respect the existing semantic-token and shadcn boundary, the `?host=N` route
contract, hooks at the deepest consumer, the shared loading/empty/error
states, and the stale-data behavior. Do not “fix” a UI proof by editing
`components/ui/` or by creating a new visual primitive in this skill.

For cloud and auth claims, keep OSS and Cloud behavior distinct. Public demo
visibility, hidden demo data for signed-in users, per-user connection
isolation, and anonymous guest-agent exceptions are contracts to test, not
alternate interpretations of a failed response.

For dashboard UI expectations, read the sibling
[`product-design` skill](../product-design/SKILL.md). For cloud, auth, and
per-user connection boundaries, read
[`cloud-saas-mode`](../cloud-saas-mode/SKILL.md). The older
[`verify-chmonitor` skill](../../../.cursor/skills/verify-chmonitor/SKILL.md)
is still the detailed local CLI/TUI recipe. Use it only for a requested CLI
proof, not as a substitute for the CI matrix.

## Launch

For a pull request, launch means identifying the CI run for the exact commit.
Start with file inspection and the checks API:

```bash
git status --short --branch
git diff --name-only origin/main...HEAD
gh pr checks <PR> --watch=false
```

Map changed paths to the workflows in the feature file. A deployment change
can be path-filtered, so also inspect the run's job list before deciding that a
surface was not exercised.

For a post-deploy smoke proof, use the existing dashboard harness from its
package directory. The unauthenticated form needs no secret:

```bash
cd apps/dashboard
bun scripts/verify-deploy.ts --skip-auth
```

The Cloudflare workflow supplies `CHM_API_KEY_SECRET` only inside CI and calls
the same script for its authenticated deployment check. Do not copy that
variable into a local shell, a commit, or a transcript.

A CLI proof has a different launch model. The existing helper builds this
checkout's Rust binary, so it is optional and heavier than the CI path:

```bash
.cursor/skills/verify-chmonitor/scripts/launch.sh
```

Do not run the helper merely to validate documentation. The Rust workflow owns
the normal build and test proof.

## Doctor

Run a read-only identity and scope check before interpreting a result:

```bash
git status --short --branch
git diff --check
gh pr checks <PR> --watch=false
```

For an approved live deployment, distinguish the three health contracts before
making a claim:

- `GET /healthz` is the static process liveness endpoint.
- `GET /api/health` is the minimal public deployment health response.
- `GET /api/healthz` is ClickHouse-gated readiness and may return `503` while
  the monitored database is unavailable.

Use the current workflow URL and the existing
[`verify-deploy.ts`](../../../apps/dashboard/scripts/verify-deploy.ts) rather
than inventing a request or copying a secret-bearing curl. For the CLI, the
identity-only doctor helper is
`.cursor/skills/verify-chmonitor/scripts/doctor.sh`; it does not contact the
hosted dashboard by default. A failed connectivity row after an identity pass
is a separate observation, not proof of a wrong binary.

## Drive

1. Read the matching file under [`features/`](features/README.md).
2. Choose the CI job that owns the changed surface. Prefer required checks for
   merge claims and use informational checks as supporting evidence.
3. Drive the smallest mapped path that can fail for the claimed behavior.
4. If the job is pending, report `pending`, not `verified`. If its prerequisite
   is absent, report `verified-unreachable` with the route or command attempted
   and the unmet prerequisite.
5. Re-run the same observation after a fix. Do not claim that a proxy, a test
   fixture, or a different surface repaired the original failure.

The feature files name the concrete workflow paths, route shapes, and test
families. They do not ask an agent to run a local build as a substitute for a
red or absent CI job.

## Evidence

For each feature, record the following in the handoff or an uncommitted run
note:

- commit SHA, pull request, workflow, job, and check status;
- the user entry point or API route driven;
- the expected state and the state actually observed;
- the CI log or artifact location, when one exists;
- the result label: `verified`, `verified-unreachable`, or `blocked`.

A useful failure citation includes the assertion, route, and job output rather
than a generic “CI passed.” For a deployed smoke check, save the JSON report
from `verify-deploy.ts` in a protected scratch location and redact it before
sharing. A compile, lint, or passing unit test is evidence for that check only;
it is not evidence that a UI, external service, or webhook behaved correctly.

When a check fails, inspect the durable record first. The repository documents
`gh run view <RUN_ID> --job <JOB_ID> --log-failed` for failed-job logs. Quote
the relevant output, not a secret-bearing environment dump.

## Cleanup

CI runs and deployed workers are shared infrastructure. Do not cancel a shared
workflow, kill a process by name, or mutate a hosted connection to make a proof
look better.

If the optional local CLI helper was used, tear down only the session and
scratch state that it created:

```bash
.cursor/skills/verify-chmonitor/scripts/cleanup.sh
```

Keep proof artifacts. Remove temporary browser profiles, local config scratch,
and test doubles after they have been checked for secrets. Never remove the
operator's normal `~/.config/chm` or a shared deployment as cleanup.

## Helpers

Use helpers only when their source is present in this checkout and their output
can be redacted.

| Helper | Use | Boundary |
| --- | --- | --- |
| `gh pr checks <PR> --watch=false` | Read the current CI result | The normal project proof. |
| `gh run view <RUN_ID> --job <JOB_ID> --log-failed` | Inspect a failed job | Do not paste secrets. |
| `apps/dashboard/scripts/verify-deploy.ts` | Probe a live Worker | CI injects credentials; `--skip-auth` is the local safe form. |
| `.cursor/skills/verify-chmonitor/scripts/doctor.sh` | Prove CLI binary identity | Optional local helper; not the merge gate. |
| `.cursor/skills/verify-chmonitor/scripts/drive.sh` | Drive one mapped CLI feature | Requires the isolated CLI setup. |
| `.cursor/skills/verify-chmonitor/scripts/cleanup.sh` | Remove helper-created state | Preserve evidence. |
| `.cursor/skills/verify-chmonitor/scripts/redact-check.sh` | Check a CLI evidence directory | Run only on a redacted copy. |
| `.claude/skills/ui-ux-audit/` | Manual broad browser audit | Legacy target details; not the default CI path. |

Keep the local feature map and
[`docs/knowledge/pstack-validation.md`](../../../docs/knowledge/pstack-validation.md)
in sync when a route, workflow, or verification contract changes.
