---
id: cloud-saas-mode
title: Cloud (SaaS) mode — one codebase, two products
type: spec
status: active
updated: 2026-07-04
tags:
  - saas
  - cloud
  - auth
  - hosts
  - onboarding
related:
  - deployment
  - agentstate-conversation-store
  - conventions
---

# Cloud (SaaS) mode

`dash.chmonitor.dev` is the hosted product; Docker / Kubernetes / a self-built
Cloudflare Worker are the self-hosted (OSS) product. **Same codebase** — the only
difference is runtime configuration, gated by the **cloud-mode** flag.

## The invariant

FAIL-CLOSED to self-hosted. Unset/junk `CHM_CLOUD_MODE` (runtime) or
`VITE_CLOUD_MODE` (build) → NOT cloud → OSS behaviour unchanged. Cloud is purely
additive; it never removes a monitoring feature. Mirrors `lib/edition`'s
fail-open design (edition already lists `cloud` as an enterprise feature).

## Behaviour matrix

| | Self-hosted (default) | Cloud (`CHM_CLOUD_MODE=true`) |
|---|---|---|
| Env `CLICKHOUSE_HOST` | operator's real hosts, full access | public **read-only demo** (`source:'demo'`) |
| Anonymous | sees env hosts | sees the demo (explore, no account) |
| Signed-in | sees env hosts | demo hidden → own D1 connections only; zero → welcome/setup |
| Auth | usually `none` | Clerk + `CHM_CLERK_PUBLIC_READ=true` |
| Per-user conns | optional | on (`VITE_FEATURE_USER_CONNECTIONS_DB=true`) |

Read-only on the demo is *enforced* by the existing public-read gate: anonymous
principals can only read, and signed-in users never see the demo. The `readOnly`
flag on `MergedHostInfo` is the UI cue.

**Public-demo allowlist.** A deploy may bind more env hosts than it wants to
show publicly. `CHM_CLOUD_DEMO_HOSTS` (comma list of `CLICKHOUSE_NAME` entries)
narrows the demo to a named subset — e.g. `CHM_CLOUD_DEMO_HOSTS=duet-ubuntu`
exposes only that host to anonymous visitors; any other bound host stays
private. Cloud-mode only; unset = all env hosts are the demo. Filter is
fail-open: a zero-match allowlist (typo) passes through ALL hosts rather than
black out the demo (empty host list = 503). The host `id` (index into
`CLICKHOUSE_HOST`) is preserved so `?host=<id>` routing keeps resolving.
Implemented in `lib/cloud/demo-hosts.ts` (`filterToDemoHosts`), applied at
`api/v1/hosts.ts` (the shown list) and `lib/api/clickhouse-config.ts`
(`getClickHouseConfigsFromEnv` → live status / health / notifications).

## Files

