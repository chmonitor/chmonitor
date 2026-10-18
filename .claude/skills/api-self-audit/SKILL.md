---
name: api-self-audit
description: >-
  Hunt for chmonitor API routes that ship without an auth guard, and triage
  each one: guard it, or allowlist it with a reason. Use when adding or
  changing a route under apps/dashboard/src/routes/api/, when
  auth-guard-coverage.test.ts fails, when allowlisting a public route in
  PUBLIC_ROUTES, or when reviewing auth on an API change.
---

# API self-audit

The check is `apps/dashboard/src/routes/api/__tests__/auth-guard-coverage.test.ts`.
It runs in the required `unit-tests` job.

```sh
cd apps/dashboard && bun test src/routes/api/__tests__/auth-guard-coverage.test.ts
```

## What it checks

It reads every `routes/api/**/*.ts` (not tests) that has `server.handlers`,
takes the path from `createFileRoute('...')`, and decides:

- **Middleware covers it**: a GET on a `/api/v1/*` path that is not in the
  exemption list in `lib/auth/api-guard.ts` (the `*_PATH` constants, parsed
  from that file). `start.ts` runs `resolveApiGuard` on these.
- **Needs a route guard**: any non-v1 path, any exempt v1 path, and any
  POST/PUT/PATCH/DELETE. Writes need one even under v1, because in Clerk
  public-read mode the middleware lets every `/api/v1/*` request through and
  leaves writes to the route.

A route that needs a guard passes when its file calls a name in `GUARDS`
(`name(`, after comments and import lines are stripped; a mention in a comment
or an import does not count), or its path is in `PUBLIC_ROUTES` or `READ_ONLY_POSTS`. The check is per
file: one guard anywhere in the file counts for all its handlers. When a file mixes a public GET with a guarded POST, read it.

## Triage a failing route

1. **Guard it** (the default). Pick the guard that matches the caller:
   - dashboard data and writes: `authorizeFeatureRequest` (`lib/feature-permissions/server.ts`)
   - non-v1 state change: `enforceAuth`; deployment metadata: `isAuthenticatedRequest` (`lib/auth/api-guard.ts`)
   - per-user storage: the fail-closed owner resolver for that store (`resolveUserId` and friends)
   - cron: `authorizeCronRequest` (Bearer `CRON_SECRET`)
   - third-party webhook: the provider's signature check (`verifyWebhook`, `verifyGithubSignature`, `readAndVerifySlackRequest`, Polar `validateEvent`)
   - agent / insights: `authorizeAgentApiRequest`, `authorizeInsightsGenerateRequest`
2. **Allowlist it** only when it is public by design: health probes, version,
   discovery documents, RFC 8628 device-flow steps, capability-slug reads. Add
   the path to `PUBLIC_ROUTES` with a one-line reason.
3. **v1 POST that only reads** (a body for tokens, no write): `READ_ONLY_POSTS`.
4. **Unsure, or looks sensitive**: do not allowlist it. Guard it, or ask the
   maintainer; keep exploit detail out of the public repo and the PR.

## Adding a guard name

Add it to `GUARDS` only if it rejects the caller when there is no valid
identity or secret (returns 401/403 or throws an UNAUTHORIZED error). A
resolver that falls back to an anonymous id is not a guard. Removed for that
reason: `resolveAlertRoutingOwnerId` (returns `''`), `resolveCustomRuleOwnerId`
(`'oss'`), `resolveRegistryUserId` and `resolveAgentUserId` (`'guest'`),
`resolveOwnerId` (catches and returns `''`), and `authenticateRequest` (the
`none` provider always passes). Read the function body before adding a name.

## Keeping the lists honest

The test fails when an allowlist entry names a route that no longer exists,
is now middleware-covered, or now calls a guard. Delete the entry then.
The lists may not overlap.

To prove a change to the test still bites: rename a guard call in one route
locally, run the test, see it fail, then `git checkout` the route.
