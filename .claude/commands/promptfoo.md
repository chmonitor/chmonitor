Run promptfoo live agent tests (AnyRouter rubric).

Starts nothing by default — point `AGENT_EVAL_URL` at a running dashboard
(`http://localhost:3000/api/v1/agent` or `https://dash.chmonitor.dev/api/v1/agent`).

Usage: /test-agent-e2e [filter pattern]

1. Require `ANYROUTER_API_KEY` and `AGENT_API_TOKEN` in the environment (never commit them).
2. Default URL is `http://localhost:3000/api/v1/agent`. If `/api/healthz` is down, start `pnpm run dev` and wait.
3. Run `bun scripts/agent-eval.ts --tags core,safety` (add `--filter-pattern "$ARGUMENTS"` when given).
4. Report the pass/fail table. `bun scripts/agent-eval-improve.ts --skip-eval` writes AnyRouter notes to `tests/agent/results/improve.md` without editing prompts.
5. Kill a dev server only if this command started it.
