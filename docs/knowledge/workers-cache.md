---
id: workers-cache
title: Cloudflare Workers Cache
type: reference
status: active
updated: 2026-07-06
tags:
  - cloudflare-workers
  - cache
  - performance
  - docs
  - blog
  - landing
related:
  - deployment
  - static-site-architecture
  - k8s-health-probes
---

# Cloudflare Workers Cache

[Workers Cache](https://blog.cloudflare.com/workers-cache/) (launched
2026-07-06) is a tiered cache that sits **in front of** a Worker. You enable it
per-worker in the wrangler config and then control it with standard HTTP
response headers.

Enable it in `wrangler.toml`:

```toml
[cache]
enabled = true
```

## Why it is safe to enable

- **Opt-in per response.** Only responses that are *explicitly* cacheable
  (`Cache-Control: public, max-age=…`) are stored. A response with no `public`
  cache directive is never cached — so merely turning the flag on changes
  nothing until a route opts in.
- **Authorization is auto-bypassed.** Requests carrying an `Authorization`
  header skip the cache entirely. ⚠️ Clerk auth **cookies** are NOT
  `Authorization` headers, so this is not a safety net for cookie-authed apps —
  only mark a response `public` when it is genuinely identical for every
  visitor.
- **On a HIT the Worker does not run** (no CPU billing). Once enabled, static
  asset and worker-to-worker requests bill at the standard request rate.
- Response controls: `Cache-Control: public, max-age=<fresh>,
  stale-while-revalidate=<stale>` (SWR serves stale instantly while refreshing
  in the background), plus `Cache-Tag` / `Vary`. Purge from the owning
  entrypoint via `ctx.cache.purge({...})`.

## chmonitor rollout

| Worker | `[cache]` | Public `Cache-Control` set? | Notes |
|--------|-----------|-----------------------------|-------|
| `apps/docs` (Fumadocs) | ✅ enabled | ✅ yes | Public docs — see below. |
| `apps/landing` (Astro) | ✅ enabled | — (static assets) | Assets-only Worker; built assets already carry their own cache headers. |
| `apps/blog` (Astro) | ✅ enabled | — (static assets) | Same as landing. |
| `apps/dashboard` (TanStack Start) | ✅ enabled | ❌ **never** | Per-user (Clerk) + per-host; nothing is marked `public`. Flag is safe by default. |
| `apps/telemetry` | ✅ enabled | ❌ no | Write-only POST ingest; only GET is a static text banner. No-op but safe. |
| `apps/mcp` | ✅ enabled | ❌ no | Authed JSON-RPC; `Authorization` requests auto-bypass. No-op but safe. |
| `apps/bug-handler` | ⛔ skipped | — | Email Worker (not HTTP-cacheable). |

### docs — public pages get `public` caching

`apps/docs` is a Fumadocs (TanStack Start) site with **no per-user content**, so
its pages are safe to cache. A response-cache middleware in
[`apps/docs/src/start.ts`](../../apps/docs/src/start.ts) stamps

```
Cache-Control: public, max-age=300, stale-while-revalidate=86400
```

onto public `GET` responses (doc pages, the raw `.md` / `llms.txt` endpoints, OG
images). It runs **outermost** in `requestMiddleware` so it can set the header on
the final response, and it skips:

- `/api/*` routes (e.g. the search index endpoint) — they manage their own caching,
- any response that already declares `Cache-Control`,
- non-`GET` / non-200 responses,
- requests carrying `Authorization` (also auto-bypassed by Workers Cache itself).

`max-age=300` (5 min fresh) keeps content reasonably current; the 1-day
`stale-while-revalidate` window means edits still serve instantly from cache and
refresh in the background.

### landing / blog — static assets, flag only

`apps/landing` and `apps/blog` are **static-assets-only** Workers (Astro builds
to `./dist`, served directly by Workers Assets — there is no server `main`
entry). The built assets already ship their own `Cache-Control` headers, so
there is no request handler in which to set headers. Enabling `[cache]` simply
layers Cloudflare's tiered edge cache in front of those assets — this is the
correct and complete outcome for these apps.

### dashboard — stays uncached (by design)

`apps/dashboard` (`dash.chmonitor.dev`) is heavily per-user and per-host: Clerk
auth, per-user D1 connections, `?host=N` routing, live ClickHouse data. We
**enable the `[cache]` flag** (safe by default — nothing caches without an
explicit `public` directive) but deliberately **never mark any response
`public`**. Existing dashboard cache directives are intentionally NOT the
worker-cache `public` kind:

- data/SSR/auth routes use `no-store` or `private` (never stored),
- some read endpoints (`/api/v1/explorer/*`, `hosts`, `tables`) use
  `public, s-maxage=…` — `s-maxage` targets a **shared CDN** cache, and these
  responses are still host-scoped, so they must not be promoted to a plain
  `public, max-age` for this worker cache.

If a future dashboard route is unambiguously public and identical for everyone,
only then consider adding `Cache-Control: public`; when in doubt, leave it
uncached — the enabled flag alone is harmless.

## Code refs

- `apps/docs/wrangler.toml`, `apps/landing/wrangler.toml`,
  `apps/blog/wrangler.toml`, `apps/dashboard/wrangler.toml`,
  `apps/telemetry/wrangler.toml`, `apps/mcp/wrangler.toml` — `[cache]` blocks.
- `apps/docs/src/start.ts` — `cacheHeadersMiddleware` (public `Cache-Control`).

## See also

- [[deployment]] — Docker + Cloudflare Workers dual deployment.
- [[static-site-architecture]] — TanStack Start + CF Worker rendering model.
