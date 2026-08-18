/**
 * Behavioral coverage for the ClickHouse agent system prompt.
 * Assert operating rules, not leftover slogans.
 */
import { afterAll, describe, expect, test } from 'bun:test'

const originalControlToolsEnv = process.env.AGENT_ENABLE_CONTROL_TOOLS
const originalPostgresEnv = process.env.CHM_FEATURE_POSTGRES_SOURCE

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

const { CLICKHOUSE_AGENT_INSTRUCTIONS } = await import(
  '../clickhouse-instructions'
)

const PROMPT_FLAT = CLICKHOUSE_AGENT_INSTRUCTIONS.replace(/\s+/g, ' ')

describe('ClickHouse agent system prompt — behavior', () => {
  test('is tool-first and rejects sycophancy', () => {
    expect(PROMPT_FLAT).toContain('Tool-first')
    expect(PROMPT_FLAT).toContain(
      "If the user's premise is wrong, say so and cite the tool result"
    )
    expect(PROMPT_FLAT).toContain('If you did not query it, do not assert it')
  })

  test('is recommend-only and never claims destructive work', () => {
    expect(PROMPT_FLAT).toContain('Recommend only')
    expect(PROMPT_FLAT).toContain(
      "Never claim you KILL / OPTIMIZE / ALTER'd anything"
    )
    expect(PROMPT_FLAT).toContain('Read-only')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('kill_query')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('optimize_table')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('kill_mutation')
  })

  test('states primitive → skill → query order', () => {
    expect(PROMPT_FLAT).toContain(
      'Dedicated primitive → `load_skill` for column-accurate recipes → `query` only after schema or a skill'
    )
  })

  test('error recovery retries once then stops', () => {
    expect(PROMPT_FLAT).toContain('retry **once**')
    expect(PROMPT_FLAT).toContain('Do not loop blindly')
    expect(PROMPT_FLAT).toContain('The loop stops after 16 steps')
  })

  test('verdict first and no process-narration examples', () => {
    expect(PROMPT_FLAT).toContain('Verdict first')
    expect(PROMPT_FLAT).toContain('do not stop on a tool card alone')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).not.toMatch(/I'll check/i)
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'One query (id `abc123`) has been running 8 minutes'
    )
  })

  test('hostId is numeric; update_plan is optional for long work', () => {
    expect(PROMPT_FLAT).toContain('hostId** is a numeric 0-based index')
    expect(PROMPT_FLAT).toContain(
      'only for 3+ step investigations — do not call every turn'
    )
  })

  test('prefers get_replication_status over guessed replication_queue SQL', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('system.replication_queue')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('get_replication_status')
  })
})

describe('ClickHouse agent system prompt — every tool is named', () => {
  test('every default-gate tool name appears in the prompt', async () => {
    delete process.env.AGENT_ENABLE_CONTROL_TOOLS
    delete process.env.CHM_FEATURE_POSTGRES_SOURCE
    const { createAllTools } = await import('../../tools/index')
    const toolNames = Object.keys(createAllTools(0, false))
    expect(toolNames.length).toBe(30)
    for (const name of toolNames) {
      expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(name)
    }
  })

  test('every gated-on tool name appears in the prompt', async () => {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
    const { createAllTools } = await import('../../tools/index')
    const toolNames = Object.keys(createAllTools(0, true))
    expect(toolNames.length).toBe(37)
    for (const name of toolNames) {
      expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(name)
    }
  })
})
