---
id: cloud-hooks-worker
type: spec
related: [billing-checkout-flow, cloud-saas-mode, bug-handler-email-worker, deployment]
tags:
  [
    cloud-hooks,
    polar,
    clerk,
    webhook,
    telegram,
    cron,
    cloudflare,
    billing,
    d1,
    dau,
    mau,
    telemetry,
    issues,
  ]
updated: 2026-08-12
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
             └──► Telegram notify(kind, text)  — rich per-transition wording
                    (🌱 free signup, 💰 paid new, ⬆️ upgrade, ⬇️ downgrade,
                     ⚠️ cancel, ❌ revoke, 💳 past-due)

Clerk ──► POST hooks.chmonitor.dev/webhooks/clerk
             │  verifyClerkWebhook(raw body, CLERK_WEBHOOK_SECRET)  → 403 bad sig
             │  (manual Svix HMAC-SHA256 over WebCrypto)
             ▼
       Telegram notify:  🆕 user.created · 🔑 session.created (KV-throttled
       1/user/6h) · 🏢 organization.created.  Unknown events → 202, ignored.

cron ("*/15 * * * *" — the intended cadence, currently NOT attached: the
account is over the Workers Free 5-crons-per-account budget, so
`wrangler.toml` deliberately declares no `[triggers]` block — see
apps/cloud-hooks/wrangler.toml:78-89 and src/cron.test.ts, which pins this
so a future edit does not re-add it. Worker is driven by its HTTP endpoints
only until the account regains cron budget. The tick-dispatch logic below
still describes what runs once the trigger is re-attached; reports dispatch
off the tick's scheduledTime.)
  ├─ 00:00 UTC tick   → + daily digest → Telegram
  │                      (users + DAU/WAU/MAU + subs + surfaces)
  ├─ Mon 01:00 tick   → + weekly report → Telegram
  │                      (same sections week-over-week + issue throughput)
  └─ every 15 minutes → ops sweep:
        ├─ full-surface health probes → Telegram on transitions
        │    └─ + outage escalation: reminders while still down (30m→2h→6h→daily)
        │      and total downtime on recovery
        ├─ Cloudflare Worker exceptions → new GitHub issue + Telegram
        │    └─ + spike alert when a KNOWN fingerprint gets much louder
        └─ new GitHub issues (KV cursor) → Telegram
```

## Throttling rule (learned the hard way)

`Notifier` throttles per KIND, in memory, per isolate. That is right for webhook
bursts and wrong for anything a cron produces: **`probe` and `error` carried a
30s window while their only producers run every 15 minutes**, so the window
never spanned two runs and never damped a flapping target — all it could do was
drop distinct messages inside ONE run. Four surfaces failing together reported
one; a run that filed five GitHub issues announced one. Both are now `0`.

The rule: **if a producer already dedupes on durable state, it must not also be
throttled on a timer.** A timer cannot prevent a duplicate that state already
prevents; it can only delete real information. Kinds deduped by state and
therefore unthrottled: `probe` (only fires on a transition), `error` (KV
fingerprint), `new_issue` (KV cursor), `usage_anomaly` (once a day).

The single cron string is matched **character for character** in `index.ts`
(`OPS_SWEEP_CRON`), and the daily/weekly reports run off `isDailyTick` /
`isWeeklyTick` on the tick's `scheduledTime`. Drift between `wrangler.toml`
and the constant does not error — a report silently stops being sent.
`src/cron.test.ts` compares the two sources and pins the tick classifiers.

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
- `probes.ts` — `runProbes`: probe a **declarative target table** (name/url/kind/
  `validator`) — adding a surface is a row, not code. Covers `dashboard`
  (`/healthz` liveness), `dashboard-ready` (`/api/healthz` CH-gated readiness),
  `docs`, `landing`, `blog`, and `mcp` (`/api/mcp`, validated with
  `expectNotServerError` since a bare GET answers 401/405). When `CHM_CLOUD_D1`
  is bound, a `SELECT 1` **D1 read probe** (`probeD1`) is appended. State is
  stored per-probe in `CHM_HOOKS_KV`; `diffStates` notifies **only on transitions**
  (up→down / down→up). First-seen `down` alerts; first-seen `up` is silent. No
  KV → per-run state (re-alerts every 15 min while down).
- `observability.ts` — `fetchWorkerExceptions`: pulls recent uncaught exceptions
  from the **Workers Observability Telemetry query API**
  (`POST /accounts/{id}/workers/observability/telemetry/query`, filter
  `$metadata.error EXISTS`), and normalizes each event into a `WorkerException`
  keyed by a **fingerprint** = `fnv1a(script + normalized message)` (ids/hex
  stripped so per-invocation noise collapses). `extractEvent`/`extractEvents`
  are tolerant of the loosely-documented wire shape; `aggregateExceptions`
  (count + first/last seen) is pure and unit-tested. Never throws → `[]`.
- `exceptions.ts` — `runExceptionScan`: for each NEW fingerprint, file an
  **agent-friendly GitHub issue** (`buildExceptionIssue`, mirrors bug-handler's
  Summary / Source table / For-the-coding-agent checklist) via the REST API and
  send a Telegram notify. **Dedup**: KV memory (`exc-fp:v1:<fp>`) first, then a
  GitHub search fallback (`in:body "<fp>"`) so a KV miss/eviction never re-files;
  the fallback backfills KV. **Rate cap**: `maxIssuesPerRun` (default 5). Labels
  default `bug,cloudflare-exception`. Every step is injected + never throws.
  **Spike detection** (`isSpike`) fills the blind spot that permanent dedup
  creates: a known error firing 100× more often is skipped silently, even though
  it is usually the more urgent event. On every skip the current window count is
  compared against the last one recorded (`exc-rate:v1:<fp>`); an alert needs
  BOTH an absolute floor (`SPIKE_MIN_COUNT`, since 2 → 6 is not news) and a
  relative jump (`SPIKE_MULTIPLE`), and respects `SPIKE_COOLDOWN_MS` so one
  incident does not re-alert every 15 minutes. The cooldown clock only moves when
  an alert actually fired, so a quiet update cannot postpone the next real one.
  **Auth** is resolved by `github-app.ts`'s `resolveGitHubAuth`, order:
  GitHub App creds (`GH_APP_ID` + `GH_APP_PRIVATE_KEY`) → PAT (`GITHUB_TOKEN`) →
  disabled (one log line). App mode passes the installation token as
  `githubToken` and the provider as `auth` so a `401` refreshes once.
- `github-app.ts` — **GitHub App auth** (the `duyetbot` app) for the exception
  scan's issue creation. Mints an RS256 **app JWT** with WebCrypto
  (`crypto.subtle.importKey('pkcs8', …)` + `sign` — no npm `jsonwebtoken` dep;
  claims `iat=now-60`, `exp=now+9min`, `iss=appId`), exchanges it for an
  **installation access token** (`POST /app/installations/{id}/access_tokens`),
  resolving the installation id once (`GET /repos/{owner}/{repo}/installation`)
  when `GH_APP_INSTALLATION_ID` is unset and caching it in `CHM_HOOKS_KV`
  (`gh-app:install-id:v1:<owner>/<repo>`). The installation token is cached in KV
  (`gh-app:token:v1:<owner>/<repo>`) until ~5 min before its 1h expiry
  (`TOKEN_EXPIRY_MARGIN_MS`); `withTokenRefresh` refreshes once on a mid-flight
  `401`. `normalizePrivateKey` handles escaped `\n` newlines and accepts only
  **PKCS#8** (`BEGIN PRIVATE KEY`) — a PKCS#1 key (`BEGIN RSA PRIVATE KEY`,
  GitHub's default download) throws a clear "convert with `openssl pkcs8 -topk8`"
  message rather than a cryptic WebCrypto error. `resolveGitHubAuth` decides the
  auth mode (see below). Everything is injected (fetch/KV/clock) and unit-tested
  without the network.
- `summary.ts` — `collectSummary` queries the subscription store (active subs by
  plan, new signups in 24h **+ new subs by plan and cancellations/revokes in
  24h**) and computes an MRR estimate from `BILLING_PLANS` (`@chm/pricing`) —
  yearly normalized to price/12. `formatDigest(data, { clerk, probes })` renders
  a compact Telegram-HTML digest with **Users** (from Clerk metrics), **Usage**
  (DAU/WAU/MAU), **Subscriptions**, and **Surfaces** (probe snapshot) sections —
  each section omitted when its optional source is unavailable. Pure
  `reduceSummary`/`mrrForGroup`/`formatDigest` are unit-tested.
  `queryPlanBreakdown` is shared with `weekly.ts` so the two reports can never
  disagree about what "active" or "MRR" means.
- `outage.ts` — `reconcileOutages`: closes the hole left by transition-only
  probing. A surface that goes down at 02:00 otherwise produces ONE message and
  then silence for as long as it stays broken. Tracks `downSince` / `reminders`
  per surface in its own KV key (`probe-outage:v1`, so `probe-state:v1` keeps its
  shape) and re-alerts on a **widening** schedule (`ESCALATION_STEPS_MS` =
  30m → 2h → 6h → daily, then daily). The first time down deliberately only
  starts the clock — `diffStates` already owns that alert, and alerting twice for
  one event is worse than not escalating. Recovery reports **total downtime** and
  drops the record. Pure + clock-injected, so the schedule is tested by advancing
  a number.
- `anomaly.ts` — `detectAnomaly`: alerts when yesterday's DAU diverges from its
  own recent baseline, because a digest *number* is passive — it only helps if
  someone reads it and remembers yesterday's. Three guards keep it from crying
  wolf: a **median** baseline (one HN-front-page day would drag a mean up for a
  week and make every following day look like a collapse), a **minimum baseline**
  (`MIN_BASELINE`, since 3 → 1 is "-67%" and means nothing), and **asymmetric
  thresholds** (a 30% drop alerts; a spike needs 3×, and is phrased as news
  rather than an incident). A missing reference day counts as zero — silence from
  the telemetry endpoint IS the signal. Sent as its own message, not a digest
  line.
- `activation.ts` — `collectActivation`: signups vs users who actually connected
  a cluster (`user_connections`), the most diagnostic number for a self-serve
  product and invisible when signups and subscriptions are reported separately.
  A digest line rather than an alert, except `isStalled` (≥`STALL_MIN_SIGNUPS`
  signups and ZERO connections), which is flagged inline as a probable broken
  connection flow.
- `usage.ts` — `collectUsage`: **DAU / WAU / MAU** from the telemetry D1
  (`CHM_TELEMETRY_DB` → `chm_telemetry`, read-only). One query per stream
  computes all three windows via `COUNT(DISTINCT CASE WHEN day = … END)`, so the
  30-day range is scanned once instead of three times. **These are active
  INSTALLS, not users** — `ping_daily`/`cli_daily` hold one deduped row per (UTC
  day, opaque install id) and carry no user identity, so every line is labelled
  "installs"; Clerk remains the user-level figure. Windows end on the **last
  complete UTC day** (yesterday), because the digest cron fires at 00:00 UTC and
  counting the day that just started would report a near-zero DAU every morning.
  `cli_install` rows are excluded from the CLI active count (they can carry an
  ephemeral id, which would inflate it) and reported separately as new installs.
  Each stream query is isolated, so a missing table degrades that stream to zero
  instead of dropping the whole section.
- `weekly.ts` — `collectWeekly` + `formatWeekly`: the Monday counterpart to the
  daily digest. Every headline number is paired with the **same number from the
  previous week** (`formatTrend` → `5 (▲ +3 vs 2)`; "flat" instead of "+0", and a
  bare number when there is no previous data to compare against). `weekBounds`
  anchors on **start-of-today**, not the run instant, so the two periods are
  exactly equal in length and adjacent — the property the comparison depends on.
  Adds an **Issues** section (opened/closed, via `fetchIssueStats`).
- `issues.ts` — `runIssueWatch`: announces **new GitHub issues** on the ops
  sweep. Read-only — it files nothing. Three rules carry the design: (1) the
  first run **seeds** the KV cursor (`issue-watch:v1:last-created`) and announces
  nothing, so enabling it on a repo with a backlog does not flood the chat;
  (2) GitHub's `since` filters on `updated_at`, so results are **re-filtered on
  `created_at`** — otherwise a comment on an old issue reads as a new issue;
  (3) the per-run cap **defers rather than drops** — the cursor only advances
  past what was actually announced, so the remainder arrives next sweep. PRs and
  `cloudflare-exception`-labelled issues (already announced by the exception
  scan) are filtered out. Titles are HTML-escaped for Telegram's parse mode.
  `fetchIssueStats` counts issues opened/closed since a day via the search API
  for the weekly report; failure → null → section omitted.
- `clerk-webhook.ts` — `handleClerkWebhook` + `verifyClerkWebhook`: the Clerk
  lifecycle receiver. Verifies the **Svix** signature manually (HMAC-SHA256 over
  WebCrypto — the same wire scheme Clerk's `verifyWebhook` uses, without the
  `@clerk/tanstack-react-start` bundle). Notifies on `user.created` /
  `session.created` / `organization.created`; sign-in is throttled per user via
  `CHM_HOOKS_KV` (`clerk-signin:v1:<user>`, 6h TTL). 501 unset secret, 403 bad
  sig, 202 otherwise; unknown events acknowledged and ignored; Telegram errors
  never fail the ack.
- `clerk-metrics.ts` — `fetchClerkMetrics`: best-effort total + new-in-window
  user counts via the Clerk Backend REST `GET /v1/users/count` (with
  `created_at_after`) using `CLERK_SECRET_KEY`. `windowSeconds` (24h daily, 7d
  weekly) is **carried on the result** so `formatWindowLabel` renders the label
  from the same value that produced the number — the label cannot claim "24h"
  while reporting a week. Missing key / non-2xx / error → `null` → the digest
  omits the Users section.
- `polar-notify.ts` — pure `classifyTransition` (prior plan + new plan + status
  → new/upgrade/downgrade/cancel/revoke/past-due) + `formatPolarNotify` (plan
  name, monthly value from `@chm/pricing`, period). The webhook reads the prior
  D1 row before persistence so upgrade vs downgrade is decidable.
- `billing-deps.ts` — the cloud-hooks implementations of the core collaborators:
  env-driven `planForProductId` (mirrors the dashboard's `CHM_POLAR_PRODUCT_*`
  map), lazy Clerk org creation over the Backend REST API, Polar customer re-key
  via the SDK, and the retry-wrapped D1 upsert. Funnel + audit hooks are no-ops
  in v1 (the dashboard still owns PostHog + org audit until cutover).
- `webhook.ts` — `handlePolarWebhook`: `validateEvent` (injectable for tests) →
  core → `notify`. 403 + `signature_failure` alert on a bad signature; 202 on a
  handled event; unhandled types are acknowledged silently.
- `index.ts` — `fetch` router (`/webhooks/polar`, `/webhooks/clerk`, `/healthz`) +
  `scheduled` (daily cron → digest, weekly cron → weekly report, everything else
  → the ops sweep: probes, `runExceptions`, `runIssues`). `resolveGitHub(env,
  label)` centralizes credential checks, repo parsing, and token minting for the
  three GitHub-backed capabilities (exception scan, issue watch, weekly issue
  stats); it returns null after one explanatory log line when GitHub is not
  configured. `runExceptions` additionally gates on `CF_OBSERVABILITY_API_TOKEN`
  + `CF_ACCOUNT_ID`: any missing → one log line, no-op (never a crash).

## Config (`wrangler.toml`)

- `name = chmonitor-hooks`, custom domain `hooks.chmonitor.dev` (auto-provisions
  DNS on the managed zone). **No `[triggers]` block** — the intended
  `*/15 * * * *` cadence is not attached because the account is over the
  Workers Free 5-crons-per-account budget (any schedules PUT fails after a
  successful script upload otherwise). Guarded by `src/cron.test.ts`
  (`wrangler.toml` must not declare `crons =`); re-attach
  `[triggers] crons = ["*/15 * * * *"]` if the account ever regains cron
  budget.
- D1 binding `CHM_CLOUD_D1` → `chm-cloud` (`database_id`
  `cca247b6-9b25-41bd-b9ca-727b35bc6039`, same as the dashboard).
- D1 binding `CHM_TELEMETRY_DB` → `chm_telemetry` (`database_id`
  `4887176b-0181-45bf-970f-a506f514d5a9`, the database `apps/telemetry` writes) —
  **read-only** here, for the Usage section. No `migrations_dir`: `apps/telemetry`
  owns that schema. Unbound → the Usage section is omitted.
- `CHM_HOOKS_KV` KV binding is **active** (id `a1d9bd2c4377493eac5b5d4ad04dcc34`) —
  it stores per-probe up/down state (`probe-state:v1`), outage escalation records
  (`probe-outage:v1`), exception fingerprints (`exc-fp:v1:<fp>`), exception rate
  baselines (`exc-rate:v1:<fp>`), and the new-issue watch cursor
  (`issue-watch:v1:last-created`). Absent → probes
  fall back to per-run state, the exception scan leans on the GitHub search
  fallback alone, and the **issue watch skips entirely** (a watch with no memory
  would re-announce the same issues every 15 minutes). Follows the `CHM_`
  binding-naming rule (like `CHM_CLOUD_D1`).
- **No secrets, no product-id vars committed.** Secrets set via
  `wrangler secret put` (CI does this, skipping any that are unset):
  `POLAR_WEBHOOK_SECRET`, `POLAR_ACCESS_TOKEN`, `CLERK_SECRET_KEY`
  (also read for the daily digest's Clerk user counts), `CLERK_WEBHOOK_SECRET`
  (the `whsec_…` Svix signing secret verifying `POST /webhooks/clerk`, repo
  secret `CLOUD_HOOKS_CLERK_WEBHOOK_SECRET`), `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`, plus GitHub issue-creation auth (**either** `GH_APP_ID` +
  `GH_APP_PRIVATE_KEY` for GitHub App auth — preferred — **or** `GITHUB_TOKEN`, a
  PAT with `issues:write`, repo secret `CLOUD_HOOKS_GITHUB_TOKEN`) and
  `CF_OBSERVABILITY_API_TOKEN`
  (token scope **Account → Workers Observability → Read**). The `CHM_POLAR_PRODUCT_*`
  map + `CHM_POLAR_SERVER` must be set (mirroring `apps/dashboard/.env.production`)
  before the Polar endpoint is cut over, or products won't map.
- **Exception-scan config** (non-secret, injected at deploy via `--var`, all
  optional with defaults): `CF_ACCOUNT_ID` (required to query — from
  `CLOUDFLARE_ACCOUNT_ID`), `GITHUB_REPOSITORY` (default `chmonitor/chmonitor`),
  `CHM_EXCEPTION_ISSUE_LABELS` (`bug,cloudflare-exception`),
  `CHM_EXCEPTION_MAX_ISSUES_PER_RUN` (`5`), `CHM_EXCEPTION_SCRIPTS`
  (`chmonitor-dash,chmonitor-hooks`).
- **New-issue watch config** (non-secret, optional — reuses the GitHub auth and
  KV above, no extra credentials): `CHM_ISSUE_WATCH_EXCLUDE_LABELS`
  (`cloudflare-exception`), `CHM_ISSUE_WATCH_MAX_PER_RUN` (`10`).

## GitHub App auth setup (issue creation)

The exception scan can file issues as the **`duyetbot` GitHub App** (preferred
over a PAT — no personal token, scoped, shows as the app). Operator steps:

1. **App permissions** — in the GitHub App settings, set **Repository →
   Issues: Read & write** (the only permission the scan needs).
2. **Install on the repo** — install the app on `chmonitor/chmonitor` (or the
   `GITHUB_REPOSITORY` you target).
3. **Generate a private key** — App settings → "Generate a private key". GitHub
   hands you a **PKCS#1** PEM (`BEGIN RSA PRIVATE KEY`). WebCrypto only imports
   **PKCS#8**, so convert it once:
   ```bash
   openssl pkcs8 -topk8 -nocrypt -in duyetbot.private-key.pem -out duyetbot.pkcs8.pem
   ```
   (Setting the PKCS#1 key directly fails fast with this exact hint.)
4. **Set the secrets** — `GH_APP_ID` = the app's numeric id, `GH_APP_PRIVATE_KEY`
   = the PKCS#8 PEM contents (escaped `\n` newlines are fine). Optionally set
   `GH_APP_INSTALLATION_ID` to skip the one-time installation lookup (otherwise
   it is resolved from the repo and cached in `CHM_HOOKS_KV`).

With App creds present, `GITHUB_TOKEN` is ignored. Remove both → the scan
falls back to the PAT; remove all GitHub creds → the scan no-ops.

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

Separately, the cron-driven ops sweep (digests, health probes, exception scan,
issue watch) is dormant for a different reason: no cron trigger is currently
attached (account cron budget, see "Config" above), independent of the Polar
cutover above. It stays dormant until the account regains cron budget.

## Operator step — Clerk lifecycle endpoint

To turn on the Clerk lifecycle notifications, in the **Clerk Dashboard →
Webhooks**, add an endpoint `https://hooks.chmonitor.dev/webhooks/clerk`
subscribed to the `user.created`, `session.created`, and `organization.created`
events, then copy its **Signing Secret** (`whsec_…`) and set it as the worker
secret `CLERK_WEBHOOK_SECRET` (`wrangler secret put CLERK_WEBHOOK_SECRET`, or the
`CLOUD_HOOKS_CLERK_WEBHOOK_SECRET` repo secret so CI sets it). Until the secret
is set the endpoint replies 501 and no lifecycle notifications are sent (no
crash). `CLERK_SECRET_KEY` (already set for org creation) additionally powers the
daily digest's user counts — no extra key needed.
