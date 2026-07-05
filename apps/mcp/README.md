# chmonitor MCP (`apps/mcp`)

Standalone Cloudflare Worker that serves the chmonitor [Model Context
Protocol](https://modelcontextprotocol.io) endpoint. Deployed as
`chmonitor-mcp` and routed to **`dash.chmonitor.dev/api/mcp*`** (plus
`/api/v1/mcp/info*`).

It is a member of the root bun workspace and consumes the shared
[`@chm/mcp-server`](../../packages/mcp-server) package, which defines the MCP
tools (`MCP_TOOLS`), the server factory, and API-key auth helpers.

## Why it's a separate worker

The MCP tools and `@modelcontextprotocol/sdk` accounted for ~390 KB of the main
Next.js worker bundle. Splitting them into their own worker keeps the dashboard
bundle small. Cloudflare route patterns for `/api/mcp*` and `/api/v1/mcp/info*`
are matched more specifically than the dashboard worker's catch-all, so this
worker intercepts those paths first; the dashboard worker stubs the same route
handlers at build time so they never collide.

## Develop

```bash
cd apps/mcp
cp .dev.vars.example .dev.vars   # set ClickHouse env vars + CHM_API_KEY_SECRET
pnpm run dev                      # wrangler dev
pnpm run typegen                  # regenerate Cloudflare env typings
```

## Bindings & auth

No KV/D1/R2 — the MCP tools only query ClickHouse over HTTP. The worker shares
the dashboard's ClickHouse env vars and the `CHM_API_KEY_SECRET` secret. When
API-key auth is enabled, requests must present a bearer token; CORS is open
(`*`) because payloads are auth-gated and no cookies are involved.

## Deploy

```bash
pnpm run deploy        # wrangler deploy --minify
```

A `preview` environment mirrors the main worker at
`preview.chmonitor.dev/api/mcp*`. See [`wrangler.toml`](./wrangler.toml) for the
route configuration.
