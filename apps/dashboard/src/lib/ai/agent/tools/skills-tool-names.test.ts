/**
 * Agent skills must not name tools that createAllTools does not expose.
 * Scans bundled registry content (the text load_skill actually returns).
 */
import { afterAll, describe, expect, test } from 'bun:test'

const originalControlToolsEnv = process.env.AGENT_ENABLE_CONTROL_TOOLS
const originalPostgresEnv = process.env.CHM_FEATURE_POSTGRES_SOURCE

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
const { SKILLS } = await import('../skills/registry')

// Verb-like tool names only. `query_*` columns (query_id, query_log) are not
// tools; `query` itself is added to the allowlist separately.
const TOOL_LIKE =
  /`(get_[a-z0-9_]+|list_[a-z0-9_]+|forecast_[a-z0-9_]+|suggest_[a-z0-9_]+|estimate_[a-z0-9_]+|explain_[a-z0-9_]+|recommend_[a-z0-9_]+|generate_[a-z0-9_]+|explore_[a-z0-9_]+|update_[a-z0-9_]+|find_[a-z0-9_]+|ask_[a-z0-9_]+|run_[a-z0-9_]+|kill_[a-z0-9_]+|optimize_[a-z0-9_]+|load_skill|check_[a-z0-9_]+|analyze_[a-z0-9_]+)`/g

describe('agent skills do not name ghost tools', () => {
  test('every tool-like backtick in registry skills is a real tool', () => {
    const allowed = new Set([
      ...Object.keys(createAllTools(0, true)),
      'query',
      'load_skill',
    ])

    const ghosts: string[] = []
    for (const skill of SKILLS) {
      const text = `${skill.description}\n${skill.content}`
      for (const match of text.matchAll(TOOL_LIKE)) {
        const name = match[1]
        if (!allowed.has(name)) {
          ghosts.push(`${skill.name}: ${name}`)
        }
      }
    }

    expect(ghosts).toEqual([])
  })
})
