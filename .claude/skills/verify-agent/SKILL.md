---
name: verify-agent
description: >-
  Drive the chmonitor AI agent (POST /api/v1/agent) the way a user does and
  prove which tools and skills it reaches for. Use after changing an agent
  tool, TOOL_CATALOG, a skill in .agents/skills/, the system prompt, or the
  question bank (tests/agent/cases/questions.yaml); when a user says "the agent
  used the wrong tool" or "the agent does not answer"; or before trusting a
  green unit run for agent behaviour.
---

# Verify the agent

The agent's surface is one streaming HTTP endpoint, `POST /api/v1/agent`, which
the dashboard chat panel calls. The answer is an AI SDK UI-message SSE stream.
`tests/agent/parse-agent-sse.js` turns it into `[tool:name]` markers plus the
answer text. The harness here sends one question from the question bank and
compares the called tools with that question's expected tools.

Other surfaces are out of scope here. The MCP server at `/api/mcp` is covered
in `docs/knowledge/mcp-server.md`, and the chat UI is covered by the Cypress
specs. The deploy health probes and guest-model checks belong to
[verify-production](../verify-production/SKILL.md). Do not repeat them here.

## Launch

You have two targets. Pick one and keep to it for the whole run.

- **Production (no setup):**
  `export AGENT_EVAL_URL=https://dash.chmonitor.dev/api/v1/agent`.
  - Anonymous guests may call it, rate-limited per IP. That is enough for one
    to three questions.
  - It runs the deployed build, so it proves `main`, not your branch.
- **Local (your branch):** from the repo root:
  1. `pnpm install` (and `cd apps/dashboard && pnpm install`, since it has its
     own lockfile).
  2. Put `CLICKHOUSE_HOST` / `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` and
     `ANYROUTER_API_KEY` in `apps/dashboard/.env.local`.
  3. Run `cd apps/dashboard && pnpm run dev -- --port 3100 > /tmp/verify-agent-dev.log 2>&1 & echo $! > /tmp/verify-agent-dev.pid`.
  4. Ready means usable. Poll `curl -s localhost:3100/api/healthz` until it
     returns 200 with ClickHouse reachable. A 200 from `/healthz` alone only
     proves the process is up.
  5. Set `export AGENT_EVAL_URL=http://localhost:3100/api/v1/agent`.
  - Use port 3100 so you never drive a developer's own `:3000` instance.

## Doctor

Run this first, and again whenever anything looks off:

```sh
curl -s -o /dev/null -w '%{http_code}\n' "${AGENT_EVAL_URL%/api/v1/agent}/api/healthz"
```

- 200 means ClickHouse answered.
- 503 means the Worker is up but ClickHouse is not (the demo origin is often
  down, Cloudflare 1033). The agent still routes tools in that state, but every
  data tool returns `[tool-error:…1033…]`. Routing is still provable then;
  answers are not.
- For a local run, also check that `/tmp/verify-agent-dev.pid` holds a live
  PID that you started.

## Drive

Run the helper `ask-agent.ts` in this directory. It is executable and needs
only bun:

```sh
bun .claude/skills/verify-agent/ask-agent.ts "Question — disk free space"
bun .claude/skills/verify-agent/ask-agent.ts --prompt "Which replicas lag?" --expect get_replication_status,query
```

- The first form looks the case up by its exact `description` in
  `tests/agent/cases/questions.yaml`. It sends `vars.prompt` and accepts the
  tools listed in that case's `toolCalled` `config.tools`.
- An unknown name prints every case name.
- Optional env vars: `AGENT_API_TOKEN` (Bearer, for a signed-in run) and
  `AGENT_EVAL_MODEL`.
- Exit codes:
  - `0`: an accepted tool was called.
  - `1`: none was called. This is a routing regression.
  - `2`: HTTP failure.

For a whole sweep, use the promptfoo suite, not a loop over this helper:
`bun scripts/agent-eval.ts --tags tools`. The feature files in `features/`
name the cases to use per feature.

## Evidence

Every run writes these files to
`tests/agent/results/verify-agent/<UTC timestamp>/`, which is gitignored:

- `request.json`: the URL, case and body.
- `response.sse`: the raw stream.
- `parsed.txt`: the markers and the answer.
- `verdict.json`: status, accepted, called, toolErrors and pass.

Proof standards:

- Drive the real endpoint with a real model. The mocked goldens in
  `apps/dashboard/src/lib/ai/agent/__tests__/scenarios.test.ts` are unit
  tests, not proof.
- A pass means the accepted tool appears in `called`.
- A `toolErrors` entry with 1033, refused or 5xx is an infra skip: it proves
  routing but not the answer. Say so when you report.
- Any other tool error is a failure.
- A skill question proves only that `load_skill` was called. The parser does
  not record which skill was loaded, so the skill mapping is checked
  structurally by `tests/agent/question-bank.test.ts`.
- Live answers vary by model. One miss on the free model is a signal to rerun,
  not a verdict. Three misses in a row is a regression.

## Cleanup

- Local: `kill "$(cat /tmp/verify-agent-dev.pid)" && rm /tmp/verify-agent-dev.pid`.
- Never `pkill vite` or kill by name. Kill only the PID you started.
- Production: nothing to clean up.
- Never delete `tests/agent/results/verify-agent/`. It is the proof.

## Helpers

- `ask-agent.ts`: send one question and record the evidence (usage above).
- `tests/agent/question-bank.test.ts`: the offline gate. It checks that every
  tool and skill named in the cases exists, and that every core tool has a
  question. Run it with `bun test tests/agent/question-bank.test.ts`.
- `features/README.md`: the feature map. Keep it in step with the bank.

## Last proven

On 2026-10-23, against production as a guest, case `Question — disk free space`:

- Result: `called: [get_disk_usage]`, pass. The demo ClickHouse was down
  (1033), so this was an infra skip on the answer.
- The local launch path was not run in that proof, because there is no
  ClickHouse or AnyRouter key on the proving machine. The unverified steps are
  local steps 1 to 5 of Launch, plus local Cleanup.
