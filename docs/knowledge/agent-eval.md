---
id: agent-eval
title: Live agent eval (promptfoo)
type: spec
status: active
updated: 2026-08-18
related:
  - ai-insights
  - agentstate-conversation-store
  - conventions
tags:
  - ai-agent
  - promptfoo
  - anyrouter
  - eval
---

# Live agent eval (promptfoo)

Behavioral tests for the ClickHouse agent against a **real** `/api/v1/agent`
and a **real** AnyRouter key. Mocked goldens in
`apps/dashboard/src/lib/ai/agent/__tests__/scenarios.test.ts` stay in unit CI;
this suite measures live tool-first + recommend-only behavior.

## Layout

| Path | Role |
|---|---|
| `tests/agent/promptfooconfig.yaml` | HTTP provider + AnyRouter grader |
| `tests/agent/cases/*.yaml` | Goldens, tagged `core` / `safety` / `tools` / `quality` / `extended` |
| `tests/agent/parse-agent-sse.js` | SSE → `[tool:…]` + answer text |
| `scripts/agent-eval.ts` | Expand env, run promptfoo |
| `scripts/agent-eval-improve.ts` | Eval, then AnyRouter notes (no prompt rewrite) |
| `scripts/agent-eval-comment.ts` | Format + upsert a sticky PR comment |
| `.github/workflows/agent-eval.yml` | PR path filter → public agent + comment results |

## Env (no secrets in git)

- `ANYROUTER_API_KEY` — rubric + local agent
- `AGENT_API_TOKEN` — Bearer for the agent route
- `AGENT_EVAL_URL` — default `http://localhost:3000/api/v1/agent`
- `AGENT_EVAL_MODEL` — default `anyrouter:meituan/longcat-2.0`
- `AGENT_EVAL_GRADER_MODEL` — default `meituan/longcat-2.0`
- `ANYROUTER_API_BASE` — default `https://anyrouter.dev/api/v1`
- `PROMPTFOO_API_KEY` — optional Promptfoo Cloud token (`promptfoo auth login`);
  when set, `agent-eval` adds `--share` and links the report

CI uses repo secrets `ANYROUTER_API_KEY` and `AGENT_API_TOKEN`. Forks without
secrets skip the live job but still post a skip comment on the PR. Live
results are upserted onto one sticky comment (`<!-- agent-eval-comment -->`).

## When to add a case

Any change to `clickhouse-instructions.ts`, tool-first rules, or a skill that
changes what the model should call. Prefer a `core`/`safety` tag if it should
run on every prompt PR.
