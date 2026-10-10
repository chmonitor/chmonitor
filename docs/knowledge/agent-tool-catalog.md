---
id: agent-tool-catalog
title: Agent tool catalog, core set, and search_tools
type: spec
status: active
updated: 2026-10-11
tags:
  - ai
  - agent
  - tools
  - catalog
  - prompt
  - testing
related:
  - conventions
  - agent-eval
  - agent-model-discovery
  - product-design
---

# Agent tool catalog

The agent ships 41 tools in one flat namespace (32 by default, plus 3
env-gated control, 4 Postgres, 2 PeerDB). The per-tool metadata lives in
`src/lib/ai/agent/tools/catalog.ts`.

## The side-table rule

`TOOL_CATALOG` is keyed by tool name and holds **only what cannot be derived
from the tool definition**: `category`, a routing `summary`, search
`keywords`, and the `core` marker. The long `description` is deliberately NOT
duplicated — `search_tools` reads it off the live tool object at call time, so
there is one source per fact.

> **Adding a tool means adding its catalog row in the same commit.** Four tests
> enforce the surrounding invariants, and the count assertions in
> `tool-docs-sync.test.ts` and `prompts/__tests__/clickhouse-instructions.test.ts`
> must be bumped to match.

## Which anti-drift test catches what

| Test | Catches |
|---|---|
| `tools/__tests__/tool-catalog.test.ts` | a tool with no catalog row, or a row with no tool; a bad category; core set empty or containing a gated tool |
| `tools/tool-docs-sync.test.ts` | a tool missing from `capabilities.mdx` (backticked) or the prompt `TOOL_LIST` (substring), plus the total count |
| `tools/skills-tool-names.test.ts` | a backticked tool-like name in `.agents/skills/*/SKILL.md` prose that `createAllTools(0, true)` does not expose |
| `prompts/__tests__/clickhouse-instructions.test.ts` | prompt behavior regressions, and the default / gated-on counts |
| `tests/agent/coverage.test.ts` (repo root) | a default-gate tool with no promptfoo golden case `metadata.covers` entry |

That last one lives **outside** `apps/dashboard` and scans `tools/*.ts` with
`/^\s+([a-z][a-z0-9_]+):\s*dynamicTool\(/gm`, so a new tool factory is picked
up automatically. Its `GATED` set lists tools that are intentionally excluded
from default-gate golden coverage (all the env-gated ones, including both
PeerDB tools).

## `get_page_data` and the page map

`get_page_data` (discovery, not core) answers "what does the X page show?" by
running the page's own sources: table configs through `getTableQuery` →
`executeTableConfig`, charts through `getChartQuery` → `executeChartQuery`
(or `executeMultiChartQuery` for keyed multi-query charts). `find_reference_query`
only returns SQL; this tool executes it, so filters, versioned SQL, the row
cap, and the optional-table check behave exactly like the UI.

- **The map is static**: `src/lib/ai/agent/page-data-map.ts` lists
  route → `{ title, section, configs, charts }`. Route files are React and must
  not be imported by the server tool. Overview has one entry per tab
  (`/overview/<tab>`, also reachable as `/overview?tab=<tab>`), because its 60
  charts would not fit one call.
- **`NON_DATA_PAGES`** lists pages with nothing to replay (forms, redirects,
  hub pages, Postgres/PeerDB pages owned by other tools), each with a reason.
- **Coverage gate**: `src/lib/ai/agent/__tests__/page-data-map.test.ts` scans
  `routes/(dashboard)/**` for imported `QueryConfig`s (and their
  `relatedCharts`) and literal `chartName`s, and fails when one is missing
  from that route's entry, when a mapped name does not resolve in the live
  registries, or when a route file or menu href is in neither table. Pages
  whose data lives in components (overview tabs, health, running queries,
  part log) are maintained by hand: the test checks only that their names
  resolve.
- **Filters**: with a `filterSchema`, only schema keys are accepted (plain
  values become `eq:`); without one, only keys in `defaultParams`. Anything
  else comes back as `ignoredFilters`. `lastHours` maps to the first
  `datetime` filter field, a `last_hours` default param, or a chart builder's
  `lastHours`.
- **Bounds**: rows per source default 20, max 200 (re-clamped in `execute`);
  at most 24 sources per call (the rest are named in `skipped`); total output
  about 16 KB, trimmed by halving the largest source and flagging `truncated`.
- A config must be in `queries` (`lib/query-config/index.ts`) to be runnable.
  The three Keeper deep-dive configs were missing from it and were added with
  this tool.

## `search_tools` is bound to the post-gate map

`createSearchTools(available)` takes the **already-gated** tool map, and
`createAllTools()` attaches it **last**:

