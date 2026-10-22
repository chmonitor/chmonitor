---
id: agent-verification
title: Agent verification and question bank
type: spec
status: active
updated: 2026-10-23
tags:
  - ai
  - agent
  - eval
  - verification
  - testing
related:
  - agent-eval
  - agent-tool-catalog
  - agent-tool-gates-formal
---

# Agent verification and question bank

There are two layers. Each catches what the other cannot.

| Layer | What | Where |
|---|---|---|
| Offline gate | Every tool or skill named in any eval case exists in `TOOL_CATALOG` or the skills registry, and every core tool has a question | `tests/agent/question-bank.test.ts` (runs in the required `unit-tests` job via `tests/agent`) |
| Live drive | One bank question sent to a real `/api/v1/agent`, with the called tools compared against the case | `.claude/skills/verify-agent/` (`ask-agent.ts`, feature map) |

## The question bank

The bank is `tests/agent/cases/questions.yaml`. It is part of the existing
promptfoo dataset, not a parallel bank. It is listed in
`promptfooconfig.all.yaml` and tagged `tools`, so `pnpm run test:agent:all` and
`--tags tools` run it.

Each case has three parts:

- `metadata.covers`: the expected primary tool or tools.
- `metadata.skills`: optional. The skill or skills `load_skill` should load.
- A `toolCalled` assertion. Its `config.tools` must contain every `covers`
  entry, plus `load_skill` when the case names a skill.

A consistent rename keeps `tool-catalog.test.ts` green and turns the bank test
red until the bank follows. A consistent rename means both the factory key in
`tools/*.ts` and the catalog row change. This was proven on 2026-10-23 by
renaming `list_tables` to `list_tables_v2`. The "referenced tools in catalog"
and "every core tool has a question" tests both failed.

The bank test checks every case file, not only the bank. Tool names are taken
from `covers`, from `toolCalled` / `noToolCalled` config, and from
`[tool:x]` in `contains` / `not-contains`.

## Limits

- The SSE parser emits `[tool:load_skill]` without the skill name. Live runs
  prove that a skill was loaded, and the bank test proves that the named skill
  exists. Nothing yet proves the *right* skill was loaded live.
- Production as a guest proves the deployed `main`, not a branch. The demo
  ClickHouse is often down (1033). In that state routing is proved but answers
  are not.
