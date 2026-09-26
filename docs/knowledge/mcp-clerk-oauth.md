---
id: mcp-clerk-oauth
title: MCP Clerk OAuth
type: reference
status: active
updated: 2026-09-27
tags:
  - mcp
  - auth
  - clerk
  - oauth
related:
  - mcp-server
  - deployment
---

# MCP Clerk OAuth

The MCP endpoint supports three auth postures, resolved per request by
`defaultAuthenticator` in `@chm/mcp-server/http`:

| Configured env | Behavior |
|----------------|----------|
| neither `CHM_API_KEY_SECRET` nor `CLERK_SECRET_KEY` | **open** — anonymous AI clients allowed (self-host default) |
| `CHM_API_KEY_SECRET` | HMAC API key required (CLI / headless) |
| `CLERK_SECRET_KEY` | Clerk OAuth access token required (humans via MCP clients) |

When both API-key and Clerk are configured, **either** a valid API key **or** a
valid Clerk token is accepted, so CLI and human clients coexist on one endpoint.
API key is checked first (local HMAC, no network); Clerk is a REST call.

## Why REST verification (not @clerk/nextjs)

Token verification is a plain `fetch` to Clerk's introspection endpoint
(`POST api.clerk.com/oauth_applications/access_tokens/verify` with
`CLERK_SECRET_KEY`). That runs in **both** runtimes — the standalone Cloudflare
Worker (no `@clerk/nextjs`) and the in-process Next.js route — so Clerk MCP auth
behaves identically in Docker and Cloudflare. See
`packages/mcp-server/src/auth/clerk-oauth.ts`.

## The login / consent flow

Clerk is the **authorization server**; we are only the **resource server**. We
never build a login UI — Clerk hosts login, consent, and dynamic client
registration.

1. MCP client (Claude.ai, Cursor, …) calls `/api/mcp` with no token → `401` with
   `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource"`.
2. Client fetches `/.well-known/oauth-protected-resource` (RFC 9728). We return
   `authorization_servers: ["https://clerk.<domain>"]` — the issuer is derived
   from the Clerk publishable key (`pk_live_<base64("clerk.<domain>$")>`), or
   `CLERK_OAUTH_ISSUER` if set. See `auth/oauth-metadata.ts`.
3. Client discovers Clerk's AS metadata, runs OAuth 2.1 + PKCE, the user **logs
   in and grants consent** in Clerk, and the client gets an access token.
4. Client retries `/api/mcp` with `Authorization: Bearer <token>`; we verify it
   via the REST call and serve the MCP request.

The `.well-known` metadata is served by the dashboard app — the
`/.well-known/oauth-protected-resource` branch in its middleware,
`apps/dashboard/src/start.ts` — and, for standalone use, by the Worker. In
Cloudflare prod `dash.chmonitor.dev/.well-known/*` routes to the dashboard worker
(same origin as `/api/mcp`).

## Setup

1. **Clerk dashboard**: enable OAuth applications + **Dynamic Client
   Registration** so MCP clients can self-register.
2. **Secrets**: set `CLERK_SECRET_KEY` on both the dashboard and the
   `chmonitor-mcp` worker (`wrangler secret put CLERK_SECRET_KEY --config
   apps/mcp/wrangler.toml`). The publishable key is already inlined for the
   dashboard; set `CLERK_OAUTH_ISSUER` only for proxied Clerk domains.
3. **Redeploy** after setting secrets (connection pool / inlined env are cached —
   see [secret-rotation](secret-rotation.md)).

## Gotchas

- `.well-known/*` must stay public — `apps/dashboard/src/start.ts` already
  passes through any path that is not `/api/v1/*` or `/__clerk/*`.
- The Worker does not need the publishable key (it only verifies tokens); it
  emits the `WWW-Authenticate` header using the request origin, so discovery
  still points at the dashboard-served metadata on the same host.
