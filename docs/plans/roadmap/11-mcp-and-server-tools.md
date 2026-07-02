# 11 — Semantic MCP Tools + Installable Agent Skills

> Priority: P0 · Effort: L · Risk: MED · Depends on: 21 (advisor engine — for `suggest_projections`), 10 (ops persona)
> Category: AI moat · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

The chmonitor MCP server (`packages/mcp-server/src/tools/`) exposes 8 tools:
`query`, `list_databases` (databases), `list_tables`/`get_table_schema` (tables),
`get_metrics` (metrics), `analyze_performance` (performance),
`get_query_history`/etc. (queries), `explore_table_schema`, `get_merge_status`
(merges). Most of these are **raw or thin** — `query` is a run-any-SQL primitive,
and third-party agents (Claude Desktop, Cursor, ClickHouse's own MCP clients)
that connect to us end up doing exactly what ClickHouse found wrong with generic
`run_query`: many round-trips, inconsistent SQL, worse eval scores.

ClickHouse published the fix (research appendix §ClickHouse-AI): **semantic ops
tools** — `check_replication_health`, `find_merge_backlog`, `explain_slow_query`,
`diagnose_disk_pressure`, `suggest_projections` — beat raw `run_query` by **25%
fewer tool calls, 2.5× more consistent output, +20% on evals**. chmonitor already
proved this internally: `analyze_performance` (`tools/performance.ts`) bundles
five signals with severity ratings in one call. The rest of the surface hasn't
followed. Meanwhile the agent-side has the semantic primitives
(`get_replication_status`, `get_merge_status`, `get_disk_usage`) but the **MCP
server**, which is what third-party agents actually consume, does not expose them
as first-class semantic tools.

Two more gaps: (1) **write safety is all-or-nothing.** The agent's control tools
(`kill_query`/`optimize_table`/`kill_mutation`) are behind a single
`AGENT_ENABLE_CONTROL_TOOLS` boolean; the MCP server has **no** write tools and no
graduated safety. ClickHouse's model is **two-tier** (`ALLOW_WRITE` then a
stricter `ALLOW_DROP`), read-only by default. (2) **Skills aren't installable by
third-party agents.** We have 20+ excellent DBA skills in `.agents/skills/` built
via `bun run build:skills`, but they only feed *our* agent's `load_skill`; a
Cursor/Claude user connecting our MCP can't install `incident-response` or
`schema-design-advisor`.

Why now: this is the depth layer of the AI moat (Wave 2). Semantic tools make us
the best MCP a third-party agent can point at ClickHouse, and installable skills
distribute our DBA expertise into every agent, not just ours.

## Goal

Ship **semantic ops MCP tools** (matching the ClickStack-proven set), a
**two-tier write-safety gate** (read-only default → `CHM_MCP_ALLOW_WRITE` →
`CHM_MCP_ALLOW_DROP`), and **installable agent skills** exposed over MCP —
measurable as: an MCP integration test drives `check_replication_health`,
`find_merge_backlog`, `diagnose_disk_pressure`, `explain_slow_query`, and
`suggest_projections` end-to-end against a fake ClickHouse and asserts each
returns a structured severity-rated report in ONE call; a write-gate test proves
a mutating tool is refused unless `CHM_MCP_ALLOW_WRITE=true` and a DROP is refused
unless `CHM_MCP_ALLOW_DROP=true`; and the MCP exposes the skill catalog as
installable resources.

## Design

Keep everything **declarative** so the community can add tools/skills without
touching the transport. All detection SQL runs in ClickHouse (mirror
`tools/performance.ts` and `lib/alerting/*`), read-only unless the write gate is
open.

### 1. Semantic ops tools (`packages/mcp-server/src/tools/`)

Add tools, each registered in `tools/index.ts registerAllTools()` and mirrored in
`data/mcp-tools-data.ts` (the `/info` catalog):

- **`check_replication_health`** — from `system.replicas`
  (`is_readonly`, `absolute_delay`, `queue_size`, `is_leader`) + recent
  `KEEPER_EXCEPTION` from `system.error_log`; returns per-table status +
  overall `OK/WARNING/CRITICAL`. Reuse the thresholds already encoded in
  `lib/alerting/builtin-rules.ts` (`replication-lag` 30/300, `readonly-replicas`).
- **`find_merge_backlog`** — `system.merges` (elapsed, progress) +
  `system.parts` active part counts per table + `system.mutations`
  (`is_done=0 AND latest_fail_time` = failed). Surfaces stuck merges (>600s, the
  `stuck-merges` rule threshold) and failed mutations in one report.
- **`diagnose_disk_pressure`** — `system.disks` free/total, plus the largest
  tables/partitions from `system.parts` and TTL info, so the answer includes
  *what to drop/tier*, not just "disk 92%".
