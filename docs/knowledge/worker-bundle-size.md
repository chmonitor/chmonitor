---
id: worker-bundle-size
title: Cloudflare Worker Bundle Size
type: decision
status: active
updated: 2026-08-07
tags:
  - cloudflare-workers
  - bundle-size
  - opentelemetry
  - polar
  - performance
related:
  - static-site-architecture
  - deployment
---

# Cloudflare Worker Bundle Size

The dashboard worker (`chmonitor-dash`) deploys with `no_bundle: true`, so `wrangler deploy` uploads **every** file under `dist/server/assets/*.js` against the size limit.

## Current measurement (2026-08-07)

```
Total Upload: ~11.9 MiB / gzip: ~2.78 MiB   (~660 modules)
```

**Under the free-plan 3 MiB limit** with ~300 KiB headroom. Preview deploys fail hard with `code 10027` when gzip exceeds 3 MiB.

Re-measure after any change that adds server imports:

```bash
cd apps/dashboard
pnpm run build:preview
pnpm exec wrangler deploy --minify --dry-run 2>&1 | grep -iE "Total Upload|gzip:"
```

## How size is controlled

1. **SSR stubs** (`apps/dashboard/vite.config.ts` → `SSR_STUB_PREFIXES` + `chm:ssr-client-only-stub`). Client-only packages resolve to a no-op Proxy on the Worker SSR graph; the client build keeps real packages. **Node/Docker (`BUILD_TARGET=node`) does not stub** (except `@cloudflare/puppeteer`, which is Workers-only).

2. **Thin Polar REST client** (`lib/billing/polar-http.ts` + `polar-webhooks.ts`) replaces `@polar-sh/sdk` on the Worker runtime path (~1.3 MiB raw Speakeasy SDK → small fetch + `standardwebhooks`). Dev script `scripts/polar-setup.ts` may still import the SDK.

3. **Do not rely on dynamic `import()` alone** for size. With `no_bundle: true`, every emitted `dist/server/assets/*.js` still counts toward the upload total. Only **removing a package from the server graph** (stub or never import) saves bytes.

## Stubbed on CF Worker (not exhaustive)

| Package | Why safe |
|---------|----------|
| mermaid, cytoscape, katex, dagre, codemirror | Client-only diagrams/editors |
| recharts, @xyflow/react | Client-only charts/graphs |
| streamdown, assistant-ui, json-render/shadcn|react | Lazy agent UI |
| sql-formatter, highlight.js | Client interaction only |
| react-markdown, remark-* | Client markdown cells |
| @cloudflare/puppeteer | PDF fails closed to HTML |
| @dnd-kit/* | Column/dashboard drag is browser-only |
| @opentelemetry/exporter-*, sdk-trace-base, resources, context-async-hooks, semantic-conventions | Opt-in OTEL export; stubbed on CF free plan (Node keeps real packages) |

## What still dominates

| Chunk (approx) | Contents | Notes |
|----------------|----------|-------|
| `router-*` (~2.7 MiB raw / ~650 KiB gz) | Route tree + in-process MCP (`@modelcontextprotocol/server`) | Separate `apps/mcp` worker exists; dashboard still mounts `/api/mcp` |
| `analytics.server-*` | Clerk shared + ClickHouse client + residual OTel API | |
| `clerk-client-*` | `@clerk/react` / clerk-js UI | Needed for ClerkProvider SSR shell |
| `dist-*` | AI SDK | Agent server path |
| `data-table-*` | TanStack Table (+ less dnd after stub) | Table SSR shells |
| `query-config-*` | Query configs | Required on server |

## Residual risks / next cuts

- **MCP in dashboard worker**: largest remaining win is routing `/api/mcp` only to `apps/mcp` and dropping `@chm/mcp-server/http` → `createMcpHandler` from the dashboard graph.
- **Clerk client bundle**: hard to stub without breaking auth UI SSR.
- **CF free plan OTEL**: export packages are stubbed on Worker; set `CHM_OTEL_EXPORTER_URL` only works fully on Node/Docker until headroom allows un-stubbing.
- **PDF**: Browser Rendering via `@cloudflare/puppeteer` is stubbed; use REST Browser Rendering later if PDF is required on CF free tier.

## Decision: @opentelemetry/api is NOT fully stubbed

Keep `@opentelemetry/api` (and app code using `SpanStatusCode`) for the no-op path. Only the **export SDK** packages are stubbed on CF. Historical note: stubbing the whole API saved ~0.35% and broke `context.with` — do not reintroduce a full API stub.

## History

| Date | gzip (wrangler) | Notes |
|------|-----------------|-------|
| 2026-06-14 | ~1.82 MiB | Post TanStack Start cutover |
| 2026-08-07 (pre) | ~3.21 MiB | Over free limit; preview deploy failed 10027 |
| 2026-08-07 (post stubs+polar) | ~2.78 MiB | Thin Polar + expanded SSR stubs |
