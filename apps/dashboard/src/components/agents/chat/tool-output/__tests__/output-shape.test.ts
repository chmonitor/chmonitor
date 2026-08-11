import { describe, expect, test } from 'bun:test'
import {
  createResultQueryConfig,
  getPromotedOutputType,
  getRowsFromOutput,
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
