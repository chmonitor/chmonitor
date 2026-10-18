import { toErrorResult, toJsonResult, toStructuredContent } from '../helpers'
import { describe, expect, it } from 'bun:test'

/** Successes carry both `content` text and `structuredContent`; errors text only. */
describe('toStructuredContent', () => {
  it('passes a plain object through unchanged', () => {
    const data = { rows: 2, truncated: false }
    expect(toStructuredContent(data)).toEqual(data)
  })

  it('wraps arrays under `data` (structuredContent must be an object)', () => {
    expect(toStructuredContent([{ name: 'events' }])).toEqual({
      data: [{ name: 'events' }],
    })
  })

  it('wraps scalars and null under `data`', () => {
    expect(toStructuredContent(42)).toEqual({ data: 42 })
    expect(toStructuredContent(null)).toEqual({ data: null })
    expect(toStructuredContent(undefined)).toEqual({ data: null })
  })
})

describe('toJsonResult', () => {
  it('emits text content and structuredContent for the same payload', () => {
    const rows = [{ database: 'default', name: 'events' }]
    const result = toJsonResult(rows)

    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify(rows, null, 2) },
    ])
    expect(result.structuredContent).toEqual({ data: rows })
    expect(result.isError).toBeUndefined()
  })
})

describe('toErrorResult', () => {
  it('stays text-only and flagged as an error', () => {
    const result = toErrorResult('Error: boom')
    expect(result.isError).toBe(true)
    expect(result.structuredContent).toBeUndefined()
  })
})
