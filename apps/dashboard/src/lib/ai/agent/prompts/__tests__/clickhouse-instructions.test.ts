/**
 * Coverage for the behavioral rules added to the ClickHouse agent system
 * prompt (tool-selection order, error recovery, verdict-first answer shape,
 * read-only safety). These assertions exist so the wording keeps encoding the
 * rules even as the prompt gets edited over time — see
 * `clickhouse-instructions.ts` for the composed sections.
 *
 * The prompt itself (`CLICKHOUSE_AGENT_INSTRUCTIONS`) is a single static
 * string — there is no separate cloud/OSS or Postgres "variant" of the text.
 * What varies by environment is which tools `createAllTools` exposes
 * (control tools behind `AGENT_ENABLE_CONTROL_TOOLS`, Postgres tools behind
 * `CHM_FEATURE_POSTGRES_SOURCE`). This file checks composition still holds
 * for both the default gate configuration (self-hosted/cloud, gates off —
 * 30 tools) and the fully-gated-on configuration (37 tools), mirroring
 * `tools/tool-docs-sync.test.ts`.
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

// Collapse the template literal's internal line wrapping so assertions on
// multi-sentence phrases don't break just because a paragraph gets rewrapped
// at a different width — assert on wording, not on line breaks.
const PROMPT_FLAT = CLICKHOUSE_AGENT_INSTRUCTIONS.replace(/\s+/g, ' ')

describe('ClickHouse agent system prompt — tool-selection order', () => {
  test('states the primitive > skill > raw SQL order', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'Tool-selection order: primitive > skill > raw SQL.'
    )
  })

  test('requires a schema check or primitive before hand-writing system.* SQL', () => {
    expect(PROMPT_FLAT).toContain(
      'because column names on system tables vary by ClickHouse version'
    )
    expect(PROMPT_FLAT).toContain(
      'Guessing columns and letting the query fail first is the wrong order every time.'
    )
  })

  test('calls out get_replication_status as the primitive over raw replication_queue SQL', () => {
    // This encodes the exact regression from the observed session: the agent
    // guessed system.replication_queue columns before checking schema.
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('system.replication_queue')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'Recognize `get_replication_status` already covers replication'
    )
  })
})

describe('ClickHouse agent system prompt — error recovery', () => {
  test('has one canonical error-recovery block with a bounded retry', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      '## Error Recovery (canonical — the other sections point here)'
    )
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('**Retry once**')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'If the retry also fails**, stop'
    )
  })

  test('does not instruct blind retry looping', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('do not loop blindly')
  })
})

describe('ClickHouse agent system prompt — answer shape', () => {
  test('requires verdict, then evidence, then action', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'Answer shape — verdict, evidence, action'
    )
  })

  test('bans generic process-narration filler as the opening line', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'Do not lead with process narration'
    )
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'Never write generic filler like'
    )
  })

  test('example interactions model verdict-first answers, not thin narration', () => {
    // The old examples scripted "I'll check X and inspect Y" as the answer
    // opener; the fixed examples must not reproduce that pattern.
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).not.toContain(
      "I'll check the running queries to see what's currently executing and consuming resources."
    )
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'One query (id `abc123`) has been running 8 minutes'
    )
  })

  test('the error-recovery example checks schema before writing the query', () => {
    expect(PROMPT_FLAT).toContain(
      'check first — call get_table_schema for system.query_log before writing the query'
    )
    // Must not reproduce the old "attempt query first, then check schema" order.
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).not.toContain(
      'Attempts query with `initial_query_id` column → Query fails'
    )
  })
})

describe('ClickHouse agent system prompt — read-only safety', () => {
  test('reaffirms read-only SQL and env-gated control tools', () => {
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain('Read-only, always')
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'This holds in every deployment (self-hosted or cloud).'
    )
    expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(
      'the 3 destructive control tools (`kill_query`, `optimize_table`, `kill_mutation`), which are off by default'
    )
  })
})

describe('ClickHouse agent system prompt — composition holds across tool-gate configurations', () => {
  test('every default-gate tool name (control + Postgres tools off) is named in the prompt', async () => {
    delete process.env.AGENT_ENABLE_CONTROL_TOOLS
    delete process.env.CHM_FEATURE_POSTGRES_SOURCE
    const { createAllTools } = await import('../../tools/index')
    const toolNames = Object.keys(createAllTools(0, false))
    expect(toolNames.length).toBe(30)
    for (const name of toolNames) {
      expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(`**${name}**`)
    }
  })

  test('every gated-on tool name (control + Postgres tools on) is named in the prompt', async () => {
    process.env.AGENT_ENABLE_CONTROL_TOOLS = 'true'
    process.env.CHM_FEATURE_POSTGRES_SOURCE = 'true'
    // Re-import fresh: createAllTools reads these env vars at call time, so no
    // module cache issue, but keep behavior explicit and mirror
    // tool-docs-sync.test.ts's approach.
    const { createAllTools } = await import('../../tools/index')
    const toolNames = Object.keys(createAllTools(0, true))
    expect(toolNames.length).toBe(37)
    for (const name of toolNames) {
      expect(CLICKHOUSE_AGENT_INSTRUCTIONS).toContain(`**${name}**`)
    }
  })
})
