---
id: secret-rotation
title: Cloudflare Workers Secret Rotation
type: workflow
status: active
updated: 2026-05-13
tags:
  - cloudflare
  - secrets
  - deployment
related:
  - deployment
---

# Cloudflare Workers Secret Rotation

## Rule

After running `wrangler secret put` (or `pnpm run cf:config`), you **MUST redeploy** to flush the connection pool cache.

## Why

ClickHouse client instances are pooled and cached at runtime. When secrets are updated via Wrangler, the running Worker still uses the old credentials from the connection pool until a new deployment replaces the instance.

## How to Apply

```bash
# Update secrets
pnpm run cf:config

# MUST redeploy after
pnpm run cf:deploy
```

## Related

- See [deployment.md](deployment.md) for full deployment workflow
