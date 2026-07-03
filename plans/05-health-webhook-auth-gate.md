# Plan 05: Add the missing write-auth self-gate to the anonymously-reachable health/webhook SSRF proxy

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> "STOP condition" occurs, stop and report — do not improvise. When done, update
> this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/routes/api/v1/health/webhook.ts apps/dashboard/src/routes/api/v1/health/webhook.test.ts apps/dashboard/src/routes/api/v1/insights/generate.ts`
> On any change, compare "Current state" against live code before proceeding; mismatch = STOP.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

`POST /api/v1/health/webhook` makes the **server** issue an outbound `POST` to a
caller-supplied URL with a caller-supplied body (`provider` + `payload` forwarded
verbatim). It is a state-changing, SSRF-capable egress route — but it has **no
write-auth gate**. The route file's own comment (`webhook.ts:17-18`) says per-route auth
was "dropped; centralized in middleware (#1397)", yet the codebase's documented contract
(see `insights/generate.ts:37-41`) is that *"the global /api/v1 middleware is a public
passthrough under provider='none' / CHM_CLERK_PUBLIC_READ, so this route must self-enforce
that anonymous callers cannot trigger it."* Sibling write routes (`insights/generate.ts`,
`actions.ts`, `dashboard/settings.ts`) all self-gate with `authorizeFeatureRequest`;
`health/webhook.ts` does not. Result: an **unauthenticated** caller can drive the server
to POST arbitrary bodies to arbitrary public HTTPS endpoints (confused-deputy / relay
abuse from the deployment's egress IP), and on Node self-hosts the SSRF host guard is
additionally defeatable via DNS-rebinding. This plan adds the auth gate — the certain,
cross-platform defect. (The DNS-rebinding hardening is deliberately a **separate** plan;
see Out of scope.)

## Current state

Files:
- `apps/dashboard/src/routes/api/v1/health/webhook.ts` — the proxy route. `handlePost` starts at `:62`; the `POST` handler is `:200-206`. No auth call anywhere (grep for `authorize` finds only the comment on `:17`).
- `apps/dashboard/src/routes/api/v1/insights/generate.ts` — the **exemplar** to copy. Its self-gate (`:28`, `:42-47`):

```ts
import { authorizeFeatureRequest } from '@/lib/feature-permissions/server'
// …
// Write gate: … the global /api/v1 middleware is a public passthrough under
// provider='none' / CHM_CLERK_PUBLIC_READ, so this route must self-enforce
// that anonymous callers cannot trigger it. A valid `chm_` API key still
// authenticates programmatic clients. Mirrors the /api/v1/actions guard.
const permissionResponse = await authorizeFeatureRequest(
  { feature: 'insights', defaultAccess: 'authenticated', operation: 'write' },
  request,
  { allowAgentBearerToken: true },
)
if (permissionResponse) return permissionResponse
```

- `apps/dashboard/src/routes/api/v1/health/webhook.test.ts` — existing test. It calls
  `__handlePostForTests(request, { resolveHostAddresses, fetchImpl })` with **no auth**;
  adding a gate will make these existing tests return the gate's response unless the gate
  is mocked to pass.

The route handler as it exists (`webhook.ts:200-206`):

```ts
export const Route = createFileRoute('/api/v1/health/webhook')({
  server: { handlers: { POST: async ({ request }) => handlePost(request) } },
})
```

Convention: pick the correct feature key. The webhook proxy backs the **alerting/settings**
surface (its port note at `:17` names `SETTINGS_FEATURE_PERMISSION`). Check
`apps/dashboard/src/lib/feature-permissions/permissions.ts` for the existing feature keys
(e.g. `settings`, `insights`, `actions`) and use the one that already governs health/alert
settings. Do NOT invent a new feature key unless none fits — if none fits, STOP and report.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Unit test | `cd apps/dashboard && bun test src/routes/api/v1/health/webhook.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |
| Grep gate present | `rg -n "authorizeFeatureRequest" apps/dashboard/src/routes/api/v1/health/webhook.ts` | ≥1 match |

## Scope

**In scope**:
- `apps/dashboard/src/routes/api/v1/health/webhook.ts`
- `apps/dashboard/src/routes/api/v1/health/webhook.test.ts`

**Out of scope** (do NOT touch):
- The `fetch` call at `webhook.ts:154-164` — the DNS-rebinding/socket-pinning hardening is **plan 13's SSRF-test companion + a separate follow-up**, and on Cloudflare Workers `createHostValidationFetch` throws for hostname targets (Slack/Discord are hostnames), so swapping it here would break the feature. Leave the outbound fetch exactly as-is.
- The `validateHostUrl` SSRF check (`:99`) — keep it; it stays as defense-in-depth.
- Any other route.

