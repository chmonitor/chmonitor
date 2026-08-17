---
id: cloud-saas-mode
title: Cloud (SaaS) mode — one codebase, two products
type: spec
status: active
updated: 2026-08-17
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
  - commercial-license
---

# Cloud (SaaS) mode

`dash.chmonitor.dev` is the hosted product; Docker / Kubernetes / a self-built
Cloudflare Worker are the self-hosted (OSS) product. **Same codebase** — the only
difference is runtime configuration, gated by the **cloud-mode** flag.

Operators who already self-host ClickHouse should buy a
[commercial license](commercial-license.md), not a hosted Polar seat.

## The invariant

FAIL-CLOSED to self-hosted. Unset/junk `CHM_CLOUD_MODE` (runtime) or
`VITE_CLOUD_MODE` (build) → NOT cloud → OSS behaviour unchanged. Cloud is purely
additive; it never removes a monitoring feature. Mirrors `lib/edition`'s
fail-open design (edition already lists `cloud` as an enterprise feature).

## Cloud mode is a BUILD-TIME contract (#2515)

Enabling cloud mode requires a **cloud build**, not just a runtime flag. The
client bundle only ever sees the baked-in `VITE_CLOUD_MODE` (inlined from the
canonical `CHM_CLOUD_MODE` in `vite.config.ts` at build time); it never reads
runtime env. So booting a **prebuilt OSS image** (e.g. the published Docker
image, client built without `VITE_CLOUD_MODE`) with runtime
`CHM_DEPLOYMENT_MODE=cloud` / `CHM_CLOUD_MODE=true` **splits the product**: the
server enforces cloud (demo-host guard, private-host blocking) while the client
renders OSS UI (no demo badges, no welcome flow). The correct way to enable
cloud is to set `CHM_CLOUD_MODE` **before the build** so the VITE derivation
runs — which is exactly what `dash.chmonitor.dev` does via committed
`.env.production` + `CHM_BUILD_ENV=production`.

The reverse (a cloud build with the runtime var unset) is safe — fail-closed
degrades BOTH halves to OSS together.

**Guard:** `detectCloudModeMismatch(runtimeEnv)` in `lib/cloud/cloud-mode.ts`
returns `{ server, clientBuild, mismatch }`. `/api/healthz` computes it every
readiness check, logs a prominent `warn(...)` on mismatch, and surfaces the
result as `cloudMode` in its JSON so operators (and probes) can spot the
split-brain. Detection is pure and unit-tested (`cloud-mode.test.ts`); the
`clientBuildValue` arg is injected there to vary the build-time half.

## Behaviour matrix

| | Self-hosted (default) | Cloud (`CHM_CLOUD_MODE=true`) |
|---|---|---|
| Env `CLICKHOUSE_HOST` | operator's real hosts, full access | public **read-only demo** (`source:'demo'`) |
| Anonymous | sees env hosts | sees the demo (explore, no account) |
| Signed-in | sees env hosts | demo hidden → own D1 connections only; zero → welcome/setup |
| Auth | usually `none` | Clerk + `CHM_CLERK_PUBLIC_READ=true` |
| Per-user conns | optional | on (`VITE_FEATURE_USER_CONNECTIONS_DB=true`) |
| Agent (anon) | IP rate limit only, no daily cap | daily guest cap (default 3) + tighter RL (5/min); D1 `guest:<ip-hash>` |

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

