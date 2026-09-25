# Deploy and CLI surfaces

The product has two delivery surfaces that can be observed independently: the
Cloudflare/Docker dashboard deployment and the standalone Rust `chm` CLI. CI
owns their builds; this feature records the evidence needed before calling a
deploy or CLI change proven.

## Sub-features

- `cloudflare-preview` builds a preview Worker, runs dashboard type checks,
  deploys, and verifies the public and authenticated surfaces.
- `cloudflare-production` applies the documented D1 migration order and
  production deployment on `main` or release.
- `docker-image` builds the image and validates the shipped container's root,
  health, and version endpoints on the relevant release path.
- `deploy-defaults` keeps OSS and Cloud mode defaults aligned between runtime
  resolution and the deploy-time environment projection.
- `cli-build` checks Rust formatting, clippy, workspace build, tests, and crate
  metadata for Rust changes.
- `cli-artifacts` records release-target size, version, help, and startup
  metrics in the CLI report.
- `cli-runtime` covers `chm doctor`, local named connections, TUI snapshots,
  auth discovery, and dashboard API helpers.
- `cli-cleanup` keeps local credentials and scratch config out of evidence.

## How to get to it (user POV)

- A dashboard user reaches the deployed app at the preview or production URL
  and should see the HTML shell and a valid health response.
- A self-hosting operator can run `chm --version`, `chm doctor`, and the
  documented `chm add`, `ls`, `use`, and `rm` commands without creating a
  dashboard connection.
- A CLI user can run the TUI or one-shot JSON snapshot, inspect dashboard
  hosts/charts/tables, and use the auth method returned by
  `GET /api/v1/auth/cli`.
- Release consumers use the published Worker, Docker image, chart, or CLI
  artifact; the source checkout is not the release artifact.

## Driving it with CI

Preconditions:

- Use the workflow job that owns the changed path. Do not deploy from this
  documentation worktree.
- A live base URL must come from the workflow or an approved environment, not
  from an invented hostname.

- **Dashboard deploy.** Inspect `.github/workflows/cloudflare.yml`, job
  `dashboard`, for the path-filtered build, `type-check:test`, deploy, secret,
  `Verify deployment`, and chart smoke steps. PRs use the documented preview
  base; non-PR releases use the production base. The required evidence is the
  job conclusion plus the verification step, not just `wrangler deploy`.
- **Build and Docker.** Inspect `.github/workflows/ci.yml` and its reusable
  `.github/workflows/base.yml` for `build`, `lint`, dependency boundaries,
  Docker build, and the main/release container validation. The container check
  reads `/`, `/api/healthz`, and `/api/version` from the built artifact.
- **Deploy-mode tests.** `unit-tests` covers
  `apps/dashboard/scripts/deploy-defaults.test.ts` and the Cloudflare patch
  behavior. A passing worker build does not prove that the runtime env
  projection matches the mode resolver.
- **CLI build.** In `.github/workflows/cli-rust-ci.yml`, inspect `cargo fmt`,
  `cargo clippy`, workspace build, workspace tests, and the crate publish dry
  run for Rust changes. The path filter means a non-Rust change does not run
  this job.
- **CLI report and release.** Inspect `.github/workflows/cli-report.yml` for
  per-target build metrics and `.github/workflows/cli-rust-release.yml` for
  release publication. The report is evidence of artifact shape, not a live
  dashboard integration.
- **Optional local CLI drive.** The existing
  `.cursor/skills/verify-chmonitor/scripts/launch.sh`,
  `doctor.sh`, `drive.sh`, and `cleanup.sh` provide an isolated local-connection
  and TUI proof when explicitly requested. They build Rust and are not the
  default validation path. Use the script's scratch config and redaction
  helper; never use the operator's normal config.
- **Evidence.** Record the workflow/job, commit SHA, artifact or base URL,
  command output or CI log location, and the difference between build proof
  and live behavior. Redact every credential.

## Gotchas

- Root `pnpm run cf:health` calls the ClickHouse-gated `/api/healthz`; it can
  report `503` when the monitored source is down even if the Worker is alive.
- Docker health uses the static `/healthz` contract in
  `docker-compose.yml`. Do not substitute it for readiness without saying so.
- A preview deploy is not production. Record the base URL and event type with
  every `verify-deploy` result.
- CI path filters can skip the Cloudflare, Rust, agent, or Helm job when the
  relevant files did not change. Inspect the run rather than assuming a green
  absent check.
- `chm doctor` with a ClickHouse host is a cluster scan. With the host unset it
  checks CLI and dashboard connectivity. The two JSON shapes are different.
- A local `chm add` is a local-store operation and does not create a dashboard
  host. `chm hosts` is the dashboard API and is not proof of `chm add`.
- Do not run `chm auth login`, deploy, apply a chart, or send a webhook merely
  to complete this matrix. Those actions need their own approval and evidence.
- Keep the CLI credentials file, browser profile, and scratch config out of
  screenshots, logs, and commits.
