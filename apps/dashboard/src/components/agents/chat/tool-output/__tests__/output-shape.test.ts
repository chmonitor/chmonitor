import { describe, expect, test } from 'bun:test'
import {
  createResultQueryConfig,
  getPromotedOutputType,
  getRowsFromOutput,
  getToolFamily,
  isLongToolInputValue,
  summarizeToolError,
  summarizeToolInput,
  summarizeToolOutput,
  toolInputCodeLanguage,
} from '@/components/agents/chat/tool-output/output-shape'

describe('getRowsFromOutput', () => {
  test('returns the array itself when output is a rows array', () => {
    const output = [{ a: 1 }, { a: 2 }]
    expect(getRowsFromOutput(output)).toEqual(output)
  })

  test('unwraps a single object with a `rows` array', () => {
    const rows = [{ a: 1 }]
    expect(getRowsFromOutput({ rows })).toEqual(rows)
  })

  test('returns an empty array for empty output', () => {
    expect(getRowsFromOutput([])).toEqual([])
    expect(getRowsFromOutput(null)).toEqual([])
    expect(getRowsFromOutput(undefined)).toEqual([])
    expect(getRowsFromOutput({})).toEqual([])
  })

  test('returns an empty array for a malformed payload', () => {
    expect(getRowsFromOutput('a plain string')).toEqual([])
    expect(getRowsFromOutput(42)).toEqual([])
    expect(getRowsFromOutput([1, 2, 3])).toEqual([])
    expect(getRowsFromOutput({ rows: 'not-an-array' })).toEqual([])
  })
})

describe('getPromotedOutputType', () => {
  test('detects each promoted output shape', () => {
    expect(
      getPromotedOutputType({ type: 'query_insights', highlights: [] })
    ).toBe('query_insights')
    expect(getPromotedOutputType({ type: 'visualization', rows: [] })).toBe(
      'visualization'
    )
    expect(getPromotedOutputType({ type: 'workflow_plan', steps: [] })).toBe(
      'workflow_plan'
    )
  })

  test('returns null when the shape does not match', () => {
    expect(getPromotedOutputType({ type: 'visualization' })).toBeNull()
    expect(getPromotedOutputType(null)).toBeNull()
    expect(getPromotedOutputType('text')).toBeNull()
    expect(getPromotedOutputType([1, 2, 3])).toBeNull()
  })
})

describe('createResultQueryConfig', () => {
  test('builds a static query config carrying the given columns', () => {
    const config = createResultQueryConfig(['a', 'b'])
    expect(config.columns).toEqual(['a', 'b'])
    expect(config.name).toBe('agent-query-result')
  })
})

describe('summarizeToolInput', () => {
  test('returns null for missing or non-object input', () => {
    expect(summarizeToolInput(undefined)).toBeNull()
    expect(summarizeToolInput(null)).toBeNull()
    expect(summarizeToolInput('sql')).toBeNull()
    expect(summarizeToolInput({})).toBeNull()
  })

  test('summarizes a single scalar param as key=value', () => {
    expect(summarizeToolInput({ tableName: 'events' })).toBe('tableName=events')
  })

  test('summarizes a long primary sql/query param alone, truncated', () => {
    const longSql = `SELECT ${'col, '.repeat(30)}1`
    const summary = summarizeToolInput({
      sql: longSql,
      hostId: 0,
    })
    expect(summary).not.toBeNull()
    expect(summary?.length).toBeLessThanOrEqual(60)
    expect(summary?.endsWith('…')).toBe(true)
    // Never dumps the second param when a primary text param wins.
    expect(summary).not.toContain('hostId')
  })

  test('collapses newlines/whitespace to a single line', () => {
    const summary = summarizeToolInput({ sql: 'SELECT 1\n  FROM  system.one' })
    expect(summary).toBe('SELECT 1 FROM system.one')
  })

  test('joins short non-primary params as key=value pairs', () => {
    expect(
      summarizeToolInput({ database: 'default', tableName: 'events' })
    ).toBe('database=default, tableName=events')
  })

  test('falls back to a parameter count when even the joined form does not fit', () => {
    const summary = summarizeToolInput({
      database: 'a'.repeat(70),
      tableName: 'events',
    })
    expect(summary).toBe('2 parameters')
  })
})

