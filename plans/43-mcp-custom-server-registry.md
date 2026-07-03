# 43 — MCP Custom Server Registry (register external MCP servers, per-user, usable in the agent)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. If a STOP condition
> occurs, stop and report — do not improvise. When done, update this plan's status
> row in `plans/README.md`.

## Kickoff prompt

```text
Execute plans/43-mcp-custom-server-registry.md ALONE (Wave I, integrations).
Goal: let a user register external MCP servers (URL + auth + transport), persist
them in D1, validate connectivity/capabilities, and load them per-user alongside
the built-in tools at conversation start — with a template library
(Slack/GitHub/Datadog). Invariants you MUST hold:
- Self-hosted/OSS stays whole; feature fails open — no Clerk ⇒ single-user 'guest'
  scope still works; a bad/unreachable custom server degrades gracefully (agent
  runs with built-ins only, never 500s the conversation).
- SSRF-guard the new outbound: every registered MCP URL is validated through the
  existing host-validation guard before connect (this is exactly SEC-04's concern —
  do NOT ship an unguarded fetch/transport).
- Per-user isolation: one user's servers/credentials are never loaded for another.
- Honest claims: capabilities shown are what the server actually advertised on a
  successful validate; on failure say so.
- Postgres/multi-DB: NO new backend beyond the existing D1 store pattern.
Files: new routes/api/v1/mcp/{connect,servers}.ts, extend
src/lib/ai/agent/mcp/connect-custom-servers.ts, new D1 table
mcp_server_registrations, routes/(dashboard)/agents/mcp-server-manager.tsx.
End by running: cd apps/dashboard && bun run type-check && bun run build &&
bun test src/lib/ai/agent/mcp --isolate && bun run lint.
```

## Current reality (audited)

Per ROADMAP §2 and §4 spec 43: a **placeholder UI exists** but users cannot actually
register external MCP servers — the agentic-ecosystem play is unfinished. The audit
also flags **SEC-04** (custom-server transport unpinned) and **DOC-01** (a stale
"custom MCP not yet wired" comment) — both live in this surface, so wire it correctly
(SSRF-guarded) and fix the comment while here.

Pointers (confirm with `rg`, mark `(verify)`):
- `src/lib/ai/agent/mcp/connect-custom-servers.ts` — the connect path (SEC-04 notes
  unpinned transport around `:110,287`). Reuse/extend this, don't fork it. (verify)
- Agent tool assembly at conversation start (`src/lib/ai/agent/…` / `routes/api/v1/agent.ts`
  around `:50`) — where built-in tools are gathered; inject per-user custom tools here. (verify)
- Conversation/D1 store pattern (`src/lib/conversation-store/d1-store.ts` and its
  migration under `db/…-migrations/`) — mirror it for the new table + migration. (verify)
- SSRF guard: `createHostValidationFetch` / host-validation (same as `user-connections`). (verify)
- Placeholder UI: `components/agents/welcome/agent-mcp-panel.tsx` (holds the DOC-01
  stale comment at `:18`) and/or an `mcp-server-manager` route. (verify)

## Goal

A user registers an external MCP server (name, URL, transport, optional auth header/token);
chmonitor validates connectivity + lists the server's tools, stores the registration in
D1 scoped to that user, and at each conversation start loads the user's *enabled* servers
through the SSRF-guarded transport so their tools are callable by the agent — with a
one-click template library for common servers.

## Implement now (F — file-level)

### D1 table — `mcp_server_registrations` (new migration)

Mirror the conversations migration style. Columns:
`id TEXT PK, user_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
transport TEXT NOT NULL /* 'http' | 'sse' */, auth_kind TEXT /* 'none'|'bearer'|'header' */,
auth_secret TEXT /* encrypted-at-rest or stored per existing secret convention */,
auth_header_name TEXT, enabled INTEGER NOT NULL DEFAULT 1,
capabilities_json TEXT /* cached tool list from last successful validate */,
last_validated_at INTEGER, created_at INTEGER, updated_at INTEGER`.
Index on `user_id`. **Do not** store secrets in plaintext if the repo has a secret
convention — follow it. (verify)

### Store — `src/lib/ai/agent/mcp/registration-store.ts` (new)

CRUD scoped by `userId` (mirror `d1-store.ts` scoping — every read/write `WHERE user_id=?`;
this is the per-user isolation control):
```ts
listForUser(userId): Promise<McpRegistration[]>
get(userId, id): Promise<McpRegistration | null>
upsert(reg: McpRegistration): Promise<{ written: boolean }>   // owner-guarded, like plan 04
remove(userId, id): Promise<{ deleted: boolean }>
```

