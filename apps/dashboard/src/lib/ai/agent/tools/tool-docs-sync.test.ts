/**
 * Anti-drift test for the AI Agent tool docs.
 *
 * CLAUDE.md (root + apps/dashboard) mandates keeping the user-facing agent
 * docs in sync with lib/ai/agent/tools/* whenever a tool is added, renamed,
 * or removed. In practice the full per-tool reference lives in the child
 * page docs/content/guide/ai-agent/capabilities.mdx — the parent page
 * docs/content/guide/ai-agent.mdx only has tool *categories* plus a link to
 * that page, so checking ai-agent.mdx alone for all 21 tool names would
 * either be vacuous (it has no per-tool list) or force a duplicate list into
 * the overview page, doubling the drift surface. See
 * plans/12-ai-agent-doc-tool-sync.md for the full investigation.
 *
 * Two independent things are verified:
 *  1. Every tool createAllTools() actually exposes — including the 3
 *     env-gated control tools — is documented in capabilities.mdx.
 *  2. The MCP-server-only tool table in ai-agent.mdx (### MCP tools) still
 *     lists every tool packages/mcp-server actually registers. That is a
 *     separate implementation (not createAllTools) with mostly-overlapping
 *     but not identical coverage — e.g. `analyze_performance` is MCP-only,
 *     with no agent-tool counterpart — so it is checked independently
 *     rather than asserted as a subset of (1). It's a small list that
 *     changes rarely, so it is hardcoded here with a comment pointing at
 *     its source of truth.
 */
import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const originalControlToolsEnv = process.env.AGENT_ENABLE_CONTROL_TOOLS
const originalPostgresEnv = process.env.CHM_FEATURE_POSTGRES_SOURCE
// createAllTools reads these env vars at call time (not import time), so they
// must be set before calling it below — see tools/index.ts. Enabling both the
// control-tool and Postgres gates makes every gated tool present, so the docs
// / prompt sync assertions below cover them too.
process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'

afterAll(() => {
  if (originalControlToolsEnv === undefined) {
    delete process.env.AGENT_ENABLE_CONTROL_TOOLS
  } else {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = originalControlToolsEnv
  }
  if (originalPostgresEnv === undefined) {
    delete process.env.CHM_FEATURE_POSTGRES_SOURCE
  } else {
    process.env.CHM_FEATURE_POSTGRES_SOURCE = originalPostgresEnv
  }
})

const { createAllTools } = await import('./index')
const { CLICKHOUSE_AGENT_INSTRUCTIONS } = await import(
  '../prompts/clickhouse-instructions'
)
const toolNames = Object.keys(createAllTools(0, true))

const REPO_ROOT = join(
  (import.meta as any).dir,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  '..'
)
const CAPABILITIES_DOC = readFileSync(
  join(REPO_ROOT, 'docs/content/guide/ai-agent/capabilities.mdx'),
  'utf-8'
)
const AI_AGENT_DOC = readFileSync(
  join(REPO_ROOT, 'docs/content/guide/ai-agent.mdx'),
  'utf-8'
)

/**
 * Tools packages/mcp-server/src/tools/index.ts (registerAllTools) actually
 * registers on the live MCP server — its own read-only implementation,
 * separate from createAllTools()/toolNames above. Update this list if that
 * file's register*Tool() calls change.
 */
const MCP_SERVER_TOOL_NAMES = [
  'query',
  'list_databases',
  'list_tables',
  'get_table_schema',
  'get_metrics',
  'get_running_queries',
  'get_slow_queries',
  'get_merge_status',
  'explore_table_schema',
  'analyze_performance',
  'get_optimization_recommendations',
] as const

describe('AI agent tool docs stay in sync with the code', () => {
  test('createAllTools(0, true) exposes 27 default + 3 control + 4 Postgres tools', () => {
    // Loud guard: if this drops below 34, AGENT_ENABLE_CONTROL_TOOLS or
    // CHM_FEATURE_POSTGRES_SOURCE was not honored above and the gated-tool
    // assertions below would silently never run.
    expect(toolNames.length).toBe(34)
  })

  test('every agent tool is documented in ai-agent/capabilities.mdx', () => {
    for (const name of toolNames) {
      // Backtick-delimited match — a bare substring match would let e.g.
      // `query` pass just because it's a substring of `explain_query`.
      expect(CAPABILITIES_DOC).toContain(`\`${name}\``)
    }
  })

  test('every agent tool is named in the system prompt', () => {
    // The model can only reliably call tools the system prompt tells it about.
    // capabilities.mdx (checked above) is user-facing docs the model never sees;
    // this guards the prompt the model actually reads. Control tools are gated
    // off at runtime but still described in the prompt, so all names must appear.
    for (const name of toolNames) {
      expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(`**${name}**`)
    }
  })

  test('every registered MCP-server tool is listed in ai-agent.mdx', () => {
    for (const name of MCP_SERVER_TOOL_NAMES) {
      expect(AI_AGENT_DOC).toContain(`\`${name}\``)
    }
  })
})
