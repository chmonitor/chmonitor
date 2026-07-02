# 10 — AI Agent, Ops-First

> Priority: P0 · Effort: L · Risk: MED · Depends on: 21 (advisor engine — for `suggest_optimizations`)
> Category: AI moat · Planned at commit `ab4c34426`, 2026-07-02.

## Problem

The agent today is framed as a **database-query assistant for analysts**, not an
**SRE/DBA fixing clusters**. Read the system prompt
(`apps/dashboard/src/lib/ai/agent/prompts/clickhouse-instructions.ts`): line 12
opens *"You are a ClickHouse database expert assistant … help users analyze their
ClickHouse databases through natural language queries."* The example interactions
are "Show me all databases", "What are the largest tables?", "query performance
trends over the last 24 hours." That is an analyst persona. The tools are already
ops-shaped (`get_replication_status`, `get_merge_status`, `get_table_parts`,
`get_failed_queries`, env-gated `kill_query`/`optimize_table`/`kill_mutation` in
`tools/control-tools.ts`), and the skills catalog is pure DBA
(`incident-response`, `troubleshooting`, `replication-guide`,
`cluster-operations`, `hardware-tuning`). The **persona and the routing are the
mismatch**, not the capability.

The lesson from ClickHouse's own ClickStack MCP is explicit (research appendix
§ClickHouse-AI): **semantic ops framing + grounding beats a generic query bot** —
25% fewer tool calls, 2.5× more consistent, +20% on evals — when the agent is told
it is diagnosing operational problems and is grounded hard in schema/COMMENTs and
a fixed diagnostic discipline. Right now the prompt spends ~550 lines teaching
generic ClickHouse trivia (engine families, data-type selection) and only a
fraction on the *ops loop*: detect → diagnose → recommend → verify.

Why now: the agent is the AI moat and the reason ClickHouse Cloud structurally
won't compete for self-hosters/fleets. Once the advisor engine (Plan 21) exists,
the agent needs to *lead with it*. This is Wave 1.

## Goal