## Git workflow

- Branch: `advisor/05-health-webhook-auth-gate`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `fix(security): require write-auth on health/webhook SSRF proxy`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Add the self-gate at the top of `handlePost`

In `webhook.ts`, import `authorizeFeatureRequest` from `@/lib/feature-permissions/server`
and, as the **first** thing inside `handlePost` (before reading the body at `:68`), add
the gate mirroring `insights/generate.ts:42-47`, using the feature key you selected from
`permissions.ts` and `operation: 'write'`, `{ allowAgentBearerToken: true }`. Return the
permission response immediately if present. Keep the explanatory comment.

**Verify**: `rg -n "authorizeFeatureRequest" apps/dashboard/src/routes/api/v1/health/webhook.ts` → ≥1 match; `cd apps/dashboard && bun run type-check` → exit 0.

### Step 2: Keep the test harness able to inject an authorized/anonymous state

The gate reads auth from the `request`, not from injected deps, so the existing tests
would now fail (blocked before the SSRF logic). Mock the gate in `webhook.test.ts` with
`mock.module('@/lib/feature-permissions/server', …)` — mirror the `mock.module` style in
`apps/dashboard/src/routes/api/v1/webhooks/polar.test.ts:21-74` (stable wrapper delegating
to a per-test `let` binding so a test can flip it). Default the mock to **authorized**
(returns `null`) so all existing SSRF tests keep passing unchanged.

**Verify**: `cd apps/dashboard && bun test src/routes/api/v1/health/webhook.test.ts --isolate` → all existing tests pass.

### Step 3: Add the auth-gate regression tests

Add a `describe('health webhook proxy — auth gate', …)` with:
1. **anonymous is blocked, no egress** — set the mocked `authorizeFeatureRequest` to return a `401`/`403` `Response`; call `__handlePostForTests(makeRequest({url:'https://hooks.slack.com/x', text:'hi'}), { resolveHostAddresses: resolvePublic, fetchImpl })`; assert the returned status is the gate's status **and** `calls.length === 0` (the outbound `fetch` never ran).
2. **authorized passes through** — mocked gate returns `null`; the same request reaches the outbound fetch (`calls.length === 1`, `calls[0].url` is the Slack URL) and returns 200.

Reuse the existing `makeRequest`, `stubFetch`, `resolvePublic` helpers at `webhook.test.ts:8-30`.

**Verify**: `cd apps/dashboard && bun test src/routes/api/v1/health/webhook.test.ts --isolate` → all pass, including the 2 new tests; `bun run lint` → exit 0.

## Test plan

- New tests in `webhook.test.ts` per Step 3: anonymous→blocked+no-egress, authorized→forwarded.
- Structural pattern: the existing `webhook.test.ts` for request/fetch stubbing; `polar.test.ts:21-74` for `mock.module`.
- Verification: `cd apps/dashboard && bun test src/routes/api/v1/health/webhook.test.ts --isolate` → all pass.

## Done criteria

- [ ] `rg -n "authorizeFeatureRequest" apps/dashboard/src/routes/api/v1/health/webhook.ts` → ≥1 match
- [ ] `cd apps/dashboard && bun test src/routes/api/v1/health/webhook.test.ts --isolate` passes incl. the "anonymous blocked, no egress" test
- [ ] `cd apps/dashboard && bun run type-check` exits 0
- [ ] `cd apps/dashboard && bun run build` exits 0
- [ ] `bun run lint` exits 0
- [ ] The outbound `fetch` at `webhook.ts:154-164` is unchanged (`git diff` shows no edit there)
- [ ] `plans/README.md` status row updated

## STOP conditions

- No existing feature key in `permissions.ts` fits a health/alert-settings write (don't invent one silently — report the options).
- `authorizeFeatureRequest`'s signature differs from the `insights/generate.ts` exemplar (drift).
- Making the test authorized-by-default still breaks a pre-existing SSRF test for a reason other than the gate.

## Maintenance notes

- Reviewer: confirm the gate is `operation: 'write'` and runs **before** any body parse or egress; confirm no change to the SSRF `fetch`.
- Deferred out of this plan (own follow-up): DNS-rebinding hardening (pin the outbound socket to the validated address on Node; note the Workers hostname-pinning limitation). Plan 13 adds the missing tests for the pinning primitive (`createHostValidationFetch`) that a future rebinding fix would build on.
- If more `/api/v1` write routes are added, they must self-gate too until/unless the global middleware is changed to fail-closed on writes.
