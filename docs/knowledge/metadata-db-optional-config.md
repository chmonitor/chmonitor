---
id: metadata-db-optional-config
type: spec
status: draft
updated: 2026-09-29
related:
  - cloud-saas-mode
  - deployment
  - product-design
  - ai-insights
  - static-site-architecture
tags:
  - metadata-db
  - configuration
  - env
  - configmap
  - alerting
  - health
  - self-hosted
---

# Metadata-DB-optional configuration

**Goal.** An operator deploying to Kubernetes (or Docker) **without** a
metadata database — no D1, no Postgres — must still be able to configure
alerts, thresholds, routing, quiet hours, maintenance windows, digests,
webhook targets, and channel delivery. Everything must be declarable from
environment variables or a mounted config file (ConfigMap).

**Status.** Audit complete. **The §1.2 premise was wrong and is corrected
below** (2026-09-29): the metadata backend is a documented *three-way* thing
(D1 / ClickHouse / Postgres), two domains already implement it in full, and the
`metadataDb.available` flag is wrong in **both** directions because it
duplicates that resolution instead of deriving it. Design decision **proposed,
not yet landed** — but the remaining decision is now one question, not a
rewrite. See [The asymmetry](#the-asymmetry) and
[Open questions](#open-questions).

> [!WARNING]
> Today this is **not** true. All twelve alert/settings stores are D1-only and
> degrade silently. The largest blocker is that `metadataDb.available` is
> derived independently of the canonical backend resolver, so it
> **over-reports** for Postgres-only deployments that every alert store then
> rejects, and **under-reports** for ClickHouse-state deployments that work
> fine. Read [The asymmetry](#the-asymmetry) first.

---

## What "the metadata database" is

There is no `metadataDb` module and no `CHM_METADATA_DB` env var. It is a
**capability flag derived from the presence of a binding or a URL**, computed in
one place — `routes/api/v1/config.ts:220-231`:

```ts
224:   let metadataDbAvailable = false
225:   try {
226:     metadataDbAvailable =
227:       getPlatformBindings().getD1Database('CHM_CLOUD_D1') !== null ||
228:       Boolean(readEnv('DATABASE_URL') ?? readEnv('POSTGRES_URL'))
229:   } catch {
230:     metadataDbAvailable = false
231:   }
```

Returned as `metadataDb: { available }` (`:245`), cached 5 minutes.

Client side — `lib/menu/metadata-db.ts` (the whole module):

| Export | Behaviour |
|---|---|
| `metadataDbSatisfied(item, config)` | **Fail-open**: an absent `metadataDb` block counts as satisfied |

Consumed through `resolveUnavailable` (`lib/menu/unavailable-visibility.ts`),
which the nav surfaces reach via `useUnavailableVisibility` /
`useGroupVisibility` (`components/menu/hooks/use-unavailable-visibility.ts`).
A `requiresMetadataDb: true` item is **dimmed**, never hidden, so the operator
can still find the feature they are about to enable — the tooltip is *"Requires
a metadata database — configure D1 or Postgres"* and the flyout sets it as the
row `title`. (Hidden is only reachable via an explicit per-item
`hideWhenUnavailable: true`, which nothing sets today — see #3463.)

---

## The asymmetry

**This is the thing to fix first.**

> **Corrected 2026-09-29.** An earlier revision of this note said a
> Postgres-only self-host was "a hypothetical today". **It is not.** It is
> documented and Helm-supported, and it is the reason the fix is cheaper and
> more obvious than this note first claimed. Evidence below.

### The root cause: the flag duplicates the resolver

`metadataDb.available` is computed in `routes/api/v1/config.ts:224-231` by
re-deriving the backend check from scratch:

```ts
getPlatformBindings().getD1Database('CHM_CLOUD_D1') !== null ||
  Boolean(readEnv('DATABASE_URL') ?? readEnv('POSTGRES_URL'))
```

Meanwhile the repo already has **one canonical answer** to "is there a state
backend, and which kind?" — `lib/state-backend/config.ts`, whose own docblock
states the resolution order used by its consumers:

> explicit backend override → D1 binding → **ClickHouse state env
> (`CHM_STATE_CLICKHOUSE_*`)** → **Postgres env (`DATABASE_URL` / `POSTGRES_URL`)**
> → local/memory fallback

`config.ts` imports nothing from `state-backend/config.ts`. One question, two
answers — and they disagree in **both** directions:

| Deployment | `metadataDb.available` | Reality | Direction |
|---|---|---|---|
| `CHM_CLOUD_D1` bound | `true` | correct | — |
| Nothing bound | `false` | correct | — |
| `DATABASE_URL` set, no D1 | **`true`** | conversations, insights + user connections work; **all 12 alert stores 501** | **over-reports** |
| `CHM_STATE_CLICKHOUSE_URL` set, no D1/`DATABASE_URL` | **`false`** | connection + dashboard state stores work; "Scheduled Reports" is dimmed for no reason | **under-reports** |

So this is not one asymmetry, it is a duplicated resolver. Fixing it by
subtraction (removing the Postgres clause) would leave the ClickHouse leg
still wrong.

### The Postgres leg is not hypothetical

`DATABASE_URL` / `POSTGRES_URL` is a **documented, supported** metadata backend:

- `deploy/helm/chmonitor/values.yaml:264` — *"a DB backend (`DATABASE_URL` /
  `POSTGRES_URL` …)"* as the stated prerequisite for connection storage.
- `docs/content/reference/environment-variables.mdx:478` — same, for user
  connections.
- `docs/content/guide/features/user-connections.mdx:31` — *"A database backend
  — `CHM_CLOUD_D1` on Cloudflare, or `DATABASE_URL` / `POSTGRES_URL` on Docker /
  Kubernetes."*
- `CHM_STATE_CLICKHOUSE_URL` is documented at `environment-variables.mdx:456-460`
  alongside the concrete table names (`chm_state_dashboards`,
  `chm_state_user_connections`).

**Three domains already honour all of it** — and they are the pattern to copy,
not a precedent that needs inventing:

| Domain | Resolver | DB backends |
|---|---|---|
| `lib/connection-store/resolve-store.ts` | ✅ | **D1 → ClickHouse → Postgres** (all three) |
| `lib/dashboard-storage/resolve-server-store.ts` | ✅ | **D1 → ClickHouse → Postgres** (all three) |
| `lib/conversation-store/resolve-store.ts` | ✅ | D1 → Postgres, plus non-DB fallbacks (AgentState, browser, memory) — **no ClickHouse** |
| **`lib/health/` (12 stores)** | ❌ | **D1 only, no `resolve-store.ts`** |

So two domains already implement the **full** three-way DB backend
(`connection-store`, `dashboard-storage`), a third implements the two-way subset
(`conversation-store`), and the alert surface implements neither. The health
domain is the **outlier**, not the frontier.

### What this does to the option analysis

The earlier revision priced option B as *"Large — twelve stores, twelve
migrations, a second DDL dialect"*. That estimate is wrong in the direction
that matters:

- The second DDL dialect **already exists, twice over**
  (`connection-store/postgres-store.ts`, `conversation-store/postgres-store.ts`).
- **There is no migration runner to feed.** Each Postgres store carries its own
  idempotent DDL and runs it lazily:
  `PostgresConnectionStore` has a `MIGRATION_SQL` block of
  `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE … ADD COLUMN IF NOT EXISTS`;
  `conversation-store/postgres-store.ts` documents *"Auto-migration on first
  query (idempotent CREATE TABLE IF NOT EXISTS)"*; the insights stores do the
  same (`weekly-report-store.ts:32`, `report-subscription-store.ts:26`).

So B is *"be the third domain that resolves a three-way backend"*, not *"invent
a second dialect"*.

### Options

| | Change | Blast radius | Trade-off |
|---|---|---|---|
| **A** | Narrow the flag to D1 for the alert surface | Small — split `metadataDb.available` into `available` + `writable` | Correct but incomplete: leaves the ClickHouse leg under-reporting, and locks a Helm-documented Postgres deploy out of alerting permanently. |
| **B** | Give the alert stores the three-way `resolve-store.ts` pattern | **Medium, and mostly copy-paste** — 12 stores gain a Postgres (and ClickHouse) implementation beside the D1 one, each carrying idempotent `CREATE TABLE IF NOT EXISTS`; the flag is then *derived* from `lib/state-backend/config.ts` instead of re-derived | Uniform with the domains that already work. Largest diff, but the full three-way shape is already proven twice in-repo. |
| **C** | Per-feature write-capability probe | Small | **Not an answer to this problem.** It renders the gap honestly; it does not close it, and it permanently strands a documented deployment. |

**Proposal: B — with A's fail-closed guardrail and C's honesty affordance on
top.**

1. **B** as the fix: the alert surface gets the same
   `resolve-store.ts` + per-backend store shape as `connection-store` and
   `dashboard-storage`,
   and `metadataDb.available` is *derived* from `lib/state-backend/config.ts`
   rather than re-derived, which fixes both directions at once.
2. **A** as the guardrail: the derived capability must fail **closed** — no
   backend resolvable means *unavailable*, never *unknown-because-unresolved*.
3. **C** only as a UI affordance **after** B — a per-feature capability the
   panels ask, so the honest states (no DB / degraded backend / not yet
   resolved) can render. On its own, C is what the triage comment feared:
   "makes the breakage quieter instead of fixing it".

Whoever confirms this: the remaining open question is *not* "A, B, or C" — it
is [Q2](#open-questions), which the evidence above now answers in B's favour.
Whichever is chosen, **do not ship a second, subtly different signal** — the
whole point is that there is currently one lie and we are not adding two.

---

## The gated surface

### Stores (all `apps/dashboard/src/lib/health/`)

| Store | Table | `getDb()` | Fails open? |
|---|---|---|---|
| `alert-routing.ts` (620 L) | `alert_routes` | `:113-115` | yes |
| `alert-channel-config-store.ts` | `alert_channel_config` | `:108-110` | yes |
| `alert-state-persist.ts` | `alert_state` | `:68-70` | yes |
| `alert-history-store.ts` | `alert_events` | `:79-80` | yes |
| `alert-ack-store.ts` | `alert_acks` | `:98` | yes |
| `alert-digest-buffer-store.ts` | `alert_digest_buffer` | `:65-66` | yes |
| `alert-digest-settings-store.ts` | `alert_channel_config` (sentinel `__digest__`) | `:46-47` | yes |
| `alert-suggestion-dismissals-store.ts` | `alert_suggestion_dismissals` | `:49` | yes |
| `custom-webhook-target-store.ts` | `alert_webhook_targets` | `:47` | yes (env fallback exists) |
| `custom-rules-store.ts` (267 L) | `custom_alert_rules` | `:59-68` | **no — throws `NOT_CONFIGURED`** |
| `maintenance-windows.ts` | `maintenance_windows` | `:107` | yes |
| `quiet-hours.ts` | `quiet_hours` | `:329-332` | yes (write throws) |

Binding selection: `CHM_CLOUD_D1` primary, with optional `MAINTENANCE_D1`
(`maintenance-windows.ts:34`, `quiet-hours.ts:36`) and `INSIGHTS_D1`
(`insights/store/d1-store.ts:33`) overrides.

Migrations: `apps/dashboard/src/db/conversations-migrations/` (39 files).
Alert-relevant: `0010_alert_events`, `0014_alert_acks`,
`0014_maintenance_windows`, `0014_custom_alert_rules`, `0015_alert_routes`,
`0016`, `0019`, `0020_alert_suggestion_dismissals`, `0021`, `0022_quiet_hours`,
`0024`, `0025`, `0026_alert_channel_config`, `0027_alert_digest`,
`0028_alert_state`, `0031_alert_webhook_targets`.

Owner scoping: `lib/health/alert-routing-auth.ts` — `SINGLE_TENANT_OWNER_ID = ''`
(`:25`), `resolveAlertRoutingOwnerId()` (`:32-38`, never throws),
`requiresSignInForWrite()` (`:46-48`, rejects anonymous only under Clerk).

### HTTP degradation modes

**Type A — `501` on write, client shows "not available":**

| Site | Line |
|---|---|
| `routes/api/v1/health/alert-config.ts` PUT | `:186-191` |
| `routes/api/v1/health/routes.ts` POST × 5 provider branches | `:195-200, 238-243, 282-287, 323-328, 364-369` |
| `routes/api/v1/health/custom-rules` | via `CustomRuleStoreError('NOT_CONFIGURED')` |
| `routes/api/v1/webhooks/subscriptions.ts` | `:46-52, 70-76` |
| `routes/api/v1/health/routes.ts` DELETE | `:389-392` → `404` (**not** 501) — silent |

**Type B — `200` + empty list (silent degradation):**

`alert-config` GET · `routes` GET · `alert-state` GET · `health/history` GET ·
quiet hours · maintenance windows · digest settings · suggested-alert dismissals ·
custom webhook targets (env fallback) · webhook subscriptions ·
**and the alert state machine's durability** — hysteresis streaks and incident
timers reset on every worker restart (`alert-state-persist.ts:108-191`).

**Type C — menu dimming:** `requiresMetadataDb: true` → "Scheduled Reports"
only (`menu/insights.ts`), and it dims rather than hides so the OSS discovery
path survives (#3463).

**Type D — works with no DB (must not regress):**

`/health` and all 19 checks · health thresholds (localStorage `health-thresholds`)
· browser/webhook/healthchecks client channels (localStorage
`health-alert-settings`) · all 8 server channels via env · the cron sweep and
every `HEALTH_ALERT_*` var · `HEALTH_THRESHOLD_<RULE>_WARNING|CRITICAL`
(`server-alert-config.ts:164-212`) · `HEALTH_HYSTERESIS_*` (`:482-508`) ·
`HEALTH_ALERT_WEBHOOK_TARGETS` JSON (`custom-webhook-env.ts:74`) ·
`CHM_CONFIG_SOURCE` / `CHM_CONFIG_DIRECTORY` / `CHM_PACK_REGISTRY_URL`.

### Storage is split three ways today

| Medium | Holds | Consequence |
|---|---|---|
| **localStorage** | thresholds, client channels | tab-scoped; the cron sweep can never see it |
| **D1** | channels, routes, rules, state, history, acks, digest, dismissals, targets, windows | server-wide, but needs a DB |
| **env** | `HEALTH_*`, `CHM_HEALTH_SWEEP_ENABLED` | the only path a DB-free deploy has today |

`alert-settings-storage.ts` exists precisely to work around the localStorage
blind spot; `alert-channel-config-store.ts` exists to make channels server-wide.
Any declarative source has to be reconciled with all three.

Note the asymmetry with the *backend* axis: the medium is three-way, but the
backend behind "D1" should be three-way too (D1 / ClickHouse / Postgres) once
prompt 1 lands. Today it is D1-only, which is why the third column's promise
(server-wide) is only kept on Cloudflare.

---

## `CHM_CONFIG_FILE` is documented but not implemented

The single most consequential finding for the stated goal.

**The only two code references are comments saying it is not implemented:**

- `routes/api/v1/config.ts:12` — *"No CHM_CONFIG_FILE loading: the dashboard's
  `loadConfigFile()` uses…"*
- `lib/feature-permissions/server.ts:7` — *"No CHM_CONFIG_FILE loading:
  `node:fs/promises` is not available in workerd."*

**It is documented as a working feature in 45 locations**, including a ConfigMap
mount example in the K8s guide:

| Doc | Lines |
|---|---|
| `docs/content/operate/advanced/feature-permissions.mdx` | 38, 42, 44, 133 |
| `docs/content/reference/configuration.mdx` | 17, 25 |
| `docs/content/reference/environment-variables.mdx` | 220 |
| `docs/content/operate/deploy/k8s.mdx` | 261, 268 |
| `docs/content/operate/deploy/docker.mdx` | 130 |
| `docs/content/operate/deploy/self-host.mdx` | 93 |
| `docs/content/guide/features.mdx` | 136 |
| `docs/content/guide/features/*.mdx` (16 pages) | one `# CHM_CONFIG_FILE (TOML)` section each |
| `apps/docs/src/content/docs/**` (generated mirror) | 24 more |

An operator following `deploy/k8s.md:261-268` today mounts a ConfigMap, sets
`CHM_CONFIG_FILE`, and **nothing happens** — feature permissions silently ignore
the file. That is precisely the failure mode this document exists to eliminate.
**One of the two mechanisms the docs already teach is a no-op.**

Resolution is a deliberate choice, not a drive-by edit:

- **Implement it** for the feature-permission surface at minimum, reusing
  `lib/query-config/declarative/local-loader.ts` as the model; or
- **Delete the file-config claims** and document `CHM_CONFIG_DIRECTORY` +
  `CHM_CONFIG_SOURCE` as the only file mechanism.

---

## The declarative patterns already in the codebase

Do not invent a third. Two exist and both are good.

### 1. The mode-defaults matrix

`apps/dashboard/scripts/deploy-defaults.ts` — no `@/` aliases so `bun` can
import it pre-build, and shared with `scripts/patch-wrangler-env.ts`:

```ts
16: export const DEPLOYMENT_MODES = ['oss', 'cloud'] as const
35: export interface ModeDefaults { cloudMode, authProvider, clerkPublicRead,
                                   userConnectionsDb, conversationDb, allowPrivateHosts }
59: export const MODE_DEFAULTS: Record<DeploymentMode, ModeDefaults> = { oss: {...}, cloud: {...} }
78: export function modeDefaults(mode: DeploymentMode): ModeDefaults
91: export function modeDefaultVars(mode: DeploymentMode): Record<string, string>
```

Consumed by `lib/config/deployment-mode.ts:69-96` `resolveConfig(getEnv)`, which
layers explicit overrides on the mode default through a tri-state `parseBool`
(`:52-58`; `1|true|yes|on|cloud` → true, `0|false|no|off` → false, else
`undefined`).

**Invariant (mirrors `lib/cloud` and `lib/edition`): fail-closed to `oss`. An
unset or junk value never enables a cloud or DB-backed behaviour.**

### 2. The per-feature flag

`lib/events/server-feature.ts:21-59` and `lib/connection-store/server-feature.ts`:

```ts
21: function isFeatureFlagEnabled(): boolean {
22:   const value = readEnv('CHM_FEATURE_WEBHOOK_SUBSCRIPTIONS') ?? readEnv('VITE_FEATURE_WEBHOOK_SUBSCRIPTIONS')
28:   if (value !== undefined && value !== '') return value === 'true' || value === '1'
30:   return parseDeploymentMode(readEnv('CHM_DEPLOYMENT_MODE')) === 'cloud'
31: }
33: function isClerkAuth(): boolean { ... }
44: function hasDatabaseBackend(): boolean {
45:   try { return Boolean(getPlatformBindings().getD1Database(D1_BINDING_NAME)) } catch { return false }
46: }
56: export function getWebhookSubscriptionsServerConfig(): WebhookSubscriptionsServerConfig {
58:   return { enabled: isFeatureFlagEnabled() && isClerkAuth() && hasDatabaseBackend() }
59: }
```

**This is the shape to mirror per alert feature**: explicit flag → deployment-mode
default → backend check.

### 3. The ConfigMap-mounted directory

`lib/query-config/declarative/local-loader.ts`:

```ts
33: const DEFAULT_CONFIG_DIRECTORY = '/etc/chmonitor/queries.d'
40: export function getConfigDirectory(runtimeEnv?): string   // reads CHM_CONFIG_DIRECTORY
50: export interface LoadLocalConfigsResult { loaded; skipped: Array<{ file, error }> }
63: export function loadLocalConfigs(dir: string): LoadLocalConfigsResult   // pure, sync, NEVER throws
140: let cachedCatalog                                            // process-lifetime memo
146: export function getLocalConfigCatalog(runtimeEnv?): Record<string, DeclarativeQueryConfig>
```

Bad YAML, schema violations, and duplicate names are pushed onto `skipped` and
warned — **never fatal**. That is the behaviour any new declarative loader must
match: hostile input must not take the app down.

⚠️ **Server-only module.** It statically imports `node:fs` and the YAML parser.
Every call site must gate on the **build-time** `import.meta.env.SSR` constant
(not a `typeof window` runtime check) so Vite dead-code-eliminates the import out
of the client bundle.

Companions: `declarative/loader.ts:48-57` `getConfigSource()` (runtime env
wins, then `import.meta.env.VITE_CONFIG_SOURCE`; anything but the literal
`'declarative'` → `'ts'`, fail-safe) and `declarative/pack-registry.ts:63-73`
`CHM_PACK_REGISTRY_URL` (comma-separated, `file://` or `http(s)://`,
SSRF-guarded, loaded once at startup).

---

## The decision

**Proposed: a declarative *source layer* that every store reads through, with D1
as an optional overlay — not a per-store env fallback.**

### Precedence

Highest wins:

1. **D1 row** (per-owner; the cloud/multi-tenant path)
2. **Config file** entry (`CHM_CONFIG_DIRECTORY`)
3. **Environment variable** (`CHM_*` / `HEALTH_*`)
4. **Built-in default**

Rationale: file beats env because a mounted ConfigMap is a deliberate,
version-controlled, human-reviewed artefact, while env is the fallback for a
quick override. This matches how Kubernetes operators actually work.

### Why a source layer, not per-store env fallback

| | Source layer | Per-store env fallback |
|---|---|---|
| Diff size | touches 12+ stores' read paths | smaller per store |
| Merge semantics | defined once | re-implemented 12 times, inconsistently |
| Precedence | one rule, testable | twelve implicit rules |
| Deleting a declarative alert | one path | may silently no-op where a DB row shadows it |
| Testability | one matrix test over (source × store) | twelve ad-hoc tests |

The fallback approach is cheaper up front and is what produced the current mess
(two of the twelve stores already have ad-hoc env fallbacks —
`HEALTH_ALERT_WEBHOOK_TARGETS`, `HEALTH_ALERT_DIGEST_MINUTES` — and the rest do
not).

### The read-only / writable boundary

This is the honest limit, and it must be stated in the docs rather than
discovered by an operator at 3am:

| Data | Declarative? | Why |
|---|---|---|
| **Alert definitions** (rules, thresholds, routing, channels, webhook targets, quiet hours, maintenance windows, digest settings) | **Yes** | Desired state. An operator declares intent. |
| **Alert state** (firing/cleared, hysteresis streak, incident start, last-notified) | **No** | *Observation*, not intent. It cannot be authored. |
| **ACKs, suggestion dismissals, digest buffer** | **No** | Per-user runtime state. |

So with no metadata database:

- Alerts **fire and deliver** from the declarative definitions. ✅
- The state machine runs **in memory**, per worker instance. Hysteresis streaks
  and incident timers **reset on every worker restart**
  (`alert-state-persist.ts:108-191`). ⚠️
- ACKs and dismissals have nowhere to persist and must be disabled in the UI
  rather than silently accepted. ⚠️

That last row is a UI honesty requirement, not an implementation detail: today
`POST /api/v1/health/ack` is best-effort, so the ACK button *appears* to succeed
and nothing is stored (`alert-ack-store.ts`).

---

## Implementation-ready prompts

One issue per row. Each is independent enough to ship separately, in this order —
the asymmetry first, because everything else gates on knowing what "available"
means.

### 1. Fix the `metadataDb.available` asymmetry (BLOCKING)

> **Restated 2026-09-29** after the premise correction. The old wording asked
> for a per-feature capability probe (option C). The evidence says the real fix
> is to stop re-deriving the backend and start deriving it.
>
> **Files:** `routes/api/v1/config.ts:220-231` (the duplicated check),
> `lib/state-backend/config.ts` (the canonical answer — reuse, do not extend),
> `lib/health/` (add a `resolve-store.ts` mirroring
> `lib/connection-store/resolve-store.ts`), then the twelve stores,
> `lib/menu/metadata-db.ts`, `lib/components/menu/types.ts:46`.
>
> **Do this:**
>
> 1. Export one `resolveStateBackend()` from `lib/state-backend/config.ts`
>    returning `'d1' | 'clickhouse' | 'postgres' | null`, in the precedence its
>    docblock already documents. D1 stays first (Cloud unchanged).
> 2. Derive `metadataDb.available` from **that** instead of the inline D1 +
>    `DATABASE_URL` test. This fixes the Postgres over-report *and* the
>    ClickHouse under-report in one change.
> 3. Add `lib/health/resolve-store.ts` with the same
>    D1 → ClickHouse → Postgres shape as `connection-store`, and give each of
>    the twelve stores a Postgres implementation carrying its own idempotent
>    `CREATE TABLE IF NOT EXISTS` (copy `PostgresConnectionStore.MIGRATION_SQL`).
>    **No migration runner** — the existing Postgres stores all self-bootstrap
>    on first query, and matching that is the point.
> 4. **Fail closed**: no backend resolvable ⇒ `unavailable`, never
>    `unknown-because-unresolved`. A per-feature capability the UI asks is a
>    *follow-up* (it is how the honest states render), not this step.
>
> **Tests:** a Postgres-env-but-no-D1 case reports health capabilities
> **available** (not 501); a `CHM_STATE_CLICKHOUSE_URL`-but-no-D1 case reports
> **available** (the regression the old flag had); an unbound case **fails
> closed**; and one matrix test asserts
> `resolveStateBackend()` and `metadataDb.available` can never disagree — that
> is the invariant the duplication broke.
>
> **Docs:** `docs/content/reference/environment-variables.mdx`,
> `docs/content/operate/advanced/feature-permissions.mdx`,
> `docs/knowledge/metadata-db-optional-config.md` (this file).

### 2. Resolve `CHM_CONFIG_FILE`

> Decide: implement, or delete the 45 doc references. **Do not leave it
> half-done.** If implementing, model it on
> `lib/query-config/declarative/local-loader.ts` — pure, sync, never throws,
> `skipped[]` for malformed input — and gate every call site on the build-time
> `import.meta.env.SSR` constant so `node:fs` never reaches the client bundle.
> If deleting, replace every `# CHM_CONFIG_FILE (TOML)` section with
> `CHM_CONFIG_DIRECTORY` / `CHM_CONFIG_SOURCE` and fix the K8s ConfigMap example
> at `docs/content/deploy/k8s.md:261-268`.
>
> **Tests:** a malformed file must not break config resolution; a valid file must
> override the built-in defaults.

### 3. The declarative config loader for health

> **New:** `lib/health/declarative/` — schema types + a loader modelled on
> `local-loader.ts`. `CHM_HEALTH_CONFIG_DIRECTORY` (default
> `/etc/chmonitor/health.d`), one YAML file per concern (alerts, routing,
> channels, quiet-hours, maintenance, digest). Reject-and-warn on unknown keys;
> never throw. Process-lifetime memo, like `getLocalConfigCatalog`.
>
> **Env:** one canonical `CHM_*` name per setting. If dual-surface, the client
> `VITE_*` is **derived** in `vite.config.ts` (`loadDeployEnv` + `CLIENT_ENV`,
> `:110-238`) and declared in `src/vite-env.d.ts`. Never ask an operator to set
> both.
>
> **Tests:** precedence matrix (D1 > file > env > default) per setting; a bad
> file degrades to env; an empty directory is a no-op.
>
> **Docs:** `.env.example`, `deploy/helm/**` `values.yaml` + README.

### 4. Route the read-only alert definitions through the source layer

> For each of: alert routes (`alert-routing.ts`), custom rules
> (`custom-rules-store.ts`), webhook targets
> (`custom-webhook-target-store.ts`), quiet hours (`quiet-hours.ts`),
> maintenance windows (`maintenance-windows.ts`), digest settings
> (`alert-digest-settings-store.ts`), channel config
> (`alert-channel-config-store.ts`).
>
> Add a declarative reader beside each store's D1 reader and a single merge
> helper implementing the precedence rule. Do **not** touch the state stores —
> see the read-only/writable table.
>
> **Tests:** one matrix test over (source × store); deleting a declarative entry
> must actually remove it when no DB row shadows it.
>
> **Constraint:** `custom-rules-store.ts` currently **throws**
> `NOT_CONFIGURED` (`custom-rules-store.ts:59-68`) while the other eleven fail
> open. Normalise it — an unbound DB with a declarative file must work, and an
> unbound DB with neither must render the honest "not available" state that
> `rule-builder.tsx:298-312` already shows.

### 5. Make the state stores honest without a DB

> `alert-state-persist.ts`, `alert-ack-store.ts`,
> `alert-suggestion-dismissals-store.ts`, `alert-digest-buffer-store.ts`.
>
> When no DB is available: keep the state machine in memory, and **disable ACK
> and dismissal in the UI** rather than accepting a write that is discarded.
> Surface the restart-resets-hysteresis consequence in the settings UI.
>
> **Tests:** a write with no DB returns the capability, not a silent success;
> the UI never renders an enabled ACK button it cannot honour.

### 6. Document the operator path

> `docs/content/reference/environment-variables.mdx` (new vars; the
> `CHM_CONFIG_FILE` row at `:220`), `docs/content/reference/configuration.mdx`,
> `docs/content/operate/deploy/k8s.mdx` (ConfigMap end-to-end), `deploy/helm/**`
> (`values.yaml`, `README`), `apps/dashboard/.env.example`.
>
> Lead with the **read-only/writable boundary** table. An operator must learn
> up front that declarative config can *fire* alerts but not *acknowledge* them.

---

## Invariants any implementation must preserve

1. **Fail closed to self-hosted.** An unset/junk value never enables a cloud or
   DB-backed behaviour. Mirrors `lib/cloud` and `lib/edition`.
2. **Never weaken OSS.** No core monitoring feature may depend on the metadata
   database. Alerts must work fully without it.
3. **One canonical name per setting.** One `CHM_*` name; any `VITE_*` client
   mirror is **derived** in `vite.config.ts`, never set twice.
4. **`wrangler.toml` declares no `[vars]`.** Secrets never land in a committed
   `.env*`; runtime vars are injected by
   `apps/dashboard/scripts/patch-wrangler-env.ts` (`:83-90` resolves
   `CHM_DEPLOYMENT_MODE` via `modeDefaultVars`; `:143-163` injects/strips the D1
   binding). Hosted non-secret config lives in `.env.production`.
5. **Hostile input must not take down the app.** Malformed or schema-violating
   config is reported, not fatal — match `loadLocalConfigs`.
6. **Do not change on-disk formats.** `alert_state` PK `(host_id, rule_id)`;
   incident id `hc-<host>-<check>-<sev>-<window>`; dedup key `${hostId}:${ruleId}`;
   the browser key `${hostId}::${checkId}`; `peerdb-mirror-health:<slug>` rule
   ids. Changing any of these orphans stored state.
7. **SSRF and secret hygiene stay.** Webhook targets are SSRF-guarded
   (`alert-config.ts:49-53, 166-175`); `validatePeerDBAlertMessage` has a
   secret-leak regex (`lib/peerdb/alerting.ts:298`) and `MAX_ERROR_SNIPPET = 160`.
8. **Server-only modules stay server-only.** Gate on build-time
   `import.meta.env.SSR` so `node:fs` is dead-code-eliminated from the client.

---

## Open questions

1. **Q1 — Precedence: does file really beat env?** Proposed yes. A counter-argument
   is that Kubernetes ConfigMaps are *how* env is set, so the two are the same
   input and precedence is arbitrary. Worth a decision before prompt 3. **Still
   open** — this is a genuine operator-experience preference, not a fact.
2. ~~**Q2 — Is option C enough, or does the alert surface need Postgres?**~~ —
   **ANSWERED 2026-09-29: the alert surface needs Postgres, and C is not
   enough.** A Postgres-only deploy is documented and Helm-supported
   (`deploy/helm/values.yaml:264`, `environment-variables.mdx:478`,
   `user-connections.mdx:31`), and two domains already implement the
   three-way backend. C would render a permanent gap in a supported
   configuration. The answer is **B**. See [The asymmetry](#the-asymmetry).
   The residual question — the *one* decision now on the table — is simply
   whether to confirm B, or to pick A and accept that a documented deployment
   loses alerting.
3. **Q3 — Should declarative config be readable by anonymous visitors?** An
   `HEALTH_ALERT_WEBHOOK_URL` in a file is a secret. Today
   `GET /api/v1/health/alert-config` returns `envConfiguredMap()` (booleans, no
   values) and masks secrets. A file-backed store must not leak targets or URLs
   to an unauthenticated GET. **Answered by invariant, not preference:** reuse
   `envConfiguredMap()`'s boolean-only shape for file-backed values too. Same
   rule, one code path.
4. **Q4 — Do we retire `requiresMetadataDb`?** It has one user, "Scheduled
   Reports" (`menu/insights.ts:62`). That item is backed by the insights stores,
   which **do** honour Postgres and ClickHouse — so the flag is not wrong for
   it; it is wrong for the *health* surface, which has none. **Recommendation:**
   do not delete it — fix its **input** by deriving the flag from
   `lib/state-backend/config.ts` (which also fixes the ClickHouse
   under-report). Retire it only if a per-feature capability lands.
5. **Q5 — Where does declarative alert *state* go if an operator later attaches a
   DB?** The merge rule must be specified up front or the first attach will
   produce a confusing discontinuity. **Still open** — this is a real design
   question and the merge rule cannot be inferred from the code.
