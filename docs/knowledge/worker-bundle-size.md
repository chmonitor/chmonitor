---
id: worker-bundle-size
title: Cloudflare Worker Bundle Size
type: decision
status: active
updated: 2026-06-14
tags:
  - cloudflare-workers
  - bundle-size
  - opentelemetry
  - performance
related:
  - static-site-architecture
  - deployment
---

# Cloudflare Worker Bundle Size

The dashboard worker (`chmonitor-dash`) deploys with `no_bundle: true`, so `wrangler deploy` uploads **every** file under `dist/server/assets/*.js` against the size limit. As of the v0.3 TanStack Start cutover (PR #1613, 2026-06-14) the deployed artifact is:

```
Total Upload: 8.5 MiB / gzip: 1.82 MiB   (440 modules)
```

This is **under the 3 MiB free-plan limit** (and far under the 10 MiB paid limit). There is no size pressure, and no cold-start regression has been measured.

## What dominates the bundle

Every heavy chunk traces to a feature in active use — there is no dead-code smoking gun, and dependency versions are deduplicated cleanly (single zod / React / ajv):

| Chunk | Contents | Legitimacy |
|-------|----------|-----------|
| `router-*` (~1.5 MiB raw) | MCP validation: `ajv` + `zod-to-json-schema` + `@modelcontextprotocol/sdk` | In-process `/api/mcp` route (`@chm/mcp-server/http`) |
| `permissions-*` | Clerk auth (`@clerk/shared`, `@clerk/react`) | Authentication |
| `dist-*` | AI SDK (`ai`) + `@json-render/core` + `@vercel/oidc` + `eventsource-parser` | The agent |
| `lib-*` | Markdown pipeline (micromark + unified + mdast) | Docs + agent output rendering |
| `data-table-*` | TanStack Table + dnd-kit + radix | Tables |

The existing SSR stub system in `apps/dashboard/vite.config.ts` (`SSR_STUB_PREFIXES`, referencing #1393) already eliminates the browser-only render libraries (mermaid, recharts, codemirror, xyflow, assistant-ui, json-render/shadcn, etc.) from the worker by aliasing them to a no-op Proxy stub.

## Decision: @opentelemetry/api is NOT worth stubbing (2026-06-14)

`@opentelemetry/api` is pulled in transitively by the Vercel AI SDK (`trace`, `context`, `SpanStatusCode` from 2 import sites). Probed as a candidate size win on branch `perf/worker-bundle-size`.

**Measured maximum saving by aliasing OTel to the no-op Proxy stub:**
```
Baseline:           1862.90 KiB gzip
OTel fully stubbed: 1856.43 KiB gzip
Delta:                 6.47 KiB   (0.35%)
```

The AI SDK already tree-shakes OTel to the minimal no-op tracer machinery; after minification + gzip the contribution is tiny.

Two reasons not to do it:

1. **It is a runtime API, not a render library.** The stub Proxy is safe for the other packages because they never execute in the worker (all behind `React.lazy` / `<ClientOnly>`). OTel runs on every AI request. The Proxy breaks `context.with(ctx, fn)` (swallows the callback), `context.bind()` (returns itself, not a callable wrapper), and corrupts the `SpanStatusCode` / `TraceFlags` enum values used in span status and bitwise sampling.
2. **0.35% saving.** Building a runtime-correct OTel shim (real enum numbers, a `context.with` that actually invokes its callback) and verifying the freshly-prod AI agent's tracing path is not worth 6 KiB on an unconstrained bundle.

Revisit only if approaching the 3 MiB limit, or if a cold-start regression is measured. Otherwise: leave it.

## How to re-measure

```bash
cd apps/dashboard
pnpm run build
bun wrangler deploy --minify --dry-run 2>&1 | grep -iE "Total Upload|gzip:"
```
