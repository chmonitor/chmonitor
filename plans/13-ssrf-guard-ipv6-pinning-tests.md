# Plan 13: Add characterization tests for the untested halves of the SSRF host guard

> **Executor instructions**: Follow step by step; verify each step. On a "STOP
> condition", stop and report. When done, update this plan's row in
> `plans/README.md`. This plan adds tests only — do NOT change `host-url.ts`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/lib/browser-connections/host-url.ts apps/dashboard/src/lib/browser-connections/host-url.test.ts`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

`host-url.ts` is the security-critical SSRF guard for every user-supplied host (ClickHouse
connections, the health/webhook proxy, custom MCP servers). Two of its most important pieces
have **zero test coverage**: `createHostValidationFetch` (`:112-137`) — the DNS-pinning fetch
wrapper that is the actual runtime egress defense (resolve-then-pin against DNS rebinding,
plus the Cloudflare-Worker hostname guard) — is imported by no test; and the entire **IPv6**
branch of `isInternalIp` (`:309-337`, handling ULA / link-local / IPv4-mapped / 6to4 /
Teredo) is never entered, because `host-url.test.ts` only drives `validateHostUrl` with IPv4
resolver stubs. A future refactor could drop the mapped4/6to4 checks or the pin-to-validated
step and no test would catch it. This plan adds the missing coverage. (It characterizes
current behaviour — it does not assert a new bypass.)

## Current state

Files:
- `apps/dashboard/src/lib/browser-connections/host-url.ts` — exports `validateHostUrl`,
  `createHostValidationFetch` (`:112`), `isInternalIp` (`:309`, IPv6 matrix at `:309-337`),
  and constants incl. `WORKER_DNS_PINNING_ERROR`. `createHostValidationFetch(resolver)` takes
  an injectable resolver; on `isCloudflareWorkers()` it throws `WORKER_DNS_PINNING_ERROR` for
  a non-IP-literal hostname (`:118-123`), otherwise resolves+validates and (on Node) pins the
  socket to the validated address via an undici `Agent` (`:135`, `createPinnedDispatcher :241`).
- `apps/dashboard/src/lib/browser-connections/host-url.test.ts` — existing suite; drives
  `validateHostUrl(url, resolver)` with **IPv4** resolvers (`127.0.0.1`, `93.184.216.34`).

Discover before writing: the exact import path of `isCloudflareWorkers` (grep
`rg -n "isCloudflareWorkers" apps/dashboard/src/lib/browser-connections/host-url.ts` and its
import line) and whether `isInternalIp` / `WORKER_DNS_PINNING_ERROR` are exported (grep
`rg -n "export" apps/dashboard/src/lib/browser-connections/host-url.ts`). Mock
`isCloudflareWorkers` via `mock.module` on its real specifier (mirror `polar.test.ts`'s
`mock.module` style).

Convention: **Bun test**; the existing `host-url.test.ts` shows the injected-resolver pattern.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Typecheck | `cd apps/dashboard && bun run type-check` | exit 0 |
| Run test | `cd apps/dashboard && bun test src/lib/browser-connections/host-url.test.ts --isolate` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `apps/dashboard/src/lib/browser-connections/host-url.test.ts` (extend; or add a sibling `host-url-ipv6.test.ts` / `host-validation-fetch.test.ts` if cleaner)

**Out of scope**:
- `host-url.ts` itself — do NOT modify the guard; this plan only adds tests. If a test reveals
  an actual bypass, STOP and report it as a security finding rather than "fixing" it here.
- Any route that consumes the guard.

## Git workflow

- Branch: `advisor/13-ssrf-guard-tests`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `test(security): cover IPv6 internal ranges + DNS-pinning fetch in host guard`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: IPv6 internal-range coverage

Add tests that drive `validateHostUrl(url, resolver)` (and/or `isInternalIp` directly if
exported) with **IPv6** resolvers, asserting BLOCK for each internal class and ALLOW for a
public v6:
- `::1` (loopback) → blocked
- `fc00::/7` ULA, e.g. `fd00::1` → blocked
- `fe80::1` (link-local) → blocked
- `::ffff:127.0.0.1` (IPv4-mapped loopback) → blocked
- a 6to4 address wrapping a private v4 (e.g. `2002:0a00:0001::` for `10.0.0.1`) → blocked
- a public v6, e.g. `2606:4700:4700::1111` → allowed (resolves to a valid `{ url, addresses }`)

Use the existing injected-resolver approach: a resolver returning the target IPv6 string.

**Verify**: `cd apps/dashboard && bun test src/lib/browser-connections/host-url.test.ts --isolate` → all pass, incl. the new IPv6 cases.

### Step 2: `createHostValidationFetch` behaviour

Add tests for the fetch wrapper:
1. **Workers hostname guard** — `mock.module` `isCloudflareWorkers` → `true`; call
   `createHostValidationFetch(resolvePublic)('https://hooks.slack.com/x')` and assert it
   **rejects** with `WORKER_DNS_PINNING_ERROR` (Workers can't pin a hostname's DNS).
2. **Validation runs at fetch time** — with `isCloudflareWorkers` → `false` and a resolver
   returning an **internal** address (e.g. `10.0.0.5`), the returned fetch **rejects** before
   any socket dispatch (proving the guard re-validates on the pinned path). Assert it throws
   and that no real network call is attempted (the internal address is rejected first).

If mocking `isCloudflareWorkers` is not feasible (e.g. it reads a runtime global that can't be
overridden), cover at least Step 2.2 (which needs only the injected resolver) and document the
Workers-guard case as needing an integration test.

**Verify**: `cd apps/dashboard && bun test src/lib/browser-connections/host-url.test.ts --isolate` → all pass; `bun run lint` → exit 0.

## Test plan

- New IPv6 block/allow cases + `createHostValidationFetch` cases (above).
- Structural pattern: existing `host-url.test.ts` (injected resolver) + `polar.test.ts` (mock.module for `isCloudflareWorkers`).
- Verification: `cd apps/dashboard && bun test src/lib/browser-connections --isolate` → all pass.

## Done criteria

- [ ] IPv6 internal ranges (loopback, ULA, link-local, IPv4-mapped, 6to4) are asserted blocked; a public v6 is asserted allowed
- [ ] `createHostValidationFetch` has ≥1 test (the internal-address rejection at fetch time; ideally also the Workers hostname-guard throw)
- [ ] `host-url.ts` is unchanged (`git diff` shows no edit to the source)
- [ ] `cd apps/dashboard && bun test src/lib/browser-connections/host-url.test.ts --isolate` passes
- [ ] `cd apps/dashboard && bun run type-check` exits 0; `bun run lint` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- `isInternalIp` / `WORKER_DNS_PINNING_ERROR` are not exported and cannot be reached even via
  `validateHostUrl` — report which surface is testable.
- A test shows an internal IPv6 range is **NOT** blocked (a real bypass) — STOP and report it
  as a security finding; do not paper over it by weakening the test.
- The Node pinning path (`createPinnedDispatcher`) attempts a real network connection in the
  test and can't be avoided — cover the pre-dispatch rejection only and note the integration gap.

## Maintenance notes

- Reviewer: confirm the tests assert BLOCK (not just "no throw") for each IPv6 class, and that
  the public-v6 case proves the guard isn't simply blocking all v6.
- Fully asserting socket-level pinning (that the dialed IP equals the validated IP) needs an
  integration harness; this plan covers the observable pre-dispatch contract. That integration
  test is a reasonable follow-up and is the foundation any future DNS-rebinding hardening of
  `health/webhook.ts` (see plan 05's deferred note) should build on.
