---
id: agent-conversation-storage
title: Agent Conversation Storage
type: spec
status: active
updated: 2026-09-27
related:
  - agentstate-conversation-store
  - deployment
  - secret-rotation
  - static-site-architecture
tags:
  - ai-agent
  - persistence
  - cloudflare
  - clickhouse
---

# Agent Conversation Storage

> **Read [agentstate-conversation-store](agentstate-conversation-store.md) for the
> AgentState backend in depth.** This note owns the *rules that apply to every
> backend*; that one owns the AgentState specifics. They overlap on purpose.

## Rule

Agent chat history defaults to browser localStorage. Server persistence is
enabled only when `featureFlags.conversationDb()` is on (a Vite env flag
`VITE_FEATURE_CONVERSATION_DB=true` **and** Clerk enabled), and the backend is
selected at runtime by `resolveStore()` — **not** by a single env var.

> The two env vars this note used to name, `AGENT_CONVERSATION_PERSISTENCE` and
> `AGENT_CONVERSATION_STORE`, are **no longer read by the dashboard**. They survive
> only inside `scripts/prepare-dashboard-wrangler.ts` and a `console.log` in
> `scripts/setup-conversations-db.ts`, so setting them today does nothing. The real
> selectors are below.

## Why

ClickHouse monitor supports read-only self-hosted deployments and Cloudflare
Workers deployments. A build-time public flag cannot safely choose between
AgentState, D1, Durable Objects, ClickHouse, Postgres, memory, and local storage
after deployment.

## How To Apply

- Keep storage code behind `apps/dashboard/src/lib/conversation-store/resolve-store.ts`.
- Keep adapter-specific details in one backend file per store
  (`agentstate-store.ts`, `d1-store.ts`, `postgres-store.ts`, `memory-store.ts`,
  `browser-store.ts`).
- Persist agent turns from the `/api/v1/agent` finish callbacks, not partial stream
  updates.
- Require authenticated user identity for server stores. Unauthenticated
  sessions use local browser history.
- Use the `CHM_CLOUD_D1` binding **only** for conversation D1 migrations. There is
  no longer a `NEXT_TAG_CACHE_D1` binding to avoid — that name appears nowhere in the
  tree but in an earlier version of this note.
- Active Wrangler D1 bindings need a concrete `database_id`. Deploys should use
  `scripts/prepare-dashboard-wrangler.ts` so unprovisioned optional
  `CHM_CLOUD_D1` bindings are removed unless `CHM_CLOUD_D1_DATABASE_ID`
  is set.
- Prefer D1 over Durable Objects for ordinary Cloudflare history because D1 is a
  managed queryable database. Use Durable Objects when per-user coordination is
  the core requirement.

## Selection priority (`resolve-store.ts`)

1. Conversations feature flag off → `BrowserStore` (localStorage).
2. `CONVERSATION_STORE_BACKEND=agentstate`, or `AGENTSTATE_API_KEY` present with no
   other backend forced → `AgentStateStore`. This sits **ahead** of D1, so an
   explicit AgentState config wins even on Cloudflare.
3. `CHM_CLOUD_D1` binding present → `D1Store`.
4. `DATABASE_URL` / `POSTGRES_URL` set → `PostgresStore` (dynamic `import()`; the
   `postgres` package is Node-only and must not enter the Workers bundle).
5. Nothing configured → `MemoryStore` with a warning.

## Code References

Verified present on `main`:

- `apps/dashboard/src/lib/conversation-store/resolve-store.ts` — the priority above
- `apps/dashboard/src/lib/conversation-store/agentstate-store.ts` (and
  `d1-store.ts`, `postgres-store.ts`, `memory-store.ts`, `browser-store.ts`,
  `types.ts`, `auth.ts`)
- `apps/dashboard/src/routes/api/v1/agent.ts` — the agent route (was
  `app/api/v1/agent/route.ts`)
- `apps/dashboard/src/routes/api/v1/conversations/backend.ts` — reports the active
  backend and whether it supports AI enrichment; the successor to the deleted
  `app/api/v1/conversations/status/route.ts`
- `scripts/prepare-dashboard-wrangler.ts` — the `database_id` / D1-binding guard
- `scripts/setup-conversations-db.ts` — D1 provisioning helper

**Deleted with the Next.js app in #1613, no successor** — do not go looking:

- `apps/dashboard/lib/conversation-store/config.ts`
- `apps/dashboard/lib/conversation-store/persist-agent-turn.ts`
- `apps/dashboard/app/api/v1/conversations/status/route.ts`

Every one of the five Code References this note carried before still pointed into
`apps/dashboard/lib/` or `apps/dashboard/app/`; all five paths were dead, and
three of them now point at a verified successor.
