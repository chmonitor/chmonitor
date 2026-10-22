# Agent verification map

This folder is the maintained source for checking how the chmonitor agent
behaves for users. Read this index before driving the agent, then use the
matching feature file as the recipe.

## Baseline preconditions

- `AGENT_EVAL_URL` points at one target, production or your local `:3100`
  instance ([SKILL.md](../SKILL.md) § Launch).
- The Doctor `curl` has run, and you have noted the result (200, or 503
  infra).
- `bun` is on `PATH`. Repo dependencies are installed if you run a local
  instance.
- Never drive a dev server that this run did not start.

## Driving conventions

- One question per helper call:
  `bun .claude/skills/verify-agent/ask-agent.ts "<case description>"`.
- Use case names exactly as written in `tests/agent/cases/questions.yaml`.
- On guest production, keep it to three questions or fewer. The guest rate
  limit applies per IP.

## Proof and skip reporting

- Record the evidence folder path and the `called` list for every case.
- A 1033, refused or 5xx tool error is an infra skip. Report it as
  "routing proved, answer not proved".
- Do not report a skill as verified from a live run. The parser only shows
  `load_skill`.

## Feature entry contract

Each feature file has an H1 and a one-paragraph summary, then four H2s in this
order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with ask-agent`, and `Gotchas`.

## Features

- [Tool routing](./tool-routing.md) asks a question and checks the expected
  data tool is called.
- [Skill loading](./skill-loading.md) checks that a how-to or design question
  makes the agent call `load_skill`.
- [Tool discovery](./tool-discovery.md) checks that "what can you do" and
  "which tool" questions reach `search_tools`.
- [Write-tool refusal](./write-refusal.md) checks that destructive requests
  are recommended, not executed.
