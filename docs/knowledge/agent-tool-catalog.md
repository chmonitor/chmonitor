---
id: agent-tool-catalog
title: Agent tool catalog, core set, and search_tools
type: spec
status: active
updated: 2026-09-26
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

The agent ships 40 tools in one flat namespace (31 by default, plus 3
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
gains mid-loop injection: the long tail is 27 of the 31 default tools and ~54%
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
