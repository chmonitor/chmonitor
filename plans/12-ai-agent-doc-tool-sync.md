# Plan 12: Sync the ai-agent.mdx tool list with the code, and add an anti-drift test

> **Executor instructions**: Follow step by step; verify each step. On a "STOP
> condition", stop and report. When done, update this plan's row in
> `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat c5b2ae41c..HEAD -- apps/dashboard/src/lib/ai/agent/tools/index.ts docs/content/guide/ai-agent.mdx`
> On any change, compare "Current state" against live code; mismatch = STOP.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `c5b2ae41c`, 2026-07-03

## Why this matters

`apps/dashboard/CLAUDE.md` mandates that `docs/content/guide/ai-agent.mdx` stay in sync with
the agent tools whenever a tool is added/renamed/removed. It has drifted: `createAllTools`
(`tools/index.ts`) assembles **18 default + 3 gated** tools, but the doc's tool table
(`ai-agent.mdx:227-237`) lists only **9**. Missing from the doc: `get_failed_queries`,
`explain_query`, `get_disk_usage`, `get_table_parts`, `get_replication_status`,
`update_plan`, `load_skill`, `ask_user`, `query_and_visualize`, plus the three gated control
tools. Users of the documented agent surface can't see ~half its capabilities. The fix
updates the doc and adds a test so it can't silently drift again.

## Current state

Source of truth — `apps/dashboard/src/lib/ai/agent/tools/index.ts`, `createAllTools(hostId, includeControlTools)`.
Its doc-comment (`:25-38`) lists the full set:
- **Schema & exploration**: `query`, `list_databases`, `list_tables`, `get_table_schema`, `explore_table_schema`
- **Query analysis**: `get_running_queries`, `get_slow_queries`, `get_failed_queries`, `explain_query`
- **Health**: `get_metrics`, `get_disk_usage`
- **Storage**: `get_table_parts`
- **Replication**: `get_replication_status`
- **Merges**: `get_merge_status`
- **Planning**: `update_plan`
- **Knowledge**: `load_skill`
- **Interaction**: `ask_user`
- **Visualization**: `query_and_visualize`
- **Control (destructive, env-gated `AGENT_ENABLE_CONTROL_TOOLS=true`)**: `kill_query`, `optimize_table`, `kill_mutation`

The doc — `docs/content/guide/ai-agent.mdx`. The table under `### MCP tools` (`:227-237`)
lists only 9 names. `AGENT_ENABLE_CONTROL_TOOLS` is already documented (`:250`), so only tool
rows are missing.

**Important nuance (verify before editing):** the table is titled *"MCP tools"*. Confirm
whether it is meant to describe the in-app **agent** tools (what CLAUDE.md governs) or the
**MCP server** (`routes/api/mcp.ts` / `packages/mcp-server`) subset, which may legitimately
expose fewer. If the MCP server is a deliberate subset, do NOT force all 21 into that table —
instead document the full **agent** toolset (a clearly-labelled section) and keep the MCP
subset accurate. The CLAUDE.md mandate is about the agent tools in `lib/ai/agent/tools`.

Convention: the repo already uses anti-drift coverage tests — see
`apps/dashboard/src/lib/billing/plan-enforcement.test.ts` (asserts every capability is
classified). Model the new test on it. Tests are **Bun test**.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Run new test | `cd apps/dashboard && bun test src/lib/ai/agent/tools/tool-docs-sync.test.ts --isolate` | all pass |
| Docs build (optional) | `cd apps/docs && bun run build` | exit 0 |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `docs/content/guide/ai-agent.mdx` (the committed docs source of truth)
- `apps/dashboard/src/lib/ai/agent/tools/tool-docs-sync.test.ts` (create — anti-drift test)

**Out of scope**:
- `tools/index.ts` and the tool modules — the code is the source of truth; do not change tools.
- `apps/docs/content/**` (generated from `docs/content/**` at build; do not edit the generated copy).
- Renaming/reorganising the whole guide — only reconcile the tool list + add the gated section.

## Git workflow