- `apps/dashboard/src/lib/cloud/cloud-mode.ts` — resolvers + `parseCloudMode`. Tested.
- `vite.config.ts` `loadDeployEnv` + CLIENT_ENV + `src/vite-env.d.ts` — client `VITE_CLOUD_MODE` DERIVES from canonical `CHM_CLOUD_MODE` (set once).
- `apps/dashboard/.env.production` (+ `.env.preview` overlay) — **single source of truth** for the hosted product's non-secret config (`CHM_CLOUD_MODE=true`, `CHM_FEATURE_USER_CONNECTIONS_DB=true`, auth, LLM). `wrangler.toml` declares NO `[vars]`.
- `scripts/patch-wrangler-env.ts` — reads `.env.production`/`.env.preview`, injects the non-`VITE_` keys as Worker runtime `[vars]` at deploy.
- `.github/workflows/cloudflare.yml` build step — `build:preview` (PRs) / `build:production` (main) set `CHM_BUILD_ENV`; values come from the `.env*` files, none hardcoded.
- `lib/swr/use-merged-hosts.ts` — demo tagging, hide-when-signed-in; exposes `cloudMode` / `isSignedIn`.
- `components/host/host-switcher.tsx` — Demo / read-only badges; `demo` behaves like `env` for live status (server-backed by index).
- `components/host/first-run-empty-state.tsx` — redesigned welcome/setup (cloud signed-in / cloud anon / self-hosted).
- `components/host/first-run-gate.tsx` + `first-run-decision.ts` — enforce the "signed-in ⇒ no demo data" invariant at the render boundary. The active host for data comes from `?host=` (`useHostId`), which is DECOUPLED from the visible host list; a stale `?host=0` (carried over from browsing the demo while anonymous) points at the now-hidden demo, and `resolve-host-fetch.ts` falls back to the server/demo host for an id not in the merged list — so a signed-in, zero-connection user could otherwise see demo data. The gate refuses to render the routed page (its charts fetch `?host` directly) until the active host resolves to one of the user's OWN visible hosts: while their connections load it shows a skeleton (never demo charts); with zero it routes to `/setup`; with some it re-points `?host` at a real host. Discriminator is deterministic — user connections use NEGATIVE ids (`DB_CONNECTION_HOST_ID_START = -1000`), env/demo use `0,1,2…`, so a non-negative `?host` for a signed-in user is always the demo. OSS + anonymous-cloud behaviour is unchanged. Invariant covered by `first-run-decision.test.ts`.
- `lib/cloud/reject-demo-host.ts` (#2172) — the SERVER-side half of the same invariant, since the gate above is client-render-only and a hand-crafted `GET /api/v1/charts/$name?hostId=0` would otherwise still reach the demo. `isDemoHostBlockedForRequest(hostId, bindings)` rejects a non-negative `hostId` when `isCloudModeServer()` is true AND the caller is an authenticated Clerk principal (`isSignedInServer()`) — the same negative-vs-non-negative discriminator as `first-run-decision.ts`. OSS and anonymous-cloud callers are unaffected (both legitimately use `hostId=0`). Wired into every `/api/v1/*` data route that resolves a user-supplied `hostId` against the env/demo ClickHouse host — the two `resolve-host-fetch.ts` entry points (`routes/api/v1/charts/$name.ts`, `routes/api/v1/tables/$name.ts`) plus `overview.ts`, `host-status.ts`, `health/snapshot.ts`, `health/checks.ts`, `notifications.ts`, `findings.ts`, `insights.ts`, `insights/generate.ts`, `actions.ts`, and the `explorer/*` routes (`query.ts` GET+POST, `preview.ts`, `query-log.ts`, `tables.ts`, `projections.ts`, `skip-indexes.ts`, `columns.ts`, `databases.ts`, `ddl.ts`, `dependencies.ts`, `indexes.ts`) — right after each route's own non-negative-integer `hostId` boundary check; a blocked request gets a 200 structured-empty response shaped to match that route's own conventions (`{success:true, data:[]/null, metadata.unavailable}`, or a flat `unavailable`/`error` field where that's the route's idiom), never a 403. Deliberately NOT wired into `management.ts` (POST only echoes a locally-generated DDL string + static message, no ClickHouse data) or `insights/weekly-report.ts` (reads a D1-only store, never queries ClickHouse). Tested in `reject-demo-host.test.ts` (boolean logic) and each route's own `__tests__/cloud-demo-host-guard.test.ts` (OSS / anonymous-cloud / authenticated-cloud+hostId=0 / authenticated-cloud+negative-hostId).
- `lib/dashboard-storage/` — saved Chart Builder dashboards. Client entrypoint (`index.ts`) picks D1 (per-owner, cross-device, optional read-only sharing) vs. localStorage the same way conversations do — via `featureFlags.conversationDb()` (same `CHM_CLOUD_D1` + Clerk gate, no dedicated flag) — so OSS/self-host and cloud-signed-out always get the localStorage path. `d1-store.ts` + `auth.ts` are server-only (never imported by client code — reached only through `routes/api/dashboards/*`); the public `share/$slug` read is the one deliberately owner-unscoped query, projecting only `{name, charts}`. See `plans/56-dashboard-d1-persistence-sharing.md`.

## Sample-cluster onboarding preset

A DIFFERENT concept from the cloud `demo` host above (that one is server
env-configured and cloud-only): "Try with sample ClickHouse" is a preset users
of EITHER product add through the normal add-host flow, so it works in
self-hosted OSS too — the main barrier it removes is "must own a ClickHouse
cluster to try the product at all" (self-hosted zero-host first-run, and cloud
signed-in users whose demo is hidden). Cloud anonymous visitors already get an
automatic demo, so they don't see this CTA.