- **`explain_slow_query`** — given a `query_id` or fingerprint: pull the row from
  `system.query_log` (`read_rows`/`result_rows`, `ProfileEvents`,
  `query_duration_ms`), run `EXPLAIN INDEXES=1`, and return a structured
  diagnosis (full-scan? granules selected? missing PREWHERE?). This is the
  semantic wrapper over the raw `query`+`EXPLAIN` dance.
- **`suggest_projections`** — thin MCP wrapper over the Plan 21 advisor
  (`lib/advisor` → `runAdvisor`, filtered to projection/skip-index types), so the
  same recommendations reach third-party agents. Recommendation only, DDL emitted
  as text.

Each returns the same `{ data, severity }` section shape as
`analyze_performance` and runs with `clickhouse_settings: { readonly: '1' }`.

### 2. Two-tier write safety

Add `packages/mcp-server/src/tools/write-gate.ts`:

```ts
export function writeAllowed(): boolean { return process.env.CHM_MCP_ALLOW_WRITE === 'true' }
export function dropAllowed(): boolean { return process.env.CHM_MCP_ALLOW_DROP === 'true' }
```

- **Default (both unset): read-only.** Any write/mutating tool returns
  `isError: true` with a message telling the operator which env to set.
- Tier 1 `CHM_MCP_ALLOW_WRITE=true`: enables non-destructive control tools
  (`kill_query`, `optimize_table`, `kill_mutation`) as MCP tools — mirrors the
  agent's `control-tools.ts`, reusing its identifier validation.
- Tier 2 `CHM_MCP_ALLOW_DROP=true`: additionally required for anything matching a
  DROP/TRUNCATE/DELETE-mutation classifier. A statement classified as DROP is
  refused when only `ALLOW_WRITE` is set. Never a single "allow everything" flag.
- **Cloud multi-tenant fail-closed**: the write gate is forced off in cloud mode
  regardless of env (same pattern as `arePrivateHostsAllowed()` in
  `plans/01-allow-private-hosts.md`) — write tools are a self-hosted-operator
  capability only.

Document `CHM_MCP_ALLOW_WRITE` / `CHM_MCP_ALLOW_DROP` in `.env.example` next to
`CHM_MCP_PUBLIC`.

### 3. Installable agent skills over MCP

The build already emits a registry from `.agents/skills/` via
`scripts/build-skills-registry.ts` (→ `lib/ai/agent/skills/registry.ts`,
`skills-lock.json`). Expose that catalog through the MCP server as **resources**
(the server already declares `system-tables` and `query-examples` resources in
`http.ts buildServerInfo()`):

- Add a `skills` resource namespace (`chm-skill://<name>`) generated from the same
  registry, so an MCP client can list + fetch a skill's SKILL.md to install it
  into its own agent (Claude Desktop / Cursor "add skill" flows).
- Add a `list_skills` MCP tool returning the catalog (name + description) so agents
  can discover before fetching.
- Keep the skill *source of truth* in `.agents/skills/`; the MCP layer only reads
  the generated registry — one build, two consumers (our agent + third parties).

### 4. BYOK note (cross-ref)

BYOK for the agent's LLM provider is monetization (Plan 01 §3 / Plan 13), not this
plan — but the semantic tools + skills are what make BYOK worth it. No BYOK code
here; just ensure new tools don't hard-code a provider.

### Surfaces

- `packages/mcp-server/src/tools/`: `replication.ts`, `merge-backlog.ts`,
  `disk-pressure.ts`, `explain-slow-query.ts`, `suggest-projections.ts`,
  `write-gate.ts`, control tools, `list-skills.ts`; all wired in `tools/index.ts`.
- `packages/mcp-server/src/data/mcp-tools-data.ts` — add entries (new `system`
  category tools + params + example responses) so `/info` and the sidebar list them.
- `packages/mcp-server/src/resources/` — skills resource namespace.
- `.agents/skills/optimization-advisor/SKILL.md` — new skill teaching how to read
  the Plan 21 advisor output (routed to by Plan 10). Rebuild with `bun run build:skills`.
- `.env.example` — `CHM_MCP_ALLOW_WRITE`, `CHM_MCP_ALLOW_DROP`.
- Auth/gating unchanged: bearer API key + `CHM_MCP_PUBLIC`, Max+ via
  `api_mcp_access` (`lib/billing/plan-enforcement.ts`).

## Steps

1. **(PR)** Add `write-gate.ts` (read-only default, two-tier, cloud fail-closed) +
   unit tests for the env matrix and the DROP classifier. No tools wired yet.
2. **(PR)** Add `check_replication_health` + `find_merge_backlog` semantic tools,
   register in `tools/index.ts`, add to `mcp-tools-data.ts`; golden-report tests
   against a fake `fetchData`.
