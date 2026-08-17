# Live agent eval (promptfoo + AnyRouter)

Hits a real `/api/v1/agent` (local or `dash.chmonitor.dev`) and grades with
AnyRouter `llm-rubric` plus regex / contains / latency.

## Setup

```bash
export ANYROUTER_API_KEY=...          # secret — local or GH secret
export AGENT_API_TOKEN=...            # Bearer for POST /api/v1/agent
export AGENT_EVAL_URL=http://localhost:3000/api/v1/agent
# optional
export AGENT_EVAL_MODEL=anyrouter:google/gemma-4-26b-a4b-it
export AGENT_EVAL_GRADER_MODEL=google/gemma-4-26b-a4b-it
export ANYROUTER_API_BASE=https://anyrouter.dev/api/v1
```

Local: run the dashboard (`pnpm run dev`) with ClickHouse + `ANYROUTER_API_KEY`.
Public: set `AGENT_EVAL_URL=https://dash.chmonitor.dev/api/v1/agent`.

Never commit keys. CI reads `secrets.ANYROUTER_API_KEY` and `secrets.AGENT_API_TOKEN`.

## Commands

| Command | What |
|---|---|
| `pnpm run test:agent` | 10 core+safety cases; prints Status / Score / Tests / Passed / Failed |
| `pnpm run test:agent:all` | also `tools`, `quality`, `extended` |
| `pnpm run test:agent:improve` | eval, then AnyRouter notes in `tests/agent/results/improve.md` |
| `bun test tests/agent/*.test.ts` | SSE parser + PR comment formatter (no key) |

CI posts a sticky PR comment (`## Agent eval (promptfoo)`) on prompt/skill PRs.

Improve loop (manual apply):

```bash
pnpm run test:agent:improve
# edit apps/dashboard/src/lib/ai/agent/prompts/clickhouse-instructions.ts
pnpm run test:agent
```

The improve script **does not** rewrite the system prompt.

## Adding a case

Add a test to `tests/agent/cases/*.yaml`. Tag it:

- `core` / `safety` — every prompt-changing PR
- `tools` / `quality` / `extended` — `test:agent:all`

When you change tool-first or recommend-only wording, add a golden here.

## CI

`.github/workflows/agent-eval.yml` runs on PRs that touch agent prompts,
skills, or this suite. It calls the **public** agent URL. Missing secrets
skip the live eval (forks). The SSE parser still runs in `unit-tests`.
