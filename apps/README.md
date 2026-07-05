# Apps

This monorepo is split into four deployable apps under `apps/` plus shared
libraries under [`packages/`](../packages). Each app ships independently to
Cloudflare Workers behind the `chmonitor.dev` zone.

| App | Path | Stack | Domain | Worker |
|-----|------|-------|--------|--------|
| **Dashboard** | [`apps/dashboard`](./dashboard) | Next.js 15 · React 19 | `dash.chmonitor.dev` | `chmonitor-dash` |
| **Docs** | [`apps/docs`](./docs) | Astro Starlight | `docs.chmonitor.dev` | `chmonitor-docs` |
| **Landing** | [`apps/landing`](./landing) | Astro | `chmonitor.dev` | `chmonitor-landing` |
| **MCP** | [`apps/mcp`](./mcp) | Cloudflare Worker | `dash.chmonitor.dev/api/mcp*` | `chmonitor-mcp` |

## Workspace layout

`apps/dashboard` and `apps/mcp` are members of the root bun workspace (see the
root [`package.json`](../package.json) `workspaces` field) and share the
pinned dependency tree, including a load-bearing `zod@^4` override that the
dashboard and AI agent depend on.

`apps/docs` and `apps/landing` are **intentionally excluded** from the
workspace. Astro 5 requires `zod@^3`, and bun applies the root `zod@4`
override to every workspace member with no way to scope an exception — which
would break Astro's config validation. Keeping the two Astro apps out of the
workspace gives each an isolated install (its own `bun.lock`) where Astro
resolves its native `zod@3`. See each app's README for details.

## Develop

```bash
# From the repo root — turbo fans out to workspace members:
pnpm run dev            # dashboard + mcp (turbo run dev)

# The standalone Astro apps build via dedicated root scripts:
pnpm run build:docs     # apps/docs    -> dist/
pnpm run build:landing  # apps/landing -> dist/
```

Each app can also be run directly from its own directory — see the per-app
README for commands.

## Shared packages

The apps consume internal libraries from [`packages/`](../packages):
`clickhouse-client`, `logger`, `mcp-server`, `platform`, `sql-builder`, and
`types`.
