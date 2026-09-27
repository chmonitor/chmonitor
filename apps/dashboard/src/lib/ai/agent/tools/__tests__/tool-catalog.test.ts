/**
 * The tool catalog and the real tool set must not drift.
 *
 * `catalog.ts` is a side table keyed by tool name. It is only trustworthy if
 * every tool has a row (otherwise `search_tools` silently omits a capability
 * and the model concludes it does not exist) and every row has a tool
 * (otherwise a renamed or deleted tool leaves a catalog entry advertising a
 * call that would 404).
 *
 * These run with every env gate ON so a gated tool without a catalog row is a
 * failure rather than a hole. `skills-tool-names.test.ts` is the sibling
 * anti-drift test for the other direction: backticked tool names in skill
 * prose.
 */
import { afterAll, describe, expect, test } from 'bun:test'

const originalControlToolsEnv = process.env.AGENT_ENABLE_CONTROL_TOOLS
const originalPostgresEnv = process.env.CHM_FEATURE_POSTGRES_SOURCE
const originalPeerDBAgentEnv = process.env.CHM_FEATURE_PEERDB_AGENT

// Every gate on, so the assertions below cover the gated tools too.
process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
process.env.CHM_FEATURE_PEERDB_AGENT = 'true'

afterAll(() => {
  for (const [key, value] of [
    ['AGENT_ENABLE_CONTROL_TOOLS', originalControlToolsEnv],
    ['CHM_FEATURE_POSTGRES_SOURCE', originalPostgresEnv],
    ['CHM_FEATURE_PEERDB_AGENT', originalPeerDBAgentEnv],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const { createAllTools } = await import('../index')
const {
  catalogToolNames,
  coreToolNames,
  getToolCatalogEntry,
  longTailToolNames,
  TOOL_CATALOG,
  toolCategories,
} = await import('../catalog')

const toolNames = Object.keys(createAllTools(0, true)).sort()
const catalogNames = catalogToolNames().sort()

describe('TOOL_CATALOG and createAllTools agree', () => {
  test('every registered tool has a catalog entry', () => {
    const orphans = toolNames.filter((n) => !getToolCatalogEntry(n))
    expect(orphans).toEqual([])
  })

  test('every catalog entry corresponds to a registered tool', () => {
    const ghosts = catalogNames.filter((n) => !toolNames.includes(n))
    expect(ghosts).toEqual([])
  })

  test('the catalog covers the full tool set exactly once', () => {
    expect(catalogNames).toEqual(toolNames)
    // Guards a duplicated key silently collapsing in an object literal.
    expect(new Set(catalogNames).size).toBe(catalogNames.length)
  })
})

describe('catalog entry shape', () => {
  test('every entry has a non-empty summary, category, and keywords', () => {
    const bad: string[] = []
    for (const [name, entry] of Object.entries(TOOL_CATALOG)) {
      if (!entry.summary.trim()) bad.push(`${name}: summary`)
      if (!entry.category) bad.push(`${name}: category`)
      if (!Array.isArray(entry.keywords) || entry.keywords.length === 0) {
        bad.push(`${name}: keywords`)
      }
      if (entry.name !== name) bad.push(`${name}: name mismatch`)
    }
    expect(bad).toEqual([])
  })

  test('every category is one of the declared union members', () => {
    const declared = new Set([
      'schema',
      'query',
      'health',
      'storage',
      'replication',
      'merges',
      'capacity',
      'advisor',
      'planning',
      'knowledge',
      'visualization',
      'insights',
      'reports',
      'dashboards',
      'control',
      'postgres',
      'peerdb',
      'discovery',
    ])
    for (const [name, entry] of Object.entries(TOOL_CATALOG)) {
      expect(declared.has(entry.category)).toBe(true)
      if (!declared.has(entry.category)) break
    }
    // Every tool the agent ships should be discoverable by category too.
    expect(toolCategories().length).toBeGreaterThan(1)
  })

  test('every gated tool carries the category that matches its gate', () => {
    // A tool that is env-gated must not be filed under a category the prompt
    // presents as always available.
    const gated: Record<string, string> = {
      kill_query: 'control',
      kill_mutation: 'control',
      optimize_table: 'control',
      run_postgres_select_query: 'postgres',
      get_postgres_metrics: 'postgres',
      list_postgres_slow_query_patterns: 'postgres',
      get_postgres_table_stats: 'postgres',
      get_peerdb_mirror_status: 'peerdb',
      get_peerdb_metrics: 'peerdb',
    }
    for (const [name, category] of Object.entries(gated)) {
      expect(TOOL_CATALOG[name]?.category).toBe(category)
    }
  })
})

describe('the core set', () => {
  test('is non-empty and every core name is a real tool', () => {
    const core = coreToolNames()
    expect(core.length).toBeGreaterThan(0)
    for (const name of core) {
      expect(toolNames).toContain(name)
    }
  })

  test('contains search_tools, so discovery is never itself discoverable', () => {
    expect(coreToolNames()).toContain('search_tools')
    expect(TOOL_CATALOG.search_tools?.core).toBe(true)
  })

  test('contains the query primitive and the loop/knowledge tools', () => {
    const core = new Set(coreToolNames())
    for (const name of [
      'query',
      'load_skill',
      'find_reference_query',
      'ask_user',
      'update_plan',
      'get_metrics',
      'get_disk_usage',
    ]) {
      expect(core.has(name)).toBe(true)
    }
  })

  test('excludes the env-gated and destructive tools', () => {
    const core = new Set(coreToolNames())
    for (const name of [
      'kill_query',
      'kill_mutation',
      'optimize_table',
      'run_postgres_select_query',
      'get_peerdb_mirror_status',
      'get_peerdb_metrics',
    ]) {
      expect(core.has(name)).toBe(false)
    }
  })

  test('core and long tail partition the catalog with no overlap', () => {
    const core = coreToolNames()
    const tail = longTailToolNames()
    expect(core.length + tail.length).toBe(catalogNames.length)
    expect(new Set([...core, ...tail]).size).toBe(catalogNames.length)
    for (const name of core) expect(tail).not.toContain(name)
  })
})