describe('isLongToolInputValue / toolInputCodeLanguage', () => {
  test('flags long or multiline strings, not short scalars', () => {
    expect(isLongToolInputValue('short')).toBe(false)
    expect(isLongToolInputValue('a'.repeat(61))).toBe(true)
    expect(isLongToolInputValue('line1\nline2')).toBe(true)
    expect(isLongToolInputValue(42)).toBe(false)
  })

  test('picks sql language for sql/query-named params, text otherwise', () => {
    expect(toolInputCodeLanguage('sql')).toBe('sql')
    expect(toolInputCodeLanguage('query')).toBe('sql')
    expect(toolInputCodeLanguage('prompt')).toBe('text')
  })
})

describe('summarizeToolError', () => {
  test('defaults to a generic message when errorText is empty', () => {
    expect(summarizeToolError(undefined)).toEqual({
      message: 'An error occurred.',
      detail: null,
    })
    expect(summarizeToolError('')).toEqual({
      message: 'An error occurred.',
      detail: null,
    })
  })

  test('extracts the `error` field from a JSON-stringified error object', () => {
    const errorText = JSON.stringify({ error: 'An error occurred.' })
    expect(summarizeToolError(errorText)).toEqual({
      message: 'An error occurred.',
      detail: null,
    })
  })

  test('extracts the `message` field and keeps extra fields as detail', () => {
    const errorText = JSON.stringify({
      message: 'Table not found',
      code: 'TABLE_NOT_FOUND',
    })
    const result = summarizeToolError(errorText)
    expect(result.message).toBe('Table not found')
    expect(result.detail).toContain('TABLE_NOT_FOUND')
  })

  test('falls back to a generic message + full JSON detail when unreadable', () => {
    const errorText = JSON.stringify({ code: 500, retryable: false })
    const result = summarizeToolError(errorText)
    expect(result.message).toBe('Tool call failed.')
    expect(result.detail).toContain('"code": 500')
  })

  test('passes plain-text errorText through unchanged', () => {
    expect(summarizeToolError('Connection timed out')).toEqual({
      message: 'Connection timed out',
      detail: null,
    })
  })
})

describe('getToolFamily', () => {
  test('maps well-known tool names onto presentational families', () => {
    expect(getToolFamily('query')).toBe('query')
    expect(getToolFamily('get_table_schema')).toBe('schema')
    expect(getToolFamily('get_metrics')).toBe('health')
    expect(getToolFamily('get_disk_usage')).toBe('disk')
    expect(getToolFamily('get_replication_status')).toBe('replication')
    expect(getToolFamily('get_merge_status')).toBe('merge')
    expect(getToolFamily('load_skill')).toBe('skill')
    expect(getToolFamily('update_plan')).toBe('plan')
    expect(getToolFamily('query_and_visualize')).toBe('visualize')
    expect(getToolFamily('ask_user')).toBe('ask_user')
    expect(getToolFamily('unknown_widget')).toBe('generic')
  })
})

describe('summarizeToolOutput', () => {
  test('summarizes a rows array by count', () => {
    expect(summarizeToolOutput([{ a: 1 }, { a: 2 }])).toBe('2 rows')
    expect(summarizeToolOutput({ rows: [{ a: 1 }] })).toBe('1 row')
  })

  test('prefers a table name or lag scalar over dumping the payload', () => {
    expect(summarizeToolOutput({ tableName: 'events' })).toBe('events')
    expect(summarizeToolOutput({ absolute_delay: 12 })).toBe('lag 12s')
  })

  test('returns null for empty or unreadable output', () => {
    expect(summarizeToolOutput(null)).toBeNull()
    expect(summarizeToolOutput({})).toBeNull()
  })
})
