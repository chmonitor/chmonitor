# Skill loading

A user asks a how-to, design, or incident question. The agent loads the
matching built-in skill (from `.agents/skills/`, compiled into the skills
registry) with `load_skill` before answering.

## Sub-features

- `skill-design` covers schema design questions, which should load
  `schema-design-advisor`.
- `skill-incident` covers production-on-fire triage, which should load
  `incident-response`.
- `skill-replication` covers replica recovery questions, which should load
  `replication-guide`.

## How to get to it (user POV)

- Ask the agent panel a how-to question that no single data tool answers.

## Driving it with ask-agent

Preconditions:

- The Doctor check has run.

Steps:

- **Design question.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — schema design skill"`.
  `called` should contain `load_skill`.
- **Incident question.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — incident skill"`.
  `called` should contain `load_skill` or one of the triage tools listed in
  the case.

## Gotchas

- The SSE parser emits `[tool:load_skill]` without the skill name. A live
  pass proves that a skill was loaded, not which one. To see the name, read
  `response.sse` and search for the `load_skill` input (`"name":"…"`).
- Skill names must exist in `apps/dashboard/src/lib/ai/agent/skills/registry.ts`.
  `tests/agent/question-bank.test.ts` enforces this offline.
