# Apps

This monorepo is split into eight apps under `apps/` plus shared libraries
under [`packages/`](../packages). Each deployable ships independently to
Cloudflare Workers behind the `chmonitor.dev` zone (bug-handler is invoked by
Email Routing instead of an HTTP route).

| App | Path | Stack | Domain | Worker |
|-----|------|-------|--------|--------|
| **Dashboard** | [`apps/dashboard`](./dashboard) | TanStack Start · React 19 · Vite | `dash.chmonitor.dev` | `chmonitor-dash` |
| **Docs** | [`apps/docs`](./docs) | Fumadocs + TanStack Start | `docs.chmonitor.dev` | `chmonitor-docs` |
| **Landing** | [`apps/landing`](./landing) | Astro 7 | `chmonitor.dev` | `chmonitor-landing` |
| **Blog** | [`apps/blog`](./blog) | Astro 7 | `blog.chmonitor.dev` | `chmonitor-blog` |
| **MCP** | [`apps/mcp`](./mcp) | Cloudflare Worker | `dash.chmonitor.dev/api/mcp*` | `chmonitor-mcp` |
| **Telemetry** | [`apps/telemetry`](./telemetry) | Cloudflare Worker | `telemetry.chmonitor.dev` | `chmonitor-telemetry` |
| **Cloud hooks** | [`apps/cloud-hooks`](./cloud-hooks) | Cloudflare Worker | `hooks.chmonitor.dev` | `chmonitor-hooks` |
| **Bug handler** | [`apps/bug-handler`](./bug-handler) | Cloudflare Email Worker | — (Email Routing) | `chmonitor-bug-handler` |

## Workspace layout

The repo is a **pnpm workspace** (`pnpm-workspace.yaml`,
`packageManager: pnpm@10.18.0`). Only `apps/mcp` and `packages/*` are root
workspace members; they share the root lockfile, including the load-bearing
`zod@^4` override that the MCP tools depend on.

Every other app is a **standalone install**: each carries its own
`pnpm-lock.yaml` **and its own `pnpm-workspace.yaml`** — pnpm resolves the
nearest workspace file, so running `pnpm install` inside those apps scopes to
the app itself instead of walking up to the repo root (which keeps the root
`pnpm.overrides`, notably `zod@^4.3.6`, out of their trees). See each app's
README for details.

Turbo (`pnpm run dev` / `build` / `test` from the repo root) fans out to
workspace members only, so it effectively covers `apps/mcp` + `packages/*`.
The standalone apps are driven by dedicated root scripts (`pnpm run
build:docs`, `pnpm run build:landing`) or directly from their directories.

## Develop

```bash
# From the repo root:
pnpm install            # installs the root workspace (apps/mcp + packages/*)
pnpm run build:docs     # apps/docs    (standalone install + build)
pnpm run build:landing  # apps/landing (standalone install + build)

# Standalone apps — install + run from each app's directory:
cd apps/dashboard && pnpm install && pnpm run dev
cd apps/docs && pnpm install && pnpm run dev        # http://localhost:3001
cd apps/landing && pnpm install && pnpm run dev     # http://localhost:4321
cd apps/blog && pnpm install && pnpm run dev        # http://localhost:4321
```

Each app can also be driven directly from its own directory — see the per-app
README for commands.

## Shared packages

The apps consume internal libraries from [`packages/`](../packages):
`billing-webhook-core`, `clickhouse-client`, `logger`, `mcp-server`,
`postgres-client`, `pricing`, `query-advisor-core`, `sql-builder`, and `types`.
