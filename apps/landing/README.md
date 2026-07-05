# chmonitor landing (`apps/landing`)

Marketing landing page for **chmonitor.dev**, built with [Astro](https://astro.build)
(static output). Deployed to Cloudflare Workers as `chmonitor-landing`.

## Standalone install (important)

This app is **intentionally NOT a member of the root bun workspace** (see the
root `package.json` `workspaces` list, which names `apps/dashboard` and
`apps/mcp` explicitly). The reason: Astro 5 requires `zod@^3`, but the root
workspace pins `zod@^4` via a load-bearing `overrides` entry that the dashboard
and AI agent depend on. Bun applies root `overrides` to every workspace member
with no way to scope an exception, which forces `zod@4` onto Astro and breaks
its config validation.

Keeping `apps/landing` out of the workspace gives it an isolated install where
Astro resolves its native `zod@3`. It has its own `bun.lock`.

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
