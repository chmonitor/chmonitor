---
id: lockfile-security
title: Lockfile Security Refresh
type: workflow
status: active
updated: 2026-10-22
tags:
  - security
  - dependencies
  - pnpm
  - dependabot
related:
  - deployment
  - pstack-validation
---

# Lockfile Security Refresh

## Rule

A red `Dependabot Updates` workflow on `main` is a real signal, not noise. Each
failed job is a security advisory that Dependabot could not patch
(`security_update_not_possible`, "latest resolvable version" older than the
fixed one). It happens because the standalone workspaces (`apps/landing`,
`blog`, `docs`, `dashboard`, `telemetry`, `bug-handler`, `cloud-hooks`,
`.deepsec`, plus the root) each have their own `pnpm-lock.yaml`, and a
transitive package locked months ago is never bumped on its own.

Run `scripts/audit-lockfiles.sh` to see what is actually vulnerable per
lockfile. On 2026-10-22 it reported 1 to 28 advisories per lockfile (one
critical in `apps/blog`, 9 to 15 high in each static site); #4087, #4088,
#4089, #4090 and the `cloud-hooks` follow-up brought every lockfile to 0 except
the cases below.

## Procedure

1. Audit: `scripts/audit-lockfiles.sh [dir]`.
2. Update only the flagged packages, not everything:
   `pnpm update <pkg...> --depth 10 --lockfile-only` in a **scratch copy**
   (lockfile, manifests, `pnpm-workspace.yaml`, and the `packages/*`
   manifests for apps that use `workspace:*`).
3. Re-audit. What remains is usually `sharp` under `wrangler > miniflare` (or
   `@cloudflare/vite-plugin > miniflare`), which pins an affected 0.34 line.
   Add `overrides: sharp: ^0.35.5` to that app's `pnpm-workspace.yaml`.
4. Copy the lockfile (and any changed manifest line) into a worktree, then check
   `pnpm install --frozen-lockfile --lockfile-only` in each directory under its
   pinned pnpm.
5. One PR per group of apps; watch the per-app workflows (`landing`, `blog`,
   `docs`, `cloud-hooks`, `bug-handler`), which are not required checks.

## Traps

- **Do the update with the newer global pnpm, outside the repo tree.** The
  committed lockfiles were written by a newer pnpm than the pinned 10.18.0
  (root `packageManager`). pnpm 10.18 drops the `libc` fields that choose glibc
  versus musl native binaries. Inside the repo the corepack shim always selects
  the pinned version, so run the update in a scratch directory with no
  `packageManager` field. Check that no retained package lost `libc`.
- **`apps/cloud-hooks` and `apps/dashboard` link `packages/*`.** The scratch copy
  needs the `packages/*` manifests. `cloud-hooks` has no `packages:` entry in its
  committed workspace file; temporarily add `packages: ['../../packages/*']` in
  the scratch copy only (it reproduces the committed importers) and keep the
  real file unchanged apart from the override.
- **A pnpm override does not move an auto-installed peer.** In `.deepsec` the
  `@modelcontextprotocol/sdk` copy came in as a peer of
  `@anthropic-ai/claude-agent-sdk`. The fix was a direct dependency in
  `.deepsec/package.json`; an override that disagrees with that direct range
  makes pnpm 11 report `ERR_PNPM_OUTDATED_LOCKFILE`.
- **`pnpm update <direct dep>` bumps the manifest range** (for example
  `vite ^8.0.16` to `^8.3.4`). That is intended, since it raises the floor.

## Known remaining

- `extract-zip <= 2.0.1` (high, no patched version) through
  `@cloudflare/puppeteer > @puppeteer/browsers` in `apps/dashboard`.
- `katex` below 0.18.2 (low) through `mermaid` in `apps/dashboard` and
  `apps/docs`; the fix crosses `mermaid`'s range.

## Release PRs

Release-please PRs (`chore(main): release ...`) are never merged by agents,
including after a security refresh.