- `components/connections/sample-preset.ts` — the single constant
  (`SAMPLE_CLUSTER_PRESET`: name/host/user/password) + `isSampleClusterHost`
  matcher. Points at the public ClickHouse Playground (`play.clickhouse.com`,
  user `explorer`, no password) — genuinely public/non-secret creds, DDL/INSERT
  rejected server-side (verified). **Caveat**: that shared public demo also
  denies SELECT on several `system.*` tables chmonitor relies on (`query_log`,
  `parts`, `merges`, `processes`, `replicas`, `mutations`, `disks`, `errors`,
  `storage_policies` — verified via direct query); schema browsing
  (`tables`/`databases`), `system.metrics`/`settings`/`functions`, and the SQL
  explorer/AI chat work. Operational monitoring pages will show their normal
  empty/error states against it. Swapping to a differently-provisioned public
  demo (broader `system.*` access) is a one-constant change.
- `components/connections/connection-form.tsx` — `showSamplePreset` prop
  renders a "Use sample" quick-fill button (only passed by `AddHostDialog`, so
  it never appears in the edit-connection flow).
- `components/connections/add-host-dialog.tsx` — `initialPreset?: 'sample'`
  prefills the form when opened from a sample CTA; parents MUST pass it
  explicitly (including `undefined`) on every open since the dialog instance is
  reused/toggled, not remounted per-CTA. Prefill only — same test/save
  validation and host-limit path as any manual entry, no bypass. Also fires
  `sample_cluster_connected` / `sample_to_real_converted` (see
  `lib/analytics/events.ts`) by comparing the saved host against
  `isSampleClusterHost`.
- `components/host/first-run-empty-state.tsx` — secondary "Try with sample
  ClickHouse" CTA in `ConnectYourHost` (cloud signed-in) and `SelfHostedSetup`;
  not in `SignInToConnect` (redundant with the automatic demo).
- `components/host/sample-cluster-banner.tsx` (+ `sample-cluster-banner-
  dismissed.ts`) — persistent, dismissible "Connect your own cluster" convert
  nudge rendered in `app-sidebar.tsx`'s `SidebarHeader` below `HostSwitcher`.
  Shows only once a sample host is connected and no real (non-sample) host
  exists yet; dismissal persists per-browser via localStorage.

## Connection-error help

`lib/connection-errors.ts` → `classifyConnectionError(raw)` maps a raw "Test
connection" error string to a kind (`host_not_allowed`, `invalid_url`,
`auth_failed`, `access_denied`, `dns_error`, `connection_refused`, `tls_error`,
`timeout`, `mixed_content`, `unknown`) with title + explanation + fix + docs
slug. `extractConnectionErrorMessage(body)` handles both response shapes
(`{error:string}` from the test route, `{error:{message}}` from the shared
validation builder). Rendered by `ConnectionErrorPanel` in `connection-form.tsx`.
Docs: `docs/content/guide/guides/connection-errors.mdx` (slug
`guides/connection-errors`). Tested in `lib/connection-errors.test.ts`.

## Billing (Polar) — cloud SaaS only