```ts
const tools = { /*Schema & exploration*/
  /* ...all factories, each self-gated... */
  /* PeerDB */...(enablePeerDBTools ? createPeerDBTools() : {}),
}
return { ...tools, ...createSearchTools(tools) }
```

That ordering is the whole gate contract: `search_tools` can never advertise a
tool the model cannot call, because it only ever sees tools that survived the
gates. One wrinkle — `search_tools` is attached after the map it searches, so
it adds its own name to the registered set, otherwise it reports itself as
gated off.

Gated tools are reported under `unavailable_due_to_gates` rather than omitted,
so the model learns "not available here" instead of concluding the capability
does not exist.

## Why the whole tool set is still sent

`search_tools` is **discovery, not a gate**. Do not "optimize" it into a gate
without reading this first:

- The AI SDK's `ToolLoopAgent` takes a static `tools` map at construction. There
  is no supported way to inject a tool mid-loop (`prepareStep` can restrict via
  `activeTools`, not add). So a model that discovers a long-tail tool could not
  call it in the same turn.
- The prompt `TOOL_LIST` must contain **every** tool name as a plain substring —
  `tool-docs-sync.test.ts` requires it. So the prompt cannot be shrunk to core
  either.

What the core marker buys today: an accurate answer to "what can I do?" (a bare
`search_tools` call returns the core set), a routing taxonomy, and a ready-made
subsetting lever. `longTailToolNames()` + the existing `filterTools` /
`disabledTools` seam in `clickhouse-agent.ts` is the path to take when the SDK
gains mid-loop injection: the long tail is 28 of the 32 default tools and ~54%
of the tool-schema bytes.

## Measured schema cost

Measured on this branch (default gate, `z.toJSONSchema` over each tool's
`inputSchema`, `name + description + parameters` serialized; tokens ≈ bytes/4):

| | before | after |
|---|---|---|
| default tools | 30 (26,417 B) | 31 (27,840 B) |
| system prompt | 5,410 B | 5,745 B |
| default request total | 31,827 B (~7,957 tok) | 33,585 B (~8,396 tok) |

`search_tools` costs 1,423 B (~356 tok) — the 4th-largest tool schema, after
`load_skill`, `ask_user`, and `update_plan`. It is the one deliberate
regression, in exchange for the routing help and the drift guard.

`load_skill` description: 3,366 chars before (18 skills, full descriptions
inlined) and 1,504 chars after (name plus a first-sentence purpose capped at 60
chars). Unknown names still error with the full skill-name list.

Query results sent to the model are capped at 200 rows (`MAX_QUERY_RESULT_ROWS`)
and 16,384 JSON bytes (`MAX_RESULT_BYTES`, `capResultBytes`); `capResultRows`
returns a `truncationNote` telling the model to narrow the query.
`query_and_visualize` keeps 1,000 rows and no byte cap because it renders
client-side.

### History compaction (earlier turns' tool outputs)

Tool parts keep their full `output` in the UI history, and
`convertToModelMessages` resends every one of them on every later step and
turn. `compactHistoricalToolParts` (`routes/api/v1/-agent/request-parsing.ts`)
runs just before `convertToModelMessages` in `-agent/stream.ts`. For tool
parts before the latest user message whose output is over 2,048 JSON bytes,
it replaces `output` with
`{summary?, rowCount, columns, truncated: true, note}`. `summary` takes the
output's `summary` / `message` / `error` string. The current turn is never
touched, small outputs and `output-error` parts stay as they are, and the
part keeps its `toolCallId` / `input` / `state`, so call/result pairing holds.
`originalMessages` on the UI stream is still the uncompacted list, so the
client keeps showing full results.

Measured with a fixture of 3 turns, each with a 1,000-row query result
(`-agent/compact-tool-parts.test.ts`): model-input JSON goes from 302,299 B to
101,817 B (-66%). Only turn 3 keeps its rows. The saving grows with each
extra turn.

## Gotchas

- **Never `git checkout <path>` in a shared worktree.** A concurrent session had
  committed these files, which turned a scratch revert into a silent discard of
  later fixes. Copy files to `/tmp` and restore with `cp`, or edit in place.
- **`bun test --isolate` isolates module registries, not `process.env`.** A test
  that flips a gate at module scope leaks into every other file in the run and
  fails *their* gate assertions. Set env in `beforeEach`, restore in
  `afterEach`, and recompute anything derived from `createAllTools()` inside
  the hook (it reads env at call time, not import time).
- Scoring in `search_tools` is a weighted sum over name parts, the de-underscored
  name, keywords, and the summary, and a zero score is dropped. That is
  deliberate: returning the whole catalog under any query would make the tool
  useless and hide the point of a cap.
- `dynamicTool`'s zod `inputSchema` is validated by the SDK before `execute` in a
  real run, but `execute` is directly callable (tests, custom callers). Re-apply
  length bounds inside `execute` rather than assuming the schema ran.
