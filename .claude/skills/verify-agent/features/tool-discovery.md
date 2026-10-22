# Tool discovery

A user asks what the agent can do, or whether a tool exists for a task. The
agent answers from `search_tools`, which only lists tools callable in this
conversation, instead of inventing capabilities.

## Sub-features

- `discover-core`: "what can you do" returns the core tool set.
- `discover-query`: "is there a tool for X" returns the matching long-tail
  tool.

## How to get to it (user POV)

- Ask the agent panel about its capabilities.

## Driving it with ask-agent

Preconditions:

- The Doctor check has run. These questions do not need ClickHouse.

Steps:

- **Capabilities.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — discover tools"`.
  `called` should contain `search_tools`.
- **Which tool.** Run `bun .claude/skills/verify-agent/ask-agent.ts "Question — which tool for skip indexes"`.
  `called` should contain `search_tools` or `get_optimization_recommendations`.

## Gotchas

- Many models answer "what can you do" straight from the system prompt's
  `TOOL_LIST` without calling a tool. A miss here is weaker evidence than a
  miss on a data question.
- `search_tools` still lists a tool that the request removed through
  `disabledTools`. That is a known finding, see
  [verify-agent-tool-gates](../../verify-agent-tool-gates/SKILL.md).
