---
title: "Use OpenCode with AnyRouter (and ask your cluster from the TUI)"
description: "Point OpenCode at AnyRouter for models, then attach chmonitor MCP so the same session can query your cluster — one key, one bill, read-only cluster tools."
date: 2026-08-19
tag: How-to
---

This is for people who already live in [OpenCode](https://opencode.ai) and want one API key for every coding model, plus the option to ask your cluster questions without switching to a browser. By the end, OpenCode talks to [AnyRouter](https://anyrouter.dev) for inference and to chmonitor for read-only cluster tools.

## Prerequisites

- OpenCode installed (`opencode` on your `$PATH`).
- An AnyRouter account. Create a key in the [dashboard](https://dash.anyrouter.dev/keys) — inference keys start with `sk-ar-`.
- Optional: a running chmonitor instance if you want cluster tools in the same session.

## Steps

### 1. Launch OpenCode through AnyRouter

The fastest path is one command. It logs you in and injects AnyRouter for that process only — your global `opencode.json` is left alone.

```bash
npx @anyr/cli opencode
```

Pin a model, or preview the resolved config:

```bash
npx @anyr/cli opencode --model "z-ai/glm-5.2"
npx @anyr/cli opencode --dry-run
```

If you want a bare `opencode` command to use AnyRouter every time, export the key and add a custom provider to `~/.config/opencode/opencode.json`:

```bash
export ANYROUTER_API_KEY="sk-ar-your-anyrouter-key"
```

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anyrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "AnyRouter",
      "options": {
        "baseURL": "https://anyrouter.dev/api/v1",
        "apiKey": "{env:ANYROUTER_API_KEY}"
      },
      "models": {
        "anthropic/claude-sonnet-4.6": {
          "name": "Claude Sonnet 4.6",
          "limit": { "context": 200000, "output": 65536 }
        }
      }
    }
  },
  "model": "anyrouter/anthropic/claude-sonnet-4.6"
}
```

`{env:ANYROUTER_API_KEY}` is the **variable name**, not the secret. Do not paste the `sk-ar-` key into the file. OpenCode requires both `limit.context` and `limit.output` if you set `limit` at all.

This is the same AnyRouter gateway the chmonitor dashboard agent uses (`ANYROUTER_API_KEY`). Flags and troubleshooting live in AnyRouter's [OpenCode guide](https://anyrouter.dev/docs/guides/opencode).

### 2. Add AnyRouter MCP (optional)

Inference and tools are independent. To let OpenCode call `get_credits` / `list_models` without opening a browser, add the remote MCP server to the same `opencode.json`:

```json
{
  "mcp": {
    "anyrouter": {
      "type": "remote",
      "url": "https://anyrouter.dev/api/v1/mcp",
      "enabled": true
    }
  }
}
```

Restart OpenCode. The next tool call opens the AnyRouter OAuth consent page — Read-only is the default.

### 3. Attach chmonitor MCP (optional)

Same `mcp` object, second server. OpenCode then gets the same read-only cluster tools as Claude Desktop or Cursor: slow queries, replication, merges, schema.

```json
{
  "mcp": {
    "chmonitor": {
      "type": "remote",
      "url": "https://your-chmonitor-host/api/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:CHM_API_KEY}"
      }
    }
  }
}
```

`oauth: false` skips OpenCode's OAuth flow — chmonitor uses a bearer `chm_` token. Omit `headers` for an unauthenticated local instance. Issue tokens from [API keys](https://docs.chmonitor.dev/operate/authentication/api-keys).

A combined file (provider + both MCP servers) is in the [docs guide](https://docs.chmonitor.dev/guide/guides/anyrouter-opencode).

## Verifying it worked

1. Send any prompt in OpenCode, then open [AnyRouter request logs](https://dash.anyrouter.dev/logs). A new row with the model, tokens, and cost means inference routed through AnyRouter.
2. Ask "how many AnyRouter credits do I have left?" — the agent should call `get_credits`.
3. If chmonitor MCP is connected, ask "what's my slowest query in the last hour?" The answer should cite real `query_id`s from your cluster.

## Related

- Docs: [Use OpenCode with AnyRouter](https://docs.chmonitor.dev/guide/guides/anyrouter-opencode) — combined `opencode.json`, troubleshooting, example prompts.
- Docs: [MCP client setup](https://docs.chmonitor.dev/reference/mcp-clients) — OpenCode tab plus Claude Desktop, Claude Code, and Cursor.
- Docs: [AI agent configuration](https://docs.chmonitor.dev/guide/ai-agent/configuration) — `ANYROUTER_API_KEY` on the dashboard agent.
- AnyRouter: [OpenCode guide](https://anyrouter.dev/docs/guides/opencode) · [MCP with OpenCode](https://anyrouter.dev/docs/mcp/opencode) · [scenario](https://anyrouter.dev/docs/scenario-examples/run-opencode-on-anyrouter).

<!--
CLAIM-VERIFICATION CHECKLIST
- [x] AnyRouter CLI command `npx @anyr/cli opencode`, base URL https://anyrouter.dev/api/v1, key prefix sk-ar-, {env:ANYROUTER_API_KEY}, limit.context+output requirement, and MCP URL https://anyrouter.dev/api/v1/mcp checked against anyrouter.dev/docs/guides/opencode.md, /docs/cli/opencode.md, /docs/mcp/opencode.md (fetched 2026-08-19).
- [x] OpenCode remote MCP shape (type remote, oauth false, headers Authorization Bearer {env:...}) checked against opencode.ai/docs/mcp-servers/.
- [x] chmonitor MCP endpoint /api/mcp, chm_ bearer tokens, and tool names (get_slow_queries, get_replication_status, get_optimization_recommendations) checked against docs/content/reference/mcp-clients.mdx and docs/content/guide/ai-agent.mdx.
- [x] Feature is merged to main (MCP server + ANYROUTER_API_KEY). OpenCode is a client of those shipped surfaces, not a new runtime feature.
- [x] Docs cross-link is bidirectional (this post ↔ /guide/guides/anyrouter-opencode).
- [x] No Cloud-only claim — MCP and AnyRouter keys work on self-hosted and Cloud.
-->
