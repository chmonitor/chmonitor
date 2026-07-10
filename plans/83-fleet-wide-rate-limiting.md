# Plan 83: Fleet-wide rate limiting for public/anonymous endpoints

> **Executor instructions**: Follow step by step; verify each. STOP conditions
> binding. Update `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 070f5fe0a..HEAD -- apps/dashboard/src/lib/api/rate-limiter.ts`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (interface-preserving; OSS fallback unchanged)
- **Depends on**: none
- **Category**: security
- **Related issue**: #2467 (same file: unbounded bucket Map growth — fix together)
- **Planned at**: commit `070f5fe0a`, 2026-07-10
- **Issue**: https://github.com/chmonitor/chmonitor/issues/2500

## Why this matters

Rate limiting is a per-isolate in-memory `Map` — its own comment says "Lives
for the lifetime of the isolate" and calls it a best-effort first pass.
Cloudflare Workers spread traffic across many short-lived isolates, each with
fresh buckets, so "N per minute" is not enforced fleet-wide. This is the ONLY
abuse guard on several anonymous surfaces: the public dashboard share-link view
(`routes/api/dashboards/share.$slug.ts` ~lines 56-63), the anonymous
`pageview` ClickHouse INSERT (`routes/api/pageview.ts` ~lines 39-63, its own
separate Map), the public chart GET, and the agent route's burst guard
(`routes/api/v1/agent.ts` ~lines 306-308; agent *cost* is separately capped by
D1 meters, so that one is UX only). Open issue #2467 additionally notes the
Map grows unbounded for the isolate's lifetime.

## Current state

`apps/dashboard/src/lib/api/rate-limiter.ts:28-29`:

```ts
/** Shared in-memory store. Lives for the lifetime of the isolate. */
const buckets = new Map<string, Bucket>()
```

Read the whole file for the `checkRateLimit(key, opts) → { allowed, retryAfterSec }`
contract (the interface to preserve). Platform bindings pattern to follow:
`packages/platform/src/adapters/*` (how D1/DO bindings are resolved with a
null fallback). `wrangler.toml` currently declares no rate-limit binding.

## Commands you will need

| Purpose | Command | Expected |
|---------|---------|----------|
| Build | `cd apps/dashboard && pnpm run build` | exit 0 |
| Tests | `cd apps/dashboard && bun test src/lib/api` | all pass |
| Wrangler dry-run | `cd apps/dashboard && pnpm exec wrangler deploy --minify --dry-run` | exit 0 |

## Scope

**In scope**: `lib/api/rate-limiter.ts` (adapter seam + LRU/TTL eviction for
the in-memory fallback, closing #2467), `wrangler.toml` (add the
[unsafe.bindings] rate-limit binding — Cloudflare's Rate Limiting API), the
platform binding resolution, tests.

**Out of scope**: changing any endpoint's limits/keys; Durable Objects (only
if the native Rate Limiting binding is unavailable — see STOP); billing meters.

## Git workflow

- Branch: `advisor/83-fleet-wide-rate-limiting`
- Commit: `feat(api): fleet-wide rate limiting via CF binding with in-memory fallback`
- Trailer: `Co-Authored-By: duyetbot <bot@duyet.net>`

## Steps

### Step 1: Bound the in-memory fallback (fixes #2467)
Add max-size eviction (e.g. 10k entries, evict oldest by `lastRefillMs`) and
opportunistic expiry sweep to the existing Map path.
**Verify**: new unit test — 10k+1 inserts keeps size ≤ 10k; `bun test src/lib/api` pass.

### Step 2: Add the binding-backed path
Introduce an internal adapter: if a Cloudflare rate-limit binding (e.g.
`CHM_RATE_LIMITER`) is present in the Worker env, `checkRateLimit` delegates to
`binding.limit({ key })`; otherwise use the Map. Keep the exported signature
byte-compatible. Declare the binding in `wrangler.toml` per Cloudflare's Rate
Limiting API docs (namespace_id + simple limit config); note the deploy-time
`[vars]` patching (`scripts/patch-wrangler-env.ts`) does NOT manage bindings —
edit `wrangler.toml` directly, which is allowed for bindings (the "never re-add
[vars]" rule is about vars only).
**Verify**: `pnpm exec wrangler deploy --minify --dry-run` exit 0; build green.

### Step 3: Tests
Unit-test the adapter selection (env with stub binding → binding called; no
binding → Map path) with a fake binding object.
**Verify**: `bun test src/lib/api` all pass.

## Done criteria

- [ ] Binding path + bounded fallback, same public interface
- [ ] #2467's unbounded growth fixed (size-bound test)
- [ ] Dry-run deploy, build, tests green
- [ ] `plans/README.md` updated; comment on issue #2467 linking the PR

## STOP conditions

- Cloudflare's Rate Limiting binding is not available on the account/plan (the
  dry-run or docs check fails) — report; a Durable Object counter is the
  fallback design but is a bigger change than this plan scopes.
- Per-endpoint limit configs can't be expressed with one binding — report the
  mapping you'd need (bindings are static per wrangler.toml).

## Maintenance notes

- Self-hosted Docker/K8s keeps the in-memory path (single process — adequate).
- Reviewer: check key construction doesn't accidentally include per-isolate
  state, and that `retryAfterSec` semantics survive the binding path.
