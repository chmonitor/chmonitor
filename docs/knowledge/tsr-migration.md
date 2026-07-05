---
id: tsr-migration
type: architecture
related: [static-site-architecture, deployment, mcp-server, rust-wasm-performance]
tags: [tanstack-start, migration, cloudflare-workers, vite, dual-target, agent]
---

# Next.js → TanStack Start migration

> **MIGRATION COMPLETE** (PR #1392 cutover, 2026-06-14). `apps/dashboard-tsr` was
> renamed to `apps/dashboard`; the legacy Next.js app was deleted. `apps/dashboard`
> is now the sole dashboard, TanStack Start, serving `dash.chmonitor.dev` via the
> `chmonitor-dash` worker. The dual-app parallel period is over.

The dashboard was migrated from **Next.js 15 (App Router + OpenNext on Cloudflare)** to
**TanStack Start** (`@tanstack/react-start` + `@cloudflare/vite-plugin`). The app now
lives at `apps/dashboard` (was `apps/dashboard-tsr` during the migration). Epic: #1392.

## Why / trade-offs

The pre-migration app was a **fully static Next.js SPA** — it deliberately
avoided SSR/server-components, which is exactly what TanStack Start exists to provide. So
the product value of the migration was ~zero; the justification is **engineering metrics**
(build time/memory, bundle size, dependency count) and removing the OpenNext layer. The
CF target is simpler: `@cloudflare/vite-plugin` → workerd directly, **no OpenNext, no
KV/R2/D1 incremental-cache layer**.

## Topology

```
apps/dashboard/
  vite.config.ts        # tanstackStart() + @cloudflare/vite-plugin (CF) | nitro() (Node)
  wrangler.toml         # name = chmonitor-dash, routes → dash.chmonitor.dev
  scripts/patch-wrangler-env.ts   # re-injects [[routes]]/[vars] the vite plugin strips
  src/
    routes/             # TanStack Router file routes (was app/)
      (dashboard)/ (docs)/ (peerdb)/   # route groups
      api/              # server routes (was app/api/*/route.ts)
    start.ts            # global request middleware (was middleware.ts)
    router.tsx, routeTree.gen.ts (generated, gitignored)
```

## Routing translation (Next → TSR)

| Next | TanStack Start |
|---|---|
| `app/foo/page.tsx` | `src/routes/(group)/foo.tsx` via `createFileRoute` |
| `app/api/x/route.ts` (`GET`/`POST`) | `createFileRoute('/api/x')({ server: { handlers: { GET } } })` |
| `[name]` / `[...slug]` dynamic | `$name` / `$` splat (`params.name`, `params._splat`) |
| `next/navigation` (useRouter/useSearchParams) | `@tanstack/react-router` (useNavigate / `Route.useSearch`) |
| `next/link`, `next/image`, `next/dynamic` | router `Link`, `<img>`, `React.lazy` |
| `middleware.ts` | `createStart({ requestMiddleware: [...] })` in `src/start.ts` |
| `export const dynamic = 'force-dynamic'` | (dropped) |

Typed `?host=` search params are declared on the **root route** (`__root.tsx`), so
`host` is a required search param every `Link` must carry (e.g.
`search={(prev) => ({ host: prev.host ?? 0 })}`).

## The ClickHouse env seam

Routes do `import { env } from 'cloudflare:workers'` then call
`bridgeClickHouseEnv(env)` (`@/lib/api/server-env`) before any `fetchData` — this copies
the Worker bindings into where `@chm/clickhouse-client`'s `getClient` looks, so the
downstream query code is unchanged across both build targets. On the Node target,
`cloudflare:workers` is aliased to a `process.env` shim (`src/lib/cloudflare-workers-shim.ts`).

## Dual build target (#1409) — Cloudflare AND Docker/Node

One source, two outputs, selected by `BUILD_TARGET`:
- **default / `cloudflare`**: `@cloudflare/vite-plugin` → workerd bundle, deployed via
  `wrangler deploy`.
- **`BUILD_TARGET=node`**: drop the CF plugin, add `nitro({ preset: 'node-server' })` →
  `.output/server/index.mjs` for the Docker image; `cloudflare:workers` aliased to the
  process.env shim.

## Hard problems solved during the migration

1. **`nitro` lockfile drift** — the dual-target work declared `nitro` in package.json +
   imported `nitro/vite`, but the lockfile was never updated, so local builds failed at
   config-load. Uncaught because dashboard-tsr was in **no CI job** at the time.

2. **OpenNext coupling for D1** — the conversation store binds D1 via `@chm/platform`'s
   `getCloudflareContext()` (an `@opennextjs/cloudflare` API that does **not** exist in a
   TanStack Start worker). Fix: a **native `cloudflare:workers` platform adapter**
   (`src/lib/platform-native.ts`, aliased as `@chm/platform`) reads bindings straight from
   the Worker `env`; D1 degrades to `null` (memory/client store) when unbound.
   `auto-migrate` is a **no-op** (D1 schema applied via `wrangler d1 migrations`).

3. **`server-only` sentinels** — Next's `import 'server-only'` resolves to a virtual
   module under TanStack that **throws** when pulled into the client/prerender graph.
   Removed from the ported server modules (the boundary is enforced by route placement).

4. **Worker size limit (free-tier 3 MiB)** — the agent subsystem pushed the worker to
   3.6 MiB gzip → deploy failed (`code 10027`). Root cause: the worker deploys
   `no_bundle: true`, so `wrangler` counts **every** `dist/server/assets` chunk — including
   `React.lazy` chunks — against the limit, so existing lazy boundaries didn't help. Fix:
   a Vite plugin (`chm:ssr-client-only-stub`) resolves browser-only render libs (mermaid,
   cytoscape, katex, dagre, codemirror) to an empty stub **in the worker/SSR environment
   only** (`this.environment.name !== 'client'`). They run exclusively in browser
   lazy-chunks, so the worker never needs them. **Worker: 3.6 → 2.36 MiB gzip (−37%).**
   Next headroom candidate: `@xyflow/react` (~349K). The clean long-term fix is **Workers
   Paid ($5/mo → 10 MiB)**.

## Auth model (important)

There are **two independent auth layers**:
- **Feature-permissions** (per-route `authorizeFeatureRequest`): `public`/`guest`/
  `authenticated` access per feature (Clerk). The agent routes self-enforce this in-handler.
- **API-key gate** (`src/start.ts` request middleware, ported from `middleware.ts`): when
  `CHM_API_KEY_SECRET` is set (`apiKeyAuthEnabled()`), **every `/api/v1/*` requires a
  `chm_` Bearer token → 401** (except `/api/v1/auth/api-key`). Config-driven: dormant when
  the secret is unset.

**Verified behavior:** `dash.chmonitor.dev` (Next prod) has the secret set, so a real
browser gets **401 on every `/api/v1/*`** — the dashboard is a key-gated deployment and
does not serve data anonymously. The TSR app must match this; the `src/start.ts`
middleware (#1397, PR #1428) restores that parity.

## Parity & verification

- **Pages: 82/82** return matching status on both deployments (`/tmp/compare-prod.sh`).
- **APIs**: both key-gated (401 to anonymous) once #1428 deploys.
- Build gate: `pnpm run build` (`vite build && tsc --noEmit`) must be green; 112 pages
  prerender. The dashboard is wired into CI (the `dashboard` job).

### Visual parity — app chrome + theme (was the big gap)

"Pages return matching status" only checks HTTP codes, NOT what renders. Three
visual gaps shipped to `dash-tsr` undetected because nothing diffs the DOM:

1. **Sidebar/header/breadcrumb chrome was never wired.** `(dashboard)/route.tsx`
   and `(peerdb)/route.tsx` were bare `<main>` placeholders ("ported in a later
   issue") even though every chrome component (`AppSidebar`, `HeaderActions`,
   `Breadcrumb`, `ResizableSidebarProvider`, `NavMain`, `HostSwitcher`,
   `NavUser`) was already ported. Fix: a shared `components/layout/dashboard-shell.tsx`
   (ported 1:1 from the Next `(dashboard)`/`(peerdb)` layout bodies, which were
   identical) used by both groups. `(dashboard)` wraps its children in
   `FirstRunGate`; `(peerdb)` does not — that's the only difference.
2. **shadcn theme tokens were missing from `styles.css`.** It had only
   `@import "tailwindcss"` + a shimmer keyframe — none of the `:root`/`.dark`
   OKLCH color vars or the `@theme inline` color mappings, so `bg-background`,
   `bg-sidebar`, `text-foreground`, `border-border` resolved to nothing. Fix:
   port the full Next `app/globals.css` theme, translating its
   `@config '../tailwind.config.js'` into inline `@theme` (keyframes/animations/
   radius/container) for the v4 CSS-first pipeline; add `tw-animate-css` (the
   shadcn Radix enter/exit animations depend on it).
3. **Root `/` was the "Hello from TanStack Start" stub**, not the
   `→ /overview?host=0` redirect. Fixed to mirror the Next root page
   (`useRouter().replace` via `next-compat`).

The chrome needs `TimezoneProvider` + `TimeRangeProvider` +
`BrowserConnectionsProvider` (header time-range picker reads `useTimeRange`) —
added to `__root.tsx`, all SSR-safe (`typeof window === 'undefined'` guards), so
prerender of the dashboard pages stays green. The chrome hydrates client-side
(the static shell is intentionally minimal); `window is not defined` lines during
prerender are pre-existing and non-fatal (client-only page content), not a regression.

> **Lesson:** add a DOM/visual parity gate (sidebar present, computed
> `--background` non-empty), not just status-code crawl. HTTP 200 ≠ rendered UI.

## Performance (framework shell, Next+OpenNext vs TanStack Start)

> Both deployments are key-gated, so this measures the **app shell + client JS** load
> (the migration's Win-Metric), not data. Captured via Chrome DevTools traces on
> `dash.chmonitor.dev` (Next) vs `dash-tsr.chmonitor.dev` (TSR). Single-sample, desktop,
> unthrottled — treat sub-second deltas as ±10-20%.

| Route | LCP Next | LCP TSR | Δ | Note |
|---|---|---|---|---|
| /dashboard | 1074 ms | **253 ms** | **−76%** | render-delay 1011→133 ms |
| /running-queries | 1146 ms | **478 ms** | **−58%** | |
| /explorer | 1094 ms | **622 ms** | **−43%** | |
| /agents | 837 ms | 818 ms | −2% | tie; but CLS 0→0.28 ⚠️ |
| /overview | 895 ms | 1280 ms | +43% ⚠️ | heaviest hydration; Next's static shell wins |
| /tables | 572 ms | — | 🐛 | broken redirect (see below) |

**Net:** TSR's lighter client bootstrap makes it **faster to LCP on the heavy
data-dashboard pages** (render-delay collapses), but it's not universal.

### Performance issues found (to fix)
1. **Trailing-slash redirect** — every TSR route 301/308s `/x` → `/x/`, adding a uniform
   **~55-60 ms TTFB** tax (confirmed by the DocumentLatency insight on all routes). Disable
   the trailing-slash redirect in the router/start config.
2. **`/tables` broken** — client-redirects to a malformed URL
   `/explorer?database=default%3Fhost%3D0?host=0` — the `?host=0` search string is encoded
   *into* the `database` param (double `?`). The redirect/search serializer concatenates
   instead of merging search params. Functional bug.
3. **`/agents` CLS 0.28** (Next: 0.00) — the chat composer/sidebar mounts after first paint
   without reserving height. Reserve layout space.

## Known follow-ups

- **`CLICKHOUSE_PASSWORD` is a per-worker secret** — `wrangler.toml` `[vars]`
  carry `CLICKHOUSE_HOST`/`USER`/`NAME`, but the password is injected via
  `wrangler secret put CLICKHOUSE_PASSWORD`. If charts show "Unable to connect to
  the server" while the data path is code-correct — env bridged via
  `bridgeClickHouseEnv`, web client auto-selected by `CLOUDFLARE_WORKERS=1` +
  `nodejs_compat_populate_process_env` — check that the secret is set on
  `chmonitor-dash` (and `--env preview`), then redeploy.
  Verify with `bun wrangler secret list` (top-level and `--env preview`).
- **Surfaced by wiring the chrome (#1433), deferred as separate items:**
  - **Refresh controls are no-ops on TanStack Query.** `HeaderActions`/
    `RefreshCountdown` (and the Cmd/Ctrl+R shortcut) still dispatch the SWR-era
    `swr:revalidate` window event; the Query data hooks don't listen. Bridge it
    to `queryClient.invalidateQueries()` once — but guard against doubling up
    with each query's own `refetchInterval`.
  - **Focus rings lost under the global shadow strip.** The project-wide
    `box-shadow: none !important` on buttons/cards (ported verbatim from the Next
    `globals.css`) also kills shadcn's `focus-visible:ring-*`. Narrow it to skip
    `:focus-visible` — apply to **both** apps' globals so they stay in parity.
  - **`--destructive-foreground` is mapped but undefined** in both apps'
    `globals.css` (`text-destructive-foreground` resolves to nothing; currently
    unused). Add the token to both files together if a consumer ever needs it.
- Conversation **server-persistence** needs a provisioned `CHM_CLOUD_D1`
  (`wrangler d1 create`) + binding in `wrangler.toml` + `patch-wrangler-env.ts`. Agent chat
  works via the client thread store until then.
- Copied agent-subsystem **test files** are excluded from the production typecheck
  (mirrors the Next app's tsconfig); wiring `bun test` for them is a follow-up.
- Make the **Cloudflare deploy a required CI check** — a size-failing deploy reached main
  during the migration because it isn't.

## Env migration: `NEXT_PUBLIC_*` → `VITE_*` (client) + back-compat

Next inlined browser vars as `process.env.NEXT_PUBLIC_*`; Vite inlines
`import.meta.env.VITE_*` at build time into BOTH client and server bundles.
Worker `[vars]` are **runtime-only** and never reach the client — so a
browser-needed value MUST be a `VITE_*` set during `vite build`, not just a
wrangler var.

Wiring (all four must stay in sync per var):
- `vite.config.ts` `CLIENT_ENV` + `define` block — inlines each `VITE_*` with
  precedence `VITE_X ?? NEXT_PUBLIC_X ?? <committed default>` (back-compat).
- `.github/workflows/cloudflare.yml` dashboard-tsr build step `env:` — sets
  `VITE_*` (pk_test for PR preview, pk_live for prod) + git metadata.
- `src/vite-env.d.ts` — types each `VITE_*`.
- `wrangler.toml` / `patch-wrangler-env.ts` — only the SERVER vars (`CHM_*`),
  never the client publishable key (it's build-time).

Server reads use runtime `CHM_AUTH_PROVIDER` → build-time
`import.meta.env.VITE_AUTH_PROVIDER` → legacy `NEXT_PUBLIC_AUTH_PROVIDER`
fallback. Security boundary: only PUBLIC values are `VITE_*`; secrets stay
server-side. Verify a build inlined the key: `grep -rl pk_live dist/client/assets/*.js` ≥ 1.

The user-facing upgrade notes live at `docs/content/migrating/v0-3.mdx`
("Migrate to v0.3") — keep that page non-technical (what changed + what to do).

### Agent auto-migrate prompt (hand to an AI agent on another repo)

```text
Migrate this project's client-exposed env vars from Next's NEXT_PUBLIC_* to the
Vite/TanStack VITE_* convention. Rules:
1. SCOPE: only CLIENT (browser) vars. Never rename server/runtime/secret vars
   (CLICKHOUSE_*, CHM_*, LLM_*, secrets).
2. READS: client `process.env.NEXT_PUBLIC_X` → `import.meta.env.VITE_X`; server
   reads use runtime var first, then `import.meta.env.VITE_X`, then keep
   `NEXT_PUBLIC_X` as a final back-compat fallback.
3. BUILD WIRING: Vite only inlines `import.meta.env.VITE_*` from the BUILD env,
   not runtime Worker vars. Add a vite.config define/CLIENT_ENV mapping
   `VITE_X ?? NEXT_PUBLIC_X ?? default` per var; set values in the CI build step.
   Keep secrets OUT of this block.
4. TYPES: declare each VITE_X in src/vite-env.d.ts.
5. CONFIG: drop dead NEXT_PUBLIC_* from runtime Worker [vars]; keep CHM_*.
   Update .env.example + docs.
6. BACK-COMPAT: old NEXT_PUBLIC_* names must still work.
7. SECURITY: never inline a secret into the client bundle.
Verify: build, then `grep -rl '<pk_ key>' dist/client/assets/*.js` ≥ 1. Report the diff.
```
