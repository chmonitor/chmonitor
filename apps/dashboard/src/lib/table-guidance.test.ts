import {
  getGuidanceForMissingTables,
  getTableGuidance,
  TABLE_GUIDANCE,
  type TableGuidance,
} from './table-guidance'
import { describe, expect, it } from 'bun:test'

describe('TABLE_GUIDANCE', () => {
  it('is a non-empty record', () => {
    expect(typeof TABLE_GUIDANCE).toBe('object')
    expect(Object.keys(TABLE_GUIDANCE).length).toBeGreaterThan(0)
  })

  it('contains known system tables', () => {
    const expected = [
      'system.query_thread_log',
      'system.session_log',
      'system.processors_profile_log',
      'system.error_log',
      'system.zookeeper',
      'system.zookeeper_info',
      'system.zookeeper_connection',
      'system.zookeeper_connection_log',
      'system.zookeeper_log',
      'system.zookeeper_watches',
      'system.backup_log',
      'system.text_log',
      'system.crash_log',
      'system.monitoring_events',
      'system.opentelemetry_span_log',
      'system.query_views_log',
      'system.metric_log',
      'system.asynchronous_metric_log',
      'system.trace_log',
      'system.part_log',
    ]
    for (const table of expected) {
      expect(Object.hasOwn(TABLE_GUIDANCE, table)).toBe(true)
    }
  })

  it('each entry has enableInstructions (non-empty string)', () => {
    for (const [_table, guidance] of Object.entries(TABLE_GUIDANCE)) {
      expect(typeof guidance.enableInstructions).toBe('string')
      expect(guidance.enableInstructions.length).toBeGreaterThan(0)
    }
  })

  it('optional docsUrl fields are strings when present', () => {
    for (const [, guidance] of Object.entries(TABLE_GUIDANCE)) {
      if (guidance.docsUrl !== undefined) {
        expect(typeof guidance.docsUrl).toBe('string')
        expect(guidance.docsUrl.startsWith('https://')).toBe(true)
      }
    }
  })

  it('optional description fields are strings when present', () => {
    for (const [, guidance] of Object.entries(TABLE_GUIDANCE)) {
      if (guidance.description !== undefined) {
        expect(typeof guidance.description).toBe('string')
        expect(guidance.description.length).toBeGreaterThan(0)
      }
    }
  })

  it('system.monitoring_events is registered (EVENTS_TABLE default)', () => {
    expect(TABLE_GUIDANCE['system.monitoring_events']).toBeDefined()
    // Guidance must name the app-owned table and how it's created, so operators
    // understand Page Views is self-analytics they can enable (not a cluster table).
    const { enableInstructions } = TABLE_GUIDANCE['system.monitoring_events']
    expect(enableInstructions).toContain('monitoring_events')
    expect(enableInstructions).toContain('/api/init')
  })

  it('system.zookeeper has a docsUrl', () => {
    expect(TABLE_GUIDANCE['system.zookeeper'].docsUrl).toBeDefined()
    expect(TABLE_GUIDANCE['system.zookeeper'].docsUrl).toContain(
      'clickhouse.com'
    )
  })

  it('system.metric_log enableInstructions includes XML config snippet', () => {
    const g = TABLE_GUIDANCE['system.metric_log']
    expect(g.enableInstructions).toContain('<metric_log>')
    expect(g.enableInstructions).toContain('restart your ClickHouse server')
  })

  it('system.part_log enableInstructions includes XML config snippet', () => {
    const g = TABLE_GUIDANCE['system.part_log']
    expect(g.enableInstructions).toContain('<part_log>')
    expect(g.enableInstructions).toContain('restart your ClickHouse server')
  })
})

