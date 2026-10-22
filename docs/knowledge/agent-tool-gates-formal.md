---
id: agent-tool-gates-formal
title: Agent tool gates, exhaustive check
type: spec
status: active
updated: 2026-10-23
tags:
  - ai
  - agent
  - security
  - verification
  - formal
related:
  - agent-tool-catalog
  - agent-verification
  - cloud-saas-mode
---

# Agent tool gates, exhaustive check

`apps/dashboard/src/lib/ai/agent/__tests__/tool-gate.formal-check.ts` runs the
real route composition for every request shape in a finite domain. The steps
are:

1. resolver;
2. `actions` permission;
3. `createClickHouseAgent`;
4. `createAllTools`;
5. `filterTools`;
6. `agent.tools`.

The domain has 5,632 shapes for write and integration safety and 2,048 for
search honesty. The owning skill is
`.claude/skills/verify-agent-tool-gates/SKILL.md`. It holds the properties,
the coverage table, the sync commit, and the instructions for telling a real
bug from a modelling error.

Run it with
`cd apps/dashboard && bun test ./src/lib/ai/agent/__tests__/tool-gate.formal-check.ts`
(about 35 s). It is not part of CI on purpose. The fast 18-cell
`create-all-tools-gate.test.ts` stays in CI.

## Why enumeration, not TLA+

The gate is a pure function of a finite request shape, with no concurrency.
Running the real functions over every shape checks the code itself. A TLA+
model would check a hand copy of it.

## Finding (2026-10-23)

`search_tools` is bound inside `createAllTools()`, before `filterTools()`
applies the request's `disabledTools`. So a disabled tool is still advertised
as callable, and `callable_tool_count` is one too high per disabled tool.

- Counterexample: `disabledTools: ['query']`.
- The finding is encoded as `test.failing`. The test turns red when the
  finding is fixed.
- Product code was not changed.