3. **(PR)** Add `diagnose_disk_pressure` + `explain_slow_query` tools + tests +
   catalog entries.
4. **(PR)** Add `suggest_projections` MCP tool wrapping `lib/advisor` (Plan 21) +
   test; catalog entry.
5. **(PR)** Gate the three control tools (`kill_query`/`optimize_table`/
   `kill_mutation`) behind the write-gate as MCP tools; integration test proves
   refuse-without-`ALLOW_WRITE`, DROP-refuse-without-`ALLOW_DROP`, cloud-forced-off.
6. **(PR)** Author `.agents/skills/optimization-advisor/SKILL.md`, run
   `bun run build:skills`, add `list_skills` tool + `chm-skill://` resource
   namespace; test that the catalog is served and a skill body is fetchable.
7. **(PR)** `.env.example` + `plans/roadmap/README.md` status row +
   `docs/content/guide/ai-agent.mdx` (MCP tool list + write-safety tiers).

> This is an `L` plan. Each numbered step is an independently mergeable `≤ M`
> unit → one PR; a child plan is "step N of Plan 11". Steps 2–4 parallelize after
> step 1; step 4 depends on Plan 21; step 6 depends on Plan 21's advisor output
> shape.

## Real test

`packages/mcp-server/src/__tests__/write-gate.test.ts` (fails today — module
doesn't exist):

```ts
import { assertWriteAllowed, classifyStatement } from '../tools/write-gate'

describe('two-tier MCP write safety', () => {
  afterEach(() => { delete process.env.CHM_MCP_ALLOW_WRITE; delete process.env.CHM_MCP_ALLOW_DROP })

  test('read-only by default: a write is refused', () => {
    expect(() => assertWriteAllowed('OPTIMIZE TABLE db.t')).toThrow(/read-only|ALLOW_WRITE/i)
  })

  test('ALLOW_WRITE permits non-destructive writes but not DROP', () => {
    process.env.CHM_MCP_ALLOW_WRITE = 'true'
    expect(() => assertWriteAllowed('OPTIMIZE TABLE db.t')).not.toThrow()
    expect(classifyStatement('DROP TABLE db.t')).toBe('drop')
    expect(() => assertWriteAllowed('DROP TABLE db.t')).toThrow(/ALLOW_DROP/i)
  })

  test('ALLOW_DROP is required on top of ALLOW_WRITE for destructive DDL', () => {
    process.env.CHM_MCP_ALLOW_WRITE = 'true'
    process.env.CHM_MCP_ALLOW_DROP = 'true'
    expect(() => assertWriteAllowed('DROP TABLE db.t')).not.toThrow()
  })
})
```

Plus a semantic-tool integration test asserting `check_replication_health` returns
one structured `{ status, replicas, severity }` report in a single call.

## Verification

```
bun run test:unit --filter @chm/mcp-server
bun run build:skills
bun run lint
bun run build
```

## Out of scope / STOP conditions

- **Read-only is the default and can never be silently overridden.** No single
  "allow all" flag. DROP/TRUNCATE/destructive-mutation always requires the second
  tier. Cloud mode forces the gate off entirely.
- The MCP server does **not** auto-apply advisor DDL — `suggest_projections`
  returns text recommendations only (Plan 21 invariant holds across the boundary).
- No auth-model changes (bearer API key + `CHM_MCP_PUBLIC` + `api_mcp_access`
  stay as-is).
- Skills' source of truth stays `.agents/skills/`; the MCP layer only reads the
  generated registry — do not fork skill content into the package.
- **Self-hosted stays whole / fail-closed to OSS**: semantic read tools and the
  skill catalog ship in OSS; write tools are a self-hosted-only, opt-in capability
  and are absent (not merely disabled) in cloud mode.

## Done

- [ ] `write-gate.ts` two-tier gate + DROP classifier, cloud fail-closed; tests green.
- [ ] 5 semantic tools (`check_replication_health`, `find_merge_backlog`,
      `diagnose_disk_pressure`, `explain_slow_query`, `suggest_projections`)
      registered + in `mcp-tools-data.ts`; one-call structured reports.
- [ ] Control tools gated behind the write-gate as MCP tools; refusal + cloud-off tests.
- [ ] `optimization-advisor` skill authored + `bun run build:skills` run;
      `list_skills` tool + `chm-skill://` resources served.
- [ ] `.env.example` documents `CHM_MCP_ALLOW_WRITE` / `CHM_MCP_ALLOW_DROP`.
- [ ] Real write-gate test fails on `main`, passes after; MCP integration tests green.
- [ ] `bun run lint && bun run build && bun run build:skills` green.
- [ ] Status row for #11 in `plans/roadmap/README.md` updated.
- [ ] `docs/content/guide/ai-agent.mdx` updated (semantic MCP tools + write-safety tiers + installable skills).