### Validate/connect — extend `connect-custom-servers.ts`

- `validateServer(reg): Promise<{ ok: boolean; tools?: McpToolInfo[]; error?: string }>`:
  1. **SSRF-guard** `reg.url` (reject private/link-local unless `CHM_ALLOW_PRIVATE_HOSTS`).
  2. Open the MCP client over `reg.transport` **using the host-validated fetch** (this
     closes SEC-04 — the transport must be pinned/guarded, not a raw fetch).
  3. List tools; return them; **always close the client** (fixes the BUG-03 class here —
     close on success AND on throw, in `finally`).
- `loadUserCustomServers(userId): Promise<LoadedMcpTool[]>`: read enabled registrations,
  connect each guarded, collect tools; **on any single-server failure, skip it and
  continue** (graceful degrade — the conversation still runs with built-ins).

### Agent wiring

At conversation start, after gathering built-in tools, append
`await loadUserCustomServers(userId)`. Namespace custom tool names to avoid collision
with built-ins. Ensure every opened custom client is closed when the agent
request ends OR throws (including the 402/pre-stream path — the BUG-03 concern).

### Routes

- `routes/api/v1/mcp/connect.ts` (new): `POST { url, transport, auth… }` → runs
  `validateServer` and returns `{ ok, tools }` **without persisting** (a "test before
  save" probe). 401 if unauthenticated.
- `routes/api/v1/mcp/servers.ts` (new): `GET` list (user-scoped), `POST` create
  (validate then `upsert`), `PATCH` enable/disable/rename, `DELETE` remove. All
  user-scoped; all reuse `createApiErrorResponse` shape.

### UI — `routes/(dashboard)/agents/mcp-server-manager.tsx`

- List the user's servers with status (enabled, last-validated, tool count).
- "Add server" form (name/URL/transport/auth) with a **Test connection** button
  (calls `/mcp/connect`) that shows the advertised tools before saving.
- **Template library**: buttons that prefill the form for Slack / GitHub / Datadog MCP
  endpoints (URL + expected auth kind), user still supplies their own token.
- Remove the DOC-01 stale "not yet wired" comment in the placeholder panel.

### Tests — `src/lib/ai/agent/mcp/*.test.ts` (Bun)

- `registration-store`: per-user isolation (user B cannot read/modify user A's rows);
  owner-guarded upsert returns `{written:false}` on foreign id.
- `connect-custom-servers`: private-host URL is rejected by the SSRF guard (no connect);
  a failing server is skipped by `loadUserCustomServers` (built-ins still returned);
  client is closed on throw.

## STOP conditions & drift check

Drift check (run first):
`git diff --stat -- apps/dashboard/src/lib/ai/agent/mcp apps/dashboard/src/routes/api/v1/agent.ts` — reconcile pointers if this area changed.

STOP and report if:
- No SSRF host-validation helper exists to guard the MCP transport (do not ship an
  unguarded custom-server fetch — that is SEC-04 unresolved).
- The MCP client library in use cannot be driven over a host-validated fetch/transport
  (report the constraint rather than dropping the guard).
- Registering a server can leak one user's tools/credentials into another user's
  conversation (isolation must hold) — stop and fix the scoping first.
- The change requires more than the listed files (e.g. altering the built-in tool set).

## Verification

```bash
cd apps/dashboard && bun run type-check
cd apps/dashboard && bun run build
cd apps/dashboard && bun test src/lib/ai/agent/mcp --isolate
cd apps/dashboard && bun run lint
```

## Done criteria

ALL must hold:
- [ ] A user can register, test, enable/disable, and remove external MCP servers; rows
      are D1-persisted and **strictly user-scoped**.
- [ ] Registered servers' tools are usable by the agent at conversation start; a broken
      server degrades gracefully (built-ins still work; no 500).
- [ ] Every registered MCP URL is SSRF-guarded before connect; clients are always closed
      (success and throw), including the pre-stream/402 path.
- [ ] Template library prefills Slack/GitHub/Datadog; DOC-01 stale comment removed.
- [ ] **Safety**: no custom server auto-loads for a user who didn't register it; no
      unguarded outbound; validation claims reflect the server's real advertised tools.
- [ ] `type-check`, `build`, `bun test src/lib/ai/agent/mcp --isolate`, `lint` all exit 0.
- [ ] No files outside scope modified; `plans/README.md` row updated.

---

Priority **P1** · Effort **M** · Depth **F** · Wave **I** · Lever **Adoption/Ecosystem**