Reorient the agent's **persona and diagnostic loop to SRE/DBA-fixing-clusters**
(not analyst-asking-business-questions) — measurable as: a new persona/eval test
asserts the agent, given an ops symptom ("replication is lagging", "inserts are
failing"), (a) opens with `update_plan`, (b) calls the matching **semantic**
health/replication/merge tool before raw `query`, and (c) proposes a concrete
fix + a verification step — and the prompt's opening + routing table are
ops-framed, with zero regression in the existing agent tests.

## Design

### 1. Rewrite the persona head of `clickhouse-instructions.ts`

Replace the opening block (currently lines ~12–22) so the agent's identity is an
**operations engineer / DBA** working on **self-hosted and fleet clusters**:

- Opening: *"You are a ClickHouse **site-reliability and database engineer**
  embedded in a monitoring platform. Operators bring you **operational
  symptoms** — lag, backlog, disk pressure, failing inserts, slow production
  queries, regressions — and you **diagnose the root cause from `system.*`
  evidence and recommend a concrete, safe fix.** You are not a business-analytics
  assistant; you do not answer questions about the *contents* of user data unless
  they are diagnosing an operational problem."*
- Add a **Diagnostic loop** section (detect → gather evidence from the right
  system table → form a hypothesis → recommend a fix with the exact DDL/setting →
  state how to verify) that supersedes the analyst-flavored "Exploration Pattern".
- Keep the deep ClickHouse reference material (engines, keys, EXPLAIN) but move it
  behind the ops framing — it is *reference the DBA reaches for*, not the lead.

### 2. Ops-first use-case → skill/tool routing

The current routing table (prompt lines ~111–120) leads with "analyze…",
"largest/top/most…", "over time". Reorder so **operational symptoms route first**,
and point at the semantic tools + the new advisor:

| Operator says | Lead tool | Then skill |
|---|---|---|
| "replication is behind / replicas readonly" | `get_replication_status` | `replication-guide` |
| "merges are piling up / parts exploding" | `get_merge_status`, `get_table_parts` | `troubleshooting` |
| "disk is filling" | `get_disk_usage` | `incident-response` |
| "inserts/queries are failing" | `get_failed_queries` | `troubleshooting` |
| "this query got slow / prod is slow" | `get_slow_queries` + `explain_query` | `query-tuning-advisor` |
| "make my cluster faster / what should I change" | `suggest_optimizations` (Plan 21) | `optimization-advisor` (Plan 11) |
| "what's wrong right now / health check" | `update_plan` → sweep tools | `incident-response` |

Analyst-style asks ("largest table", "trend over time") stay supported but move
**below** the ops routes — data-driven table, not hard-coded per-question logic.

### 3. Ground the agent harder (schema + COMMENTs)

Per the ClickStack lesson, strengthen the existing (already good) instinct to
verify columns. `explore_table_schema` / `get_table_schema` already return
`comment` columns (see `tools/schema-tools.ts` — it selects `comment` from
`system.columns` and `system.databases`). Add an explicit instruction: *"Before
reasoning about an unfamiliar table, read its COMMENTs (table + column) — operators
document partition keys, TTLs, and ownership there; use them as ground truth."*
This is prompt-only, no code change.

### 4. Rewrite example interactions to ops scenarios

Replace the analyst examples (prompt lines ~488–555: "Show me all databases",
"largest tables", "performance trends") with ops walkthroughs that demonstrate the
diagnostic loop: a replication-lag investigation, a merge-backlog triage, a
"why did this query regress" that ends in a `suggest_optimizations` handoff. Keep
2–3 short examples; the current 15 examples bloat the prompt and skew it analyst.

### Surfaces

- `apps/dashboard/src/lib/ai/agent/prompts/clickhouse-instructions.ts` — persona head, diagnostic-loop section, routing table, grounding note, examples.
- `apps/dashboard/src/lib/ai/agent/suggested-prompts.ts` — swap analyst starters for ops symptoms ("Diagnose replication lag", "Why are merges backing up?", "What should I optimize?").
- `apps/dashboard/src/lib/ai/agent/tools/` — register `suggest_optimizations` (from Plan 21) in `tools/index.ts` and the prompt's tool list.
- No provider/streaming/tool-loop changes (`clickhouse-agent.ts` untouched).

## Steps

1. **(PR)** Rewrite the persona head + add the Diagnostic-loop section in
   `clickhouse-instructions.ts`; add a persona-assertion unit test (below). Keep
   the ClickHouse reference material intact but repositioned.
2. **(PR)** Replace the routing table with the ops-first table and add the
   COMMENT-grounding instruction. Update `suggested-prompts.ts` to ops symptoms;
   fix `suggested-prompts.test.ts` expectations.
3. **(PR)** Replace analyst example interactions with 2–3 ops-loop walkthroughs.
4. **(PR)** Wire `suggest_optimizations` into `tools/index.ts` + document it in the
   prompt's tool list and routing row (depends on Plan 21 step 6).
5. **(PR)** Add an ops-behavior eval test in `__tests__/` and update
   `plans/roadmap/README.md` + `docs/content/guide/ai-agent.mdx`.

> This is an `L` plan. Each step is an independently mergeable `≤ M` unit → one PR.
> A child plan is "step N of Plan 10". Step 4 depends on Plan 21 step 6; steps 1–3
> and 5's persona assertion do not and can proceed in parallel.

## Real test

`apps/dashboard/src/lib/ai/agent/__tests__/agent-persona.test.ts` (fails today):

```ts
import { CLICKHOUSE_AGENT_INSTRUCTIONS } from '../prompts/clickhouse-instructions'

test('agent persona is SRE/DBA ops-first, not analyst-first', () => {
  const p = CLICKHOUSE_AGENT_INSTRUCTIONS.toLowerCase()
  // Ops framing present up front (first 600 chars = the persona head)
  const head = p.slice(0, 600)
  expect(head).toMatch(/site-reliability|dba|operations engineer/)
  expect(head).toMatch(/operational symptom|diagnose|root cause/)
  // Diagnostic loop documented
  expect(p).toContain('diagnostic loop')
  // Ops symptoms route before analyst asks: replication route appears
  // earlier in the routing section than the "largest/top" analyst route.
  const repl = p.indexOf('replication is behind')
  const analyst = p.indexOf('largest/top')
  expect(repl).toBeGreaterThan(-1)
  expect(analyst).toBeGreaterThan(-1)
  expect(repl).toBeLessThan(analyst)
})
```

(Existing tests — `clickhouse-agent.test.ts`, `suggested-prompts.test.ts`,
`agent-conversation.test.ts` — must stay green; step 2 updates the
suggested-prompts expectations in the same PR.)

## Verification

```
bun run test:unit --filter @chm/dashboard agent
bun run lint
bun run build
```

## Out of scope / STOP conditions

- **Prompt/persona + routing only** — no changes to providers, streaming,
  tool-loop, or auth (`clickhouse-agent.ts`, `provider-chat-model.ts` untouched).
- Do **not** enable destructive control tools by default. `AGENT_ENABLE_CONTROL_TOOLS`
  stays off; the persona rewrite must still tell the agent to *recommend and confirm*,
  never silently mutate. Two-tier write safety and any new tools are Plan 11.
- Do not remove the ClickHouse reference material — reposition it, don't delete
  the DBA's reference library.
- **Self-hosted stays whole / fail-closed to OSS**: the persona ships in the OSS
  build; no ops capability is gated behind cloud mode.

## Done

- [ ] Persona head + Diagnostic-loop section rewritten (SRE/DBA, symptom-driven).
- [ ] Ops-first routing table replaces analyst-first ordering; COMMENT-grounding note added.
- [ ] Example interactions are ops-loop walkthroughs.
- [ ] `suggested-prompts.ts` ops symptoms; its test updated.
- [ ] `suggest_optimizations` wired + documented (with Plan 21).
- [ ] `agent-persona.test.ts` fails on `main`, passes after; all existing agent tests green.
- [ ] `bun run lint && bun run build` green.
- [ ] Status row for #10 in `plans/roadmap/README.md` updated.
- [ ] `docs/content/guide/ai-agent.mdx` updated to reflect the ops-first persona.
