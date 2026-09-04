# Plan 108: Rate-limit the unauthenticated device-code endpoints and enforce poll interval

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise.

> **Drift check (run first)**: `git diff --stat 34113ac..HEAD -- apps/dashboard/src/routes/api/v1/auth/device/ apps/dashboard/src/lib/auth/device-code-store.ts`
> On mismatch, re-read live files.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `34113ac`, 2026-08-26
- **Issue**: https://github.com/chmonitor/chmonitor/issues/3330

## Why this matters

The RFC 8628 device flow endpoints are deliberately public (exempt from the
`/api/v1` auth guard, `api-guard.ts:55–58`), but nothing throttles them:

- `POST /api/v1/auth/device/code` inserts one row per call into D1 (or the
  in-memory Map) with no per-IP limit and no cap on pending codes; the store
  purges expired entries only lazily on subsequent operations.
- `POST /api/v1/auth/token` stores `intervalSec` but never enforces it — no
  `slow_down` responses — so clients can poll as fast as they like (RFC 8628
  violation + write amplification).
- `status` polling is likewise unlimited.

Comparable unauthenticated surfaces in this repo (browser-connection sessions,
`/api/mcp`) DO enforce durable limits, so the pattern and precedent exist.

## Current state

`apps/dashboard/src/routes/api/v1/auth/device/code.ts:48–75` (excerpt):

```ts
async function handlePost(request: Request): Promise<Response> {
  const status = resolveDeviceLogin()
  if (!status.enabled) {
    return disabledResponse(status.reason)
  }

  let clientId = 'chm-cli'
  try { ...parse client_id... } catch { ...400... }

  const now = Date.now()
  const deviceCode = randomDeviceCode()
  const userCode = randomUserCode()
```

…then straight to insert. No limiter call anywhere in the route file.
`device-code-store.ts:103–116`: memory maps + `memoryPurgeExpired`;
D1 path similar (no proactive purge).

Existing durable limiter: `apps/dashboard/src/lib/api/rate-limiter.ts`
(`checkRateLimitDurable`, used by browser-connections sessions with key
namespace like `browser-conn:sessions:ip:`). Reuse it — same app, same D1/KV
infrastructure. Read its exact signature before wiring (it takes a request or
IP plus namespace/limit/window parameters; mirror the browser-connections
call site).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Targeted tests | `cd apps/dashboard && bun test src/routes/api/v1/auth src/lib/auth/device-code-store.test.ts --isolate` | pass |
| Full unit | `cd apps/dashboard && pnpm run test:unit` | pass |
| Typecheck | `pnpm run type-check` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/routes/api/v1/auth/device/code.ts` (limiter)
- `apps/dashboard/src/routes/api/v1/auth/device/token.ts` (slow_down enforcement)
- New test file for the rate-limit behavior

**Out of scope**:
- Changing the device-flow contract beyond adding standard `slow_down` responses (CLI already honors `interval` — verify in `rust/ch-monitor-cli/src/commands/auth.rs` if unsure; do not change CLI code)
- Store redesign / proactive purges
- approve.ts / status.ts handlers (add limiter only if trivially symmetric)

## Git workflow

- Branch: `advisor/108-device-code-rate-limit`
- Commit: `fix(auth): throttle device-code endpoints and enforce poll interval`

## Steps

### Step 1: Wire limiter into POST /device/code

At the top of `handlePost` (after the enabled check), add
`checkRateLimitDurable` under new namespace `'device-code'` (e.g. 10 requests/
hour/IP — pick values consistent with the browser-connections limiter's
generosity). On limit → `Response.json({ error: 'too_many_requests' }, { status: 429 })`.
Match how sessions.ts handles the failure response shape.

**Verify**: targeted test run passes with new tests (Step 3).

### Step 2: Enforce intervalSec in token.ts

In the pending-grant branch of the token handler, compare now vs the grant's
last-poll timestamp (`createdAt` or stored last-attempt — read the record
shape): if elapsed < `intervalSec`, return RFC 8628 `slow_down`:

```ts
Response.json({ error: 'slow_down', interval: intervalSec }, { status: 429 })
```

Do NOT update any timestamp on slow_down rejections except what the RFC
requires (increase interval by 5s per repeated slow_down if simple; otherwise
plain slow_down without state change — acceptable).

### Step 3: Tests

New file `apps/dashboard/src/routes/api/v1/auth/device/__tests__/rate-limit.test.ts`
(or co-located `code.test.ts` if that matches sibling layout better):
- 11th POST within an hour → 429 (mock the limiter store or use memory mode).
- token polled twice inside interval → second response 429 `slow_down`; after interval → normal pending response.
Pattern: existing route-level tests using createFileRoute-real/mock-collaborators style (see `routes/api/v1/webhooks/polar.test.ts`).

## Test plan

As above. All existing auth route tests must stay green.

## Done criteria

- [ ] `rg -n "checkRateLimitDurable" apps/dashboard/src/routes/api/v1/auth/device/code.ts` → present
- [ ] `rg -n "slow_down" apps/dashboard/src/routes/api/v1/auth/device/token.ts` → present
- [ ] New tests pass; `pnpm run test:unit` green; type-check green
- [ ] No out-of-scope files modified

## STOP conditions

- `checkRateLimitDurable` turns out to require infrastructure bindings unavailable in the dev/test environment such that existing session tests break → STOP, propose KV-memory fallback design.
- The token handler has no persisted last-poll timestamp to compare against → implement minimal addition ONLY if it stays within the existing store schema/migration pattern; otherwise STOP.

## Maintenance notes

- If CLI users report `slow_down`, check rust CLI honors `interval` bumping;
  the CLI already reads interval from the code response.
- Future: proactive expiry sweep job could replace lazy purging (separate idea,
  not planned here).