- `apps/dashboard/src/lib/cloud/cloud-mode.ts` — resolvers + `parseCloudMode` + `detectCloudModeMismatch` (build-time-vs-runtime split-brain guard, #2515). Tested.
- `apps/dashboard/src/routes/api/healthz.ts` — logs a `warn` and reports `cloudMode` (the mismatch result) on every readiness check.
- `vite.config.ts` `loadDeployEnv` + CLIENT_ENV + `src/vite-env.d.ts` — client `VITE_CLOUD_MODE` DERIVES from canonical `CHM_CLOUD_MODE` (set once).
- `apps/dashboard/.env.production` (+ `.env.preview` overlay) — **single source of truth** for the hosted product's non-secret config (`CHM_CLOUD_MODE=true`, `CHM_FEATURE_USER_CONNECTIONS_DB=true`, auth, LLM). `wrangler.toml` declares NO `[vars]`.
- `scripts/patch-wrangler-env.ts` — reads `.env.production`/`.env.preview`, injects the non-`VITE_` keys as Worker runtime `[vars]` at deploy.
- `.github/workflows/cloudflare.yml` build step — `build:preview` (PRs) / `build:production` (main) set `CHM_BUILD_ENV`; values come from the `.env*` files, none hardcoded.
- `lib/swr/use-merged-hosts.ts` — demo tagging, hide-when-signed-in; exposes `cloudMode` / `isSignedIn`.
- `components/host/host-switcher.tsx` — Demo / read-only badges; `demo` behaves like `env` for live status (server-backed by index).
- `components/host/first-run-empty-state.tsx` — welcome/setup (cloud signed-in / cloud anon / self-hosted). Signed-in cloud goes straight to connect (no Polar plan picker). `POST /api/v1/user-connections` does not require a Polar subscription. Paid path is landing `/pricing` → `hooks.chmonitor.dev/checkout/license`. The dashboard has no `/billing` page.
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
  `isSampleClusterHost`. Additionally takes `initialEngine?: ConnectionPreset`
  (which tab to open on) and is **engine-aware**: it tracks the form's current
  preset via `ConnectionForm`'s `onEngineChange`, swaps the dialog
  title/description through `addHostDialogChrome(preset)` (connection-presets.ts,
  "Add Postgres source" vs "Add ClickHouse host"), passes
  `engineForPreset(preset)` to `ConnectionHelpPanel engine=…`, and on a
  successful Postgres save routes to `/postgres/queries?pg=<connectionId>`
  (the `?pg=` id space) instead of `?host=`.
- `components/connections/connection-help-panel.tsx` — right-side guidance aside;
  `engine?: SourceEngine` prop renders a ClickHouse or Postgres variant (flow
  diagram third node + accent tint, requirements list). Fail-closed to
  ClickHouse.
- `components/host/first-run-empty-state.tsx` — `EngineChooser` renders a
  two-engine chooser: "Connect ClickHouse" (`welcome-add-host`) plus, when
  `isFeatureEnabled('postgresSource')`, "Connect Postgres" (Beta,
  `welcome-add-postgres`) in `ConnectYourHost` (cloud signed-in) and
  `SelfHostedSetup`; each opens `AddHostDialog` on the matching tab. Falls back
  to a single full-width ClickHouse button when the flag is off (zero visual
  change for OSS ClickHouse-only). Secondary "Try with sample ClickHouse" CTA
  stays below; not in `SignInToConnect` (redundant with the automatic demo).
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

## Guest AI credits — cloud SaaS only

Anonymous Cloud visitors can **actually reach** the agent on the demo host
(`dash.chmonitor.dev`). Clerk public-read still 401s unsigned writes, so
**do not** flip `CHM_FEATURE_AGENT_ACCESS=public`. The guest allow is a
wrapper in `lib/auth/agent-api-auth.ts`: `isCloudModeServer()` +
`publicReadEnabled()` + unsigned → allow only `/api/v1/agent`,
`/api/v1/agents/models`, `/api/v1/agents/config-check`, and
`/api/v1/agent/followups`. `anonymousCapabilities.write` stays false;
actions, SQL console, user-connections, and conversation persist stay
Clerk-only. OSS Clerk deployments stay gated.

The client (`agent-auth-gate.tsx`) treats Cloud + unsigned as a guest
(`ensureAuthed()` true). Unsigned Cloud threads stay in localStorage —
conversation APIs remain Clerk-only.

Guests share the deploy `ANYROUTER_API_KEY`, defaulting to
`anyrouter:auto` (top tool-capable models). Server hardening
(`hardenGuestAgentRequest`) strips body `apiKey` (no BYOK), ignores
`mcpServers` / user-registered MCP, allowlists auto + `anyrouter/free`,
and keeps `hostId` on env/demo (`>= 0`).

They are **not** unlimited: a dedicated daily message cap and a tighter
per-identity rate limit sit in front of the shared AnyRouter key. OSS /
self-host skips this entirely (fail-closed to self-hosted).

- **Identity**: `guestOwnerIdFromIp(ip)` in `lib/billing/guest-ai.ts` →
  `guest:` + first 16 hex chars of SHA-256(client IP). Do **not** key D1 /
  AnyRouter by the literal owner id `guest` (that would share one global
  bucket). IP comes from `clientIpKey(request)`.
- **Daily cap**: `CHM_GUEST_AI_REQUESTS_PER_DAY` (default **3**, fail-closed
  to 3 on unset/junk). ≤ Free (`aiRequestsPerDay` 5). No monthly USD budget,
  no Polar. `applyAiUsageGate` (`routes/api/v1/-agent/billing.ts`) reserves
  `ai_usage_daily` for that guest owner and returns 402
  `details.reason: 'guest_daily_limit'` when exhausted (copy tells them to
  sign in — no Polar jargon).
- **Rate limit**: IP bucket first (existing `RATE_LIMIT_AGENT_PER_MIN`), then
  Cloud guests get `agent:guest:${guestOwnerId}` at
  `RATE_LIMIT_AGENT_GUEST_PER_MIN` (default **5**). Signed-in stays
  `agent:user:${userId}` at 10/min. OSS guests stay IP-only.
- **Usage UI**: `GET /api/v1/billing/usage` returns a slim Guest payload
  (`planId: 'guest'`, `aiMessages` from `getAiUsageToday(guestOwnerId)`) when
  Clerk is missing **and** cloud mode. OSS unsigned stays 401.
  `useAiQuota` / `parseQuota` read `data.aiMessages` so the quota chip shows
  for guests (and signed-in users).
- **AnyRouter attribution**: `openRouterUser` is `${guestOwnerId}/${sessionId}`
  so the usage explorer groups by guest hash, not a single `guest` string.

## Billing (Polar) — not in the dashboard

The dashboard does **not** sell plans. Polar checkout, license product IDs,
and the customer portal live on landing (`chmonitor.dev/pricing`) and
[`apps/cloud-hooks`](cloud-hooks-worker.md) (`hooks.chmonitor.dev`).

Cloud-only leftovers in the dashboard are **quota / guest AI / fail-open
entitlements**, not Polar seats:

- **Plans catalog**: `lib/billing/plans.ts` still describes Cloud capability
  floors (AI daily/budget, retention). Host/seat hard caps are off (`null`).
  Public paid SKUs are `@chm/pricing` `LICENSE_SKUS` on landing.
- **Entitlements**: `lib/billing/entitlements.ts` + guest AI
  (`lib/billing/guest-ai.ts`, `applyAiUsageGate`). OSS fails open.
- **Usage API**: `GET /api/v1/billing/usage` remains for the agent quota chip
  (including slim Guest payload). No checkout/portal/subscription/can-downgrade
  routes.
- **Polar product env**: `CHM_POLAR_*` belongs in
  `apps/cloud-hooks/.env.production`. Never in dashboard `.env.production` /
  `.env.example`.
- **Webhook**: dashboard `/api/v1/webhooks/polar` is a leftover adapter over
  `@chm/billing-webhook-core` until Polar cutover to hooks. Secrets only — no
  product UUIDs in dashboard env.
- **Setup**: `apps/dashboard/scripts/polar-setup.ts` writes
  `CHM_POLAR_LICENSE_*` to `apps/cloud-hooks/.env.production`.

## Gotchas

- **Browser-connection proxy routes require a sessionToken in cloud mode
  (#2951).** `/api/v1/browser-connections/{proxy,charts/$name,tables/$name}`
  all resolve credentials via `resolveProxyCredentials`
  (`lib/connection-query/resolve-credentials.ts`). It accepts either a
  `sessionToken` (minted by `/browser-connections/sessions` after validating
  the connection) or inline `connection.{host,user,password}` from the request
  body. In cloud mode (`isCloudModeServer()`) the inline path is **rejected**
  — these are public, unauthenticated endpoints, and honoring raw creds would
  let anyone use the deployment as a ClickHouse credential-spraying relay from
  the operator's egress IP. The inline path stays enabled for self-hosted
  deployments (default), which are typically not publicly exposed and rely on
  it for the browser-connections feature. The legitimate client
  (`lib/swr/browser-proxy-fetcher.ts`, `lib/host-fetch/resolve-host-fetch.ts`)
  always mints a sessionToken first, so this is purely a hardening gate for
  callers hitting the API directly.
- **`/browser-connections/{test,sessions}` are IP-rate-limited (#2978).** Both
  are unauthenticated (must be reachable before a session/connection exists)
  and dial an attacker-supplied host on every request — `test.ts` runs
  ClickHouse `SELECT version()` or Postgres `getPostgresVersion()`, `sessions.ts`
  runs `queryConnection` (`SELECT 1`) plus an encrypt + session-store write on
  success. Without a throttle this is an unauthenticated outbound-connection
  oracle (port/host scanning, credential stuffing) relayed through the
  deployment's own egress IP, even though the SSRF guard above blocks private
  targets. Same `checkRateLimitDurable` pattern as `/api/mcp`
  (`lib/api/rate-limiter.ts`, `getBrowserConnectionRateLimitPerMin`, default
  10/min, env `RATE_LIMIT_BROWSER_CONN_PER_MIN`), with **distinct bucket-key
  prefixes** (`browser-conn-test:ip:` / `browser-conn-sessions:ip:`) so a burst
  against one route doesn't consume the other's budget. The check runs before
  any outbound work: right after body parse in `test.ts` (covers both the
  ClickHouse and Postgres branches from one call site), and in `sessions.ts`
  right after the existing `isEncryptionConfigured()` 503 check (cheaper, no
  socket, checked first) but before body parse / `queryConnection`. Uses its
  OWN dedicated `CHM_RATE_LIMIT_BROWSER_CONN` Worker binding (namespace_id
  `2004` in `wrangler.toml`, `simple = { limit = 10, period = 60 }`) rather
  than sharing `CHM_RATE_LIMIT_API` — that binding's 100/min edge threshold is
  sized for cheap GET data routes and would be far too loose for a route that
  dials out. Applies unconditionally (not cloud-only) since it costs nothing on
  self-hosted deployments.
- `apps/dashboard` is NOT a root pnpm workspace — run `pnpm install` *inside*
  `apps/dashboard`, not just at the monorepo root.
- The dashboard `build` script calls `vite` directly; run via `pnpm run build`
  from inside `apps/dashboard` (its local `.bin`), not from the repo root.
- Build needs `VITE_CLOUD_MODE`/`VITE_FEATURE_USER_CONNECTIONS_DB` inlined to
  exercise cloud behaviour locally — they are build-time, not runtime, on the
  client.