M3 wires paid plans via [Polar](https://polar.sh). Cloud-only; OSS/self-host is
free forever (auth `none` ⇒ unlimited, plans inert).

- **Plans**: `lib/billing/plans.ts` (`BILLING_PLANS`) is the price/capability/
  limit source of truth (hosts, seats, `alertRules`, `aiRequestsPerDay` daily
  trial, `aiMonthlyUsdBudget`, `retentionDays`, `capabilities`). The landing app
  mirrors the numbers via `apps/landing/src/data/pricing.ts` (shared by
  `Pricing.astro` + the dedicated `/pricing` page).
- **Entitlements**: `lib/billing/entitlements.ts` is the single place that turns
  a `Plan` into yes/no limit decisions — `checkHostLimit` / `checkSeatLimit` /
  `checkAlertRuleLimit` / `checkAiDailyLimit` / `checkAiBudget` (all `null` =
  unlimited, return a `LimitCheck` with the API error shape), plus
  `hasCapability`, `retentionCutoffMs` / `isWithinRetention`, and `limitMessage`
  for the upgrade nudge. Server limit checks go through here, never `plan.hosts`
  inline. Fully unit-tested in `entitlements.test.ts` (every plan × every limit).
- **Config**: `lib/billing/polar-config.ts` — `getPolarClient()` (server
  `sandbox|production` from `CHM_POLAR_SERVER`) + product↔plan mapping from
  `CHM_POLAR_PRODUCT_<PLAN>_<PERIOD>` env vars. Product ids live in env (sandbox
  vs production differ), NOT in `plans.ts`. `POLAR_ACCESS_TOKEN` is a secret.
- **Storage**: one row per user in `user_subscriptions` (migration
  `0003_user_subscriptions.sql`) in the shared `CHM_CLOUD_D1` database.
  `subscription-store.ts` (D1 CRUD; degrades to null without D1),
  `user-subscription.ts` `getUserPlan()` (defaults free; downgrades when status
  not live or the period ended — no cron needed).
- **Routes**: `api/v1/billing/checkout` (hosted checkout, `externalCustomerId =
  Clerk userId` ⇒ no customer map), `…/portal`, `…/subscription` (GET),
  `…/usage` (GET, current-plan meters), `…/can-downgrade` (POST, pre-flight
  before a plan change — see below), `api/v1/webhooks/polar` (verifies via
  `validateEvent` over the RAW body).
- **Enforcement**: `api/v1/user-connections` POST returns 402 via
  `checkHostLimit(plan, count)` + `limitMessage(check)` (null = unlimited). New
  metered surfaces (alerts, AI) should reuse the matching `entitlements.ts`
  helper for consistent boundary + error semantics.
- **Shared usage resolution**: `lib/billing/owner-usage.ts`
  `resolveOwnerUsage(owner, userId)` is the ONE resolver for current
  consumption (hosts pooled across org members, seats, AI daily/monthly) —
  both `…/usage` (GET) and `…/can-downgrade` (POST) call it so "current usage"
  can never drift between the usage card and the downgrade check.
- **Downgrade protection** (plan 19): before sending a user to the Polar
  portal to change to a lower/different plan, the billing page (`Change to
  <plan>` CTA) calls `POST api/v1/billing/can-downgrade { targetPlanId }`. It
  compares current usage to the target plan's caps through the SAME
  `entitlements.ts` `check*` helpers, but only reports a metric in `exceeded`
  when it is BOTH numerically over the target cap AND classified `enforced` in
  `plan-enforcement.ts` (`LIMIT_ENFORCEMENT`) — a `deferred` limit never
  manufactures a warning (honest paywalls, same invariant as the upgrade
  paywall modal). Fails open (`{ ok: true, exceeded: [] }`, never throws) with
  no Clerk, so OSS is unaffected. `ok: false` opens
  `components/billing/downgrade-confirm-modal.tsx` (`DowngradeConfirmModal`) —
  "Stay on current plan" vs "Downgrade anyway" (the latter proceeds to the
  portal and fires the `downgrade_override` product-analytics event).
- **UI**: `routes/(dashboard)/billing.tsx`, gated to cloud mode in
  `app-sidebar.tsx`; `feature: 'billing'`.
- **Setup**: `apps/dashboard/scripts/polar-setup.ts` creates Pro/Max
  monthly+yearly products from `BILLING_PLANS` and prints the
  `CHM_POLAR_PRODUCT_*` env lines. Sandbox/production tokens are distinct — a
  production token 401s against `sandbox-api.polar.sh`.

## Gotchas

- `apps/dashboard` is NOT a root bun workspace — run `bun install` *inside*
  `apps/dashboard`, not just at the monorepo root.
- The dashboard `build` script calls `vite` directly; run via `bun run build`
  from inside `apps/dashboard` (its local `.bin`), not from the repo root.
- Build needs `VITE_CLOUD_MODE`/`VITE_FEATURE_USER_CONNECTIONS_DB` inlined to
  exercise cloud behaviour locally — they are build-time, not runtime, on the
  client.
