---
id: agentstate-conversation-store
title: AgentState Conversation Store
type: spec
status: active
updated: 2026-08-18
related:
  - agent-conversation-storage
  - ai-insights
  - mcp-server
  - conventions
tags:
  - ai-agent
  - persistence
  - agentstate
  - conversation-store
  - cloudflare
---

# AgentState Conversation Store

AgentState (<https://agentstate.app>, self-hostable Cloudflare Worker, npm SDK
`@agentstate/sdk`) is a conversation-history database-as-a-service. It is one of
the agent's server-side `ConversationStore` backends, selected at deploy time
alongside Browser / D1 / Postgres / Memory. It additionally enables **AI
enrichment**: auto-generated conversation titles and follow-up question
suggestions.

User-facing reference: [docs/content/ai-agent.mdx](../content/ai-agent.mdx)
("Conversation history backends" → "AgentState"). See also
[agent-conversation-storage.md](agent-conversation-storage.md) for the broader
store-selection rules.

## Architecture

The adapter implements the shared `ConversationStore` interface (read thread,
append turn, list, delete) so the agent route is backend-agnostic. AgentState is
the highest-priority backend in `resolveStore`.

**Selection priority** (when persistence is enabled via
`VITE_FEATURE_CONVERSATION_DB=true` and the user is authenticated):

1. **AgentState** — when `AGENTSTATE_API_KEY` is set
2. **D1** — when a Cloudflare D1 binding is present
3. **Postgres** — when `DATABASE_URL` is set
4. **Memory** — last-resort, non-persistent fallback

With the feature flag off, history stays in the **Browser** (`localStorage`).
`CONVERSATION_STORE_BACKEND=agentstate` forces AgentState even when a D1 binding
is also present (otherwise `auto` follows the priority order above).

## Per-user isolation

A single AgentState project key holds every user's history without cross-talk:

- `external_id` is namespaced as `<userId>:<conversationId>`.
- Each record is tagged `user:<userId>`.

Reads and listings filter by the `user:<userId>` tag / `external_id` prefix, so
isolation requires an authenticated identity (Clerk: `VITE_AUTH_PROVIDER=clerk` +
`CLERK_SECRET_KEY`). Unauthenticated sessions fall back to browser history.

## Message mapping

- **Append-only diff upsert** — on each turn the adapter upserts only the new
  messages onto the existing AgentState conversation rather than rewriting the
  whole thread.
- **UIMessage ⇄ AgentState round-trip** — the AI SDK `UIMessage` shape is mapped
  to AgentState's message records and back, preserving role/content plus the
  metadata needed to reconstruct the `UIMessage` (parts, tool calls, ids) on
  read so the chat re-hydrates exactly.

## AI enrichment

When AgentState is active **and** `AGENTSTATE_AI_ENRICH=true`:

- **Auto-title** — if the stored title is generic (`New Chat`, `New Conversation`,
  empty), `generateTitle` runs and the returned title is persisted via
  `updateConversation` so the next list shows it.
- **Follow-ups** — AgentState suggests follow-up questions, surfaced in the chat.

Cloud production sets `AGENTSTATE_AI_ENRICH=true` in
`apps/dashboard/.env.production`. With enrichment off, conversations persist
normally but no titles/follow-ups are generated. `supportsAiEnrichment` in the
backend endpoint reflects this.

## Routes

- `GET /api/v1/conversations/backend` — reports the active backend and
  `supportsAiEnrichment`. Drives the read-only "Conversation History" section in
  the agent settings sidebar.
- `GET /api/v1/conversations/$id/follow-ups` — returns enrichment-generated
  follow-up question suggestions for a conversation.

## Environment variables

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `AGENTSTATE_API_KEY` | to enable | — | `as_live_...` project key; presence activates the backend |
| `AGENTSTATE_BASE_URL` | no | `https://agentstate.app/api` | self-host endpoint |
| `AGENTSTATE_AI_ENRICH` | no | `false` | enable auto-title + follow-up suggestions |
| `CONVERSATION_STORE_BACKEND` | no | `auto` | force `agentstate` when a D1 binding is also present |

Also requires `VITE_FEATURE_CONVERSATION_DB=true` and a Clerk auth provider.

**Local dev** against a self-hosted instance: `AGENTSTATE_BASE_URL=http://localhost:8787`
with the seed test key `as_live_TEST_KEY_FOR_LOCAL_DEV_ONLY_1234567890ab`.

On Cloudflare, set `AGENTSTATE_API_KEY` as a Worker secret
(`wrangler secret put AGENTSTATE_API_KEY`) and add it to CI secrets; the other
three vars are non-secret runtime `[vars]`.
