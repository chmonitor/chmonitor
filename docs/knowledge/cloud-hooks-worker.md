---
id: cloud-hooks-worker
type: spec
related: [billing-checkout-flow, cloud-saas-mode, bug-handler-email-worker, deployment]
tags: [cloud-hooks, polar, webhook, telegram, cron, cloudflare, billing, d1]
updated: 2026-07-11
---

# Cloud-hooks worker (Polar webhooks + ops notifications)

`apps/cloud-hooks` is a standalone **Cloudflare Worker** for the Cloud (SaaS)
product only (`chmonitor-hooks` → `hooks.chmonitor.dev`). OSS/self-host never
deploys it — it is purely additive Cloud plumbing. It moves the Polar webhook
out of the dashboard bundle and adds operator notifications + scheduled ops jobs.

```
Polar ──► POST hooks.chmonitor.dev/webhooks/polar
             │  validateEvent(raw body, POLAR_WEBHOOK_SECRET)  → 403 bad sig
             ▼
       applySubscription()  (shared @chm/billing-webhook-core core)
             ├──► CHM_CLOUD_D1  (SAME chm-cloud database the dashboard reads)
             └──► Telegram notify(kind, text)

cron
  ├─ "0 0 * * *"      → daily billing summary  → Telegram
  └─ every 15 minutes → health probes (dash/docs/landing) → Telegram on changes
```

## Shared core, not a copy

The billing logic lives in **`packages/billing-webhook-core`** (framework-free):
`applySubscription` (owner resolution, live/paid gating, funnel/audit gating) +
the D1 `upsertSubscription`/`getSubscription` contract with its monotonic write
guard. D1 is a minimal injected `D1Like` interface; every runtime collaborator
(Clerk org creation, Polar re-key, negative cache, PostHog funnel, audit) is a
dependency. Both the dashboard route and this worker are thin adapters over it,
so behaviour **cannot fork**. See [billing-checkout-flow](billing-checkout-flow.md).

The same `chm-cloud` D1 is bound into both Workers; the monotonic
`event_timestamp` guard makes concurrent writers safe.

## Pipeline (`src/`)

- `telegram.ts` — `Notifier.notify(kind, text)`: raw Bot API `sendMessage` over
  `fetch`, one helper, **per-kind throttle** (in-memory per isolate). Never
  throws — a delivery failure returns false and is logged, so it can't fail a
  webhook response or a cron job.
- `probes.ts` — `runProbes`: HTTP-probe the public surfaces, store per-probe
  up/down state in `HOOKS_KV`, and `diffStates` so we notify **only on
  transitions** (up→down / down→up). First-seen `down` alerts; first-seen `up`
  is silent. No KV → per-run state (re-alerts every 15 min while down).
- `summary.ts` — `collectSummary` queries the subscription store (active subs by
  plan, new signups in 24h) and computes an MRR estimate from `BILLING_PLANS`
  (`@chm/pricing`) — yearly normalized to price/12. Pure `reduceSummary`/
  `mrrForGroup` are unit-tested.
- `billing-deps.ts` — the cloud-hooks implementations of the core collaborators:
  env-driven `planForProductId` (mirrors the dashboard's `CHM_POLAR_PRODUCT_*`
  map), lazy Clerk org creation over the Backend REST API, Polar customer re-key
  via the SDK, and the retry-wrapped D1 upsert. Funnel + audit hooks are no-ops
  in v1 (the dashboard still owns PostHog + org audit until cutover).
- `webhook.ts` — `handlePolarWebhook`: `validateEvent` (injectable for tests) →
  core → `notify`. 403 + `signature_failure` alert on a bad signature; 202 on a
  handled event; unhandled types are acknowledged silently.
- `index.ts` — `fetch` router (`/webhooks/polar`, `/healthz`) + `scheduled`
  (routes the daily cron to the summary, the 15-min cron to probes).

## Config (`wrangler.toml`)

- `name = chmonitor-hooks`, custom domain `hooks.chmonitor.dev` (auto-provisions
  DNS on the managed zone), crons `["0 0 * * *", "*/15 * * * *"]`.
- D1 binding `CHM_CLOUD_D1` → `chm-cloud` (`database_id`
  `cca247b6-9b25-41bd-b9ca-727b35bc6039`, same as the dashboard).
- `HOOKS_KV` is **commented out** — the operator must
  `wrangler kv namespace create HOOKS_KV`, paste the id, and uncomment (like the
  dashboard's queue block). Absent → probes fall back to per-run state.
- **No secrets, no product-id vars committed.** Secrets set via
  `wrangler secret put` (CI does this, skipping any that are unset):
  `POLAR_WEBHOOK_SECRET`, `POLAR_ACCESS_TOKEN`, `CLERK_SECRET_KEY`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. The `CHM_POLAR_PRODUCT_*` map + 
  `CHM_POLAR_SERVER` must be set (mirroring `apps/dashboard/.env.production`)
  before the Polar endpoint is cut over, or products won't map.

## CI

Own `cloud-hooks` job in `.github/workflows/cloudflare.yml` (mirrors
`bug-handler`): install → `bun test src/ --isolate` → `type-check` → deploy
(preview on PRs, production on main), then set worker secrets (each skipped if
its repo secret is empty). Gated on `apps/cloud-hooks/**`,
`packages/billing-webhook-core/**`, or `packages/pricing/**` changes.

## Migration / cutover (plans/103)

Phase 1–2 (this change) landed the shared core + dashboard refactor and the
cloud-hooks worker + CI. The dashboard's `/api/v1/webhooks/polar` route is
**unchanged and still live** — the worker deploys but is dormant. Remaining
steps (operator, out of v1 scope): add `https://hooks.chmonitor.dev/webhooks/polar`
as a second Polar endpoint and verify deliveries + Telegram in sandbox then prod;
then remove the old endpoint and delete the dashboard webhook route (keep
`/api/v1/billing/*` — those are user-facing APIs, not webhooks).
