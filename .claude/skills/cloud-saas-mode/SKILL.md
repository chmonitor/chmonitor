---
name: cloud-saas-mode
description: >-
  Work on chmonitor's Cloud (SaaS) vs self-hosted (OSS) behaviour from ONE
  codebase. Use when changing how dash.chmonitor.dev differs from Docker/K8s/OSS
  builds: the cloud-mode flag, public read-only demo hosts, the welcome/setup
  onboarding page, per-user (D1) ClickHouse connections, host visibility for
  anonymous vs signed-in users, the "Test connection" error classifier and its
  docs links, or the "Try with sample ClickHouse" onboarding preset. Triggers:
  "cloud mode", "SaaS", "demo host", "welcome page", "setup page", "first-run",
  "add host error", "connection error", "read-only host", "hide hosts when
  signed in", "sample cluster", "sample ClickHouse", "try sample".
metadata:
  tags: saas, cloud, oss, self-hosted, onboarding, hosts, clerk, connection-errors, sample-cluster
---

# chmonitor Cloud (SaaS) mode

One codebase, two products. `dash.chmonitor.dev` = Cloud; Docker/K8s/self-built
Worker = self-hosted (OSS). The difference is runtime config behind one flag.

> This is a project skill kept under `.claude/skills/` (NOT `.agents/skills/`,
> which the `build:skills` registry scans for end-user AI-agent skills). Keep dev
> skills here so they never leak into the agent bundle.

## Golden rule

**Fail-closed to self-hosted.** Unset/junk `CHM_CLOUD_MODE` / `VITE_CLOUD_MODE`
→ NOT cloud → OSS unchanged. Cloud behaviour is ADDITIVE only. Never gate a core
monitoring feature behind cloud mode. (Mirrors `lib/edition` fail-open design.)

## The flag

- Resolver: `apps/dashboard/src/lib/cloud/cloud-mode.ts`
  - `isCloudModeClient()` — build-time, React/hooks (reads `VITE_CLOUD_MODE`).
  - `isCloudModeServer(env)` — runtime `CHM_CLOUD_MODE` wins over build-time.
  - `parseCloudMode(v)` — only `'true'|'1'|'cloud'` (trim/case-insensitive) → true.
- Build inline: `vite.config.ts` CLIENT_ENV + `src/vite-env.d.ts`. Each client
  `VITE_*` DERIVES from the canonical `CHM_*` (set the value once).
- Single source of truth: `apps/dashboard/.env.production` (+ `.env.preview` overlay).
  It feeds BOTH the vite client build (`CHM_BUILD_ENV=production|preview` →
  `build:production`/`build:preview`) AND the Worker runtime `[vars]`
  (`scripts/patch-wrangler-env.ts` injects the non-`VITE_` keys).
  `wrangler.toml` declares NO `[vars]` — never re-add one; edit `.env.production`.
- Self-hosted uses the same names from `apps/dashboard/.env.example` (Docker
  `env_file`, Helm `values.yaml`). Secrets only via `set-secrets.ts` / K8s Secret.

