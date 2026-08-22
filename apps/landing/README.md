# chmonitor landing (`apps/landing`)

Marketing landing page for **chmonitor.dev**, built with [Astro](https://astro.build)
(static output). Deployed to Cloudflare Workers as `chmonitor-landing`.

## Standalone install (important)

This app is **NOT a member of the root pnpm workspace** (`pnpm-workspace.yaml`
only lists `apps/mcp` and `packages/*`). It has its own `pnpm-lock.yaml` and
its own install step, which keeps the root `pnpm.overrides` out of its
dependency tree:

```bash
cd apps/landing
pnpm install
```

## Develop

```bash
cd apps/landing
pnpm install
pnpm run dev      # http://localhost:4321
pnpm run build    # -> dist/
```

Or from the repo root: `pnpm run build:landing`.

## Deploy

Served as static assets by a Cloudflare Worker (`wrangler.toml`, added with the
domain-topology change). `public/_redirects` sends `/docs` → `docs.chmonitor.dev`.