describe('getTableGuidance', () => {
  it('returns guidance for a known table', () => {
    const result = getTableGuidance('system.error_log')
    expect(result).toBeDefined()
    expect(result?.enableInstructions).toContain('error_log')
  })

  it('returns undefined for an unknown table', () => {
    expect(getTableGuidance('system.nonexistent_table')).toBeUndefined()
  })

  it('returns undefined for an empty string', () => {
    expect(getTableGuidance('')).toBeUndefined()
  })

  it('is case-sensitive — wrong case returns undefined', () => {
    expect(getTableGuidance('System.Error_Log')).toBeUndefined()
    expect(getTableGuidance('SYSTEM.ERROR_LOG')).toBeUndefined()
  })

  it('returns undefined for a partial table name without schema prefix', () => {
    expect(getTableGuidance('error_log')).toBeUndefined()
    expect(getTableGuidance('zookeeper')).toBeUndefined()
  })

  it('returns guidance for system.monitoring_events (EVENTS_TABLE)', () => {
    const result = getTableGuidance('system.monitoring_events')
    expect(result).toBeDefined()
    expect(result?.description).toBe("chmonitor's own usage-analytics table")
  })

  it('returns guidance for system.backup_log', () => {
    const result = getTableGuidance('system.backup_log')
    expect(result).toBeDefined()
    expect(result?.enableInstructions).toContain('BACKUP')
    expect(result?.docsUrl).toContain('clickhouse.com')
  })

  it('returns guidance for system.crash_log', () => {
    const result = getTableGuidance('system.crash_log')
    expect(result).toBeDefined()
    expect(result?.enableInstructions).toContain('crash')
  })

  it('returns guidance for system.text_log with XML snippet', () => {
    const result = getTableGuidance('system.text_log')
    expect(result).toBeDefined()
    expect(result?.enableInstructions).toContain('<text_log>')
  })

  it('returns correct docsUrl for system.query_thread_log', () => {
    const result = getTableGuidance('system.query_thread_log')
    expect(result?.docsUrl).toBe(
      'https://clickhouse.com/docs/en/operations/system-tables/query_thread_log'
    )
  })

  it('result conforms to TableGuidance interface', () => {
    const result = getTableGuidance('system.session_log') as TableGuidance
    expect(typeof result.enableInstructions).toBe('string')
    // docsUrl and description are optional — just check they are string or undefined
    expect(
      result.docsUrl === undefined || typeof result.docsUrl === 'string'
    ).toBe(true)
    expect(
      result.description === undefined || typeof result.description === 'string'
    ).toBe(true)
  })
})

describe('getGuidanceForMissingTables', () => {
  it('returns undefined for an empty array', () => {
    expect(getGuidanceForMissingTables([])).toBeUndefined()
  })

  it('returns undefined when no tables are recognized', () => {
    expect(
      getGuidanceForMissingTables(['foo.bar', 'baz.qux', 'nonexistent'])
    ).toBeUndefined()
  })

  it('returns guidance for a single recognized table', () => {
    const result = getGuidanceForMissingTables(['system.error_log'])
    expect(result).toBeDefined()
    expect(result?.enableInstructions).toContain('error_log')
  })

  it('returns the FIRST recognized table guidance when multiple are present', () => {
    const result = getGuidanceForMissingTables([
      'system.error_log',
      'system.session_log',
    ])
    // Must match the first one, not the second
    const direct = getTableGuidance('system.error_log')
    expect(result).toBe(direct)
  })

  it('skips unrecognized tables and returns the first recognized one', () => {
    const result = getGuidanceForMissingTables([
      'system.unknown_table',
      'system.zookeeper',
      'system.session_log',
    ])
    const direct = getTableGuidance('system.zookeeper')
    expect(result).toBe(direct)
  })

  it('returns undefined when all entries are unrecognized (mixed garbage)', () => {
    expect(
      getGuidanceForMissingTables(['', 'foo', 'System.Error_Log'])
    ).toBeUndefined()
  })

  it('works with a readonly tuple', () => {
    const tables = ['system.backup_log'] as const
    const result = getGuidanceForMissingTables(tables)
    expect(result).toBeDefined()
    expect(result?.enableInstructions).toContain('BACKUP')
  })

  it('returns the same object reference as getTableGuidance', () => {
    const tables = ['system.metric_log']
    const fromFn = getGuidanceForMissingTables(tables)
    const direct = getTableGuidance('system.metric_log')
    expect(fromFn).toBe(direct)
  })

  it('order of array determines which guidance is returned', () => {
    const resultAFirst = getGuidanceForMissingTables([
      'system.part_log',
      'system.trace_log',
    ])
    const resultBFirst = getGuidanceForMissingTables([
      'system.trace_log',
      'system.part_log',
    ])
    expect(resultAFirst).toBe(getTableGuidance('system.part_log'))
    expect(resultBFirst).toBe(getTableGuidance('system.trace_log'))
    expect(resultAFirst).not.toBe(resultBFirst)
  })
})