**Cloud mode is a BUILD-TIME contract (#2515).** The client bundle only sees the
baked-in `VITE_CLOUD_MODE`; it never reads runtime env. Booting a **prebuilt OSS
image** with runtime `CHM_DEPLOYMENT_MODE=cloud` / `CHM_CLOUD_MODE=true` splits
the product — server enforces cloud (demo guard) while the client renders OSS UI.
Enable cloud by setting `CHM_CLOUD_MODE` **before the build** (so the VITE
derivation runs), not only at runtime. Guard: `detectCloudModeMismatch(env)` →
`{server, clientBuild, mismatch}`; `/api/healthz` `warn`s and reports `cloudMode`
on mismatch. The reverse (cloud build, runtime unset) is safe — fail-closed.

## Behaviour

| | Self-hosted | Cloud |
|---|---|---|
| Env hosts | real, full access | `source:'demo'`, read-only |
| Anonymous | env hosts | the demo |
| Signed-in | env hosts | demo HIDDEN → own D1 connections; zero → welcome/setup |

Implemented in `lib/swr/use-merged-hosts.ts` (tag demo, hide-when-signed-in;
returns `cloudMode`/`isSignedIn`). Switcher badges + `demo`-as-`env` status in
`components/host/host-switcher.tsx`.

## Welcome / setup page

`components/host/first-run-empty-state.tsx` renders 3 variants by
`(cloudMode, isSignedIn)`: cloud signed-in (Connect-your-host + Add-host dialog),
cloud anon (sign-in + value prop), self-hosted (env-var guidance + browser add).
Gate `ClerkSignInButton` behind `isClerkEnabled()`.

**Plan-before-first-host (cloud):** the signed-in variant is a two-step
`'plan' | 'connect'` flow. Every plan — including the $0 Free tier — is a REAL
Polar subscription: Free goes through checkout too (`startCheckout('free',
'monthly', {returnPath:'/'})`, no card). The server enforces it: `POST
/api/v1/user-connections` returns 402 with `details.reason =
'subscription_required'` when the owner has no live subscription (cloud mode +
billing configured only; OSS fails open). `AddHostDialog` catches that 402 →
toast with "Choose a plan" → `/billing`, which shows "Start Free — $0" for a
never-subscribed user. Client fail-open mirrors the server: Free checkout 501
("billing not enabled") falls back to plain continue.

**"Try with sample ClickHouse" preset** — a DIFFERENT thing from the `demo` host
above (server env-configured, cloud-only): a one-click preset any user (OSS or
cloud signed-in) can add through the NORMAL add-host path, for the "must own a
cluster to try it" barrier. Not shown to cloud anon visitors (they already get
the automatic demo). `components/connections/sample-preset.ts` is the single
constant (`SAMPLE_CLUSTER_PRESET` + `isSampleClusterHost`) — currently the
public ClickHouse Playground (`play.clickhouse.com`/`explorer`, non-secret,
DDL/INSERT rejected server-side); that shared demo also denies several
`system.*` tables chmonitor needs (query_log, parts, merges, processes,
replicas, mutations, disks, errors), so operational pages show their normal
empty/error states against it — schema browsing, metrics/settings/functions,
and SQL/AI chat work. `add-host-dialog.tsx`'s `initialPreset?: 'sample'` must be
set explicitly (incl. `undefined`) on every open — the dialog is reused, not
remounted per-CTA. `components/host/sample-cluster-banner.tsx` is the
dismissible "Connect your own cluster" convert nudge shown once the sample is
connected. Full detail: `docs/knowledge/cloud-saas-mode.md`.

## Connection-error help

`lib/connection-errors.ts`:
- `classifyConnectionError(raw)` → `{kind,title,explanation,fix,docsSlug,raw}`.
  Kinds: host_not_allowed, invalid_url, auth_failed, access_denied, dns_error,
  connection_refused, tls_error, timeout, mixed_content, unknown. Add new
  patterns by extending `RULES` (first match wins, specific first).
- `extractConnectionErrorMessage(body)` handles `{error:string}` (test route)
  AND `{error:{message}}` (shared validation builder).
- Rendered by `ConnectionErrorPanel` in `connection-form.tsx`.
- Docs page slug: `guides/connection-errors`
  (`docs/content/guide/guides/connection-errors.mdx`).

## Build/test gotchas

- `apps/dashboard` is NOT a root bun workspace → `cd apps/dashboard && bun install`.
- Build inside `apps/dashboard`: `bun run build` (vite + tsc --noEmit).
- Tests: `bun test src/lib/cloud src/lib/connection-errors.test.ts`.
- Full reference: `docs/knowledge/cloud-saas-mode.md`.

## Keep this skill current

When you change cloud-mode behaviour, demo-host visibility, the welcome/setup
page, per-user connections, or the connection-error classifier, UPDATE this file
and `docs/knowledge/cloud-saas-mode.md` in the same change. See the
"Auto-improve project skills" note in the root `CLAUDE.md`.