- Branch: `advisor/12-ai-agent-doc-tool-sync`
- Conventional commits + `Co-Authored-By: duyetbot <bot@duyet.net>`. Example: `docs(agent): sync ai-agent.mdx tool list with code + add anti-drift test`.
- Do NOT push/PR unless instructed.

## Steps

### Step 1: Decide the doc surface (agent vs MCP-server)

Read `routes/api/mcp.ts` and/or `packages/mcp-server` to see which tools the MCP server
exposes. If it is the same set as `createAllTools`, the `### MCP tools` table is simply
stale → update it. If it is a deliberate subset, add a new subsection (e.g. `### Agent tools`)
listing the full agent set, keep the MCP table accurate, and cross-reference. Write down which
case applies (it drives Step 2 and the test target).

**Verify**: note the decision in the PR description.

### Step 2: Update the doc to list every agent tool (+ gated control tools)

Add rows for the missing default tools (`get_failed_queries`, `explain_query`,
`get_disk_usage`, `get_table_parts`, `get_replication_status`, `update_plan`, `load_skill`,
`ask_user`, `query_and_visualize`) with a one-line purpose each (derive purpose from each
tool module's `description` in `lib/ai/agent/tools/*.ts`). Add a clearly-labelled row/section
for the three gated control tools (`kill_query`, `optimize_table`, `kill_mutation`) noting
they require `AGENT_ENABLE_CONTROL_TOOLS=true`.

**Verify**: `rg -c "get_failed_queries|explain_query|get_disk_usage|get_table_parts|get_replication_status|update_plan|load_skill|ask_user|query_and_visualize|kill_query|optimize_table|kill_mutation" docs/content/guide/ai-agent.mdx` → all 12 names present (count ≥ 12).

### Step 3: Add the anti-drift test

Create `tool-docs-sync.test.ts` that reads `docs/content/guide/ai-agent.mdx` (via
`readFileSync` with a path relative to the test file) and asserts every tool name from the
code appears in it. Prefer deriving names from the code:
`Object.keys(createAllTools(0, true))` with `process.env.AGENT_ENABLE_CONTROL_TOOLS='true'`
set so the control tools are included. If importing `createAllTools` pulls in unmanageable
deps in the test runtime, fall back to a hardcoded list of the 21 names with a comment that
it must track `tools/index.ts`. Assert: for each tool name, the mdx contains it.

**Verify**: `cd apps/dashboard && bun test src/lib/ai/agent/tools/tool-docs-sync.test.ts --isolate` → passes; deleting a tool row from the mdx makes it fail (sanity-check once, then restore).

## Test plan

- New `tool-docs-sync.test.ts`: every `createAllTools(0, true)` key appears in `ai-agent.mdx`.
- Structural pattern: `plan-enforcement.test.ts` (coverage/anti-drift assertion) + `health-sweep.test.ts` (readFileSync of a sibling doc/source).
- Verification: `cd apps/dashboard && bun test src/lib/ai/agent/tools --isolate` → all pass.

## Done criteria

- [ ] All 12 previously-missing tool names appear in `docs/content/guide/ai-agent.mdx`
- [ ] `tool-docs-sync.test.ts` exists and passes, and fails if a tool row is removed
- [ ] `cd apps/dashboard && bun test src/lib/ai/agent/tools/tool-docs-sync.test.ts --isolate` passes
- [ ] `bun run lint` exits 0
- [ ] Only `docs/content/**` (not the generated `apps/docs/content/**`) edited
- [ ] `plans/README.md` status row updated

## STOP conditions

- The MCP server is a deliberate subset AND reconciling would require restructuring the guide
  beyond adding a section — report the structural choice rather than guessing.
- `createAllTools` cannot be imported in the test runtime and a hardcoded list would be the
  only option — that's acceptable, but note it as a maintenance cost in the test comment.
- The tool set in `tools/index.ts` differs from the excerpt (drift) — document the current set.

## Maintenance notes

- Reviewer: confirm the anti-drift test derives from `createAllTools` (or, if hardcoded, that
  the list matches). This test is what keeps the CLAUDE.md doc-sync mandate enforceable.
- When a tool is added/renamed/removed in `lib/ai/agent/tools/*`, this test fails until the
  doc is updated — that is the intended behaviour.
