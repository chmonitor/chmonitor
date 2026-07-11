# 103 — `apps/cloud-hooks`: dedicated Cloud webhook + ops-notification Worker

**Status:** design approved for implementation (dispatch to a senior agent)
**Owner surface:** Cloud (SaaS) only — OSS never deploys or needs this.
**New subdomain:** `hooks.chmonitor.dev` (Cloudflare Worker `chmonitor-hooks`).

## Why

Today `POST dash.chmonitor.dev/api/v1/webhooks/polar` lives inside the
dashboard Worker. That couples cloud-only billing plumbing to the product
bundle every OSS self-hoster builds, and there is no operator-facing
notification when revenue events happen. This app:

1. **Migrates the Polar webhook** out of the dashboard (cloud-only logic leaves
   the shared codebase; OSS bundle shrinks; the dashboard route is removed
   after cutover).
2. **Notifies the operator via Telegram** on business + ops events: new
   subscription (incl. the new $0 Free signups → funnel signal), plan
   change/cancel, payment failure, webhook signature failures.
3. **Runs scheduled ops jobs** (Worker cron triggers): daily summary (new
   signups, active subs by plan, MRR estimate from BILLING_PLANS pricing),
   health checks (dash / docs / landing HTTP 200 + `/api/healthz` readiness),
   and surfaces failed GitHub Actions on `main` (optional, phase 2).

## Architecture

```
Polar ──► POST hooks.chmonitor.dev/webhooks/polar
              │  validateEvent(raw body, POLAR_WEBHOOK_SECRET)  → 403 bad sig
              ▼
        applySubscription()            (same contract as today: lazy Clerk org,
              │                         re-key customer→org, monotonic D1 upsert)
              ├──► D1 binding CHM_CLOUD_D1 (SAME database the dashboard reads —
              │    plan resolution in the dashboard is unchanged)
              └──► notifyTelegram(event summary)

cron (Worker triggers)
  ├─ daily 00:00 UTC  → subscription/signup summary → Telegram
  └─ */15min          → health probes (dash, docs, landing, demo CH via dash API)
                        → Telegram ONLY on state change (up→down / down→up)
```

### Key decisions

- **Shared logic via a package, not a copy.** Extract the pure webhook core
  (`applySubscription`, product↔plan mapping glue, subscription-store upsert)
  from `apps/dashboard/src/routes/api/v1/webhooks/polar.ts` +
  `lib/billing/subscription-store.ts` into **`packages/billing-webhook-core`**
  (zero-dep except `@polar-sh/sdk`; D1 access through a minimal injected
  interface so both Workers can bind it). The dashboard keeps importing the
  same functions until cutover, so behaviour cannot fork during migration.
  Follow the bundled-package dep checklist (root+app lockfiles, ssr.noExternal,
  resolve.dedupe) from docs/knowledge.
- **Same D1 database** (`chm-cloud`) bound into both Workers. The
  subscription-store monotonic guard already makes concurrent writers safe.
- **Telegram, minimal:** raw Bot API `sendMessage` via fetch (no SDK).
  `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` secrets. All notifications go
  through one `notify(kind, text)` helper with per-kind rate limiting (KV or
  in-memory per-isolate is fine for v1) so a webhook storm can't flood the chat.
- **Health-state memory:** a tiny KV namespace (`HOOKS_KV`) storing last-known
  state per probe, so cron only notifies on transitions.
- **Fail open / isolate:** a Telegram failure NEVER fails the webhook response;
  D1 write behaviour keeps the existing "retry once, log, still 202" contract
  (Polar reconcile self-heals — see docs/knowledge/billing-checkout-flow.md).

### App layout (mirror `apps/bug-handler`)

```
apps/cloud-hooks/
  package.json            (isolated pnpm workspace, own lockfile)
  pnpm-workspace.yaml     (pulls ../../packages/*)
  wrangler.toml           (name=chmonitor-hooks, route hooks.chmonitor.dev/*,
                           [triggers] crons = ["0 0 * * *", "*/15 * * * *"],
                           D1 + KV bindings; NO [vars] — patch-wrangler-env
                           pattern if it needs env, else keep vars minimal)
  src/index.ts            (router: /webhooks/polar, /healthz; scheduled())
  src/telegram.ts
  src/summary.ts          (daily digest queries against D1)
  src/probes.ts           (HTTP health probes + state transitions)
  src/*.test.ts           (bun test, mirroring dashboard webhook tests)
```

### Migration plan (safe cutover)

1. Land `packages/billing-webhook-core` + refactor the dashboard route to use
   it (no behaviour change; existing webhook tests keep passing).
2. Land `apps/cloud-hooks` + CI job (own deploy step in cloudflare.yml or a
   dedicated workflow, like bug-handler). Deploy with the SAME
   `POLAR_WEBHOOK_SECRET`.
3. In Polar dashboard, add `https://hooks.chmonitor.dev/webhooks/polar` as a
   second endpoint → verify deliveries + Telegram notifications in sandbox,
   then production.
4. Remove the old Polar endpoint, then delete
   `apps/dashboard/src/routes/api/v1/webhooks/polar.ts` (tests move to the
   package/app). Keep `/api/v1/billing/*` (checkout/portal/subscription) in the
   dashboard — those are user-facing APIs, not webhooks.
5. Update docs/knowledge/billing-checkout-flow.md + cloud-saas-mode with the
   new topology.

### Secrets / env (all Worker secrets, never committed)

| Name | Purpose |
|------|---------|
| `POLAR_WEBHOOK_SECRET` | verify inbound Polar events |
| `POLAR_ACCESS_TOKEN`   | reconcile reads / customer re-key |
| `CLERK_SECRET_KEY`     | lazy org creation on first payment |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | operator notifications |

### Phase 2 (explicitly out of v1 scope)

- GitHub Actions failure digest, PostHog funnel snippets in the daily summary,
  workflow/queue observability, per-event Slack mirroring.
