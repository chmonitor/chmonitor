/**
 * Tests for clickhouse/fetch-headers.ts — pure parsers, no mocks needed.
 */

import {
  countJsonEachRowRows,
  parseReadBytesFromHeaders,
  parseRowsBeforeLimitFromHeaders,
} from '../fetch-headers'
import { describe, expect, it } from 'bun:test'

describe('parseReadBytesFromHeaders', () => {
  it('parses read_bytes from the summary header', () => {
    expect(
      parseReadBytesFromHeaders({
        'x-clickhouse-summary': '{"read_bytes":"1024","read_rows":"7"}',
      })
    ).toBe(1024)
  })

  it('uses the first value when the header repeats', () => {
    expect(
      parseReadBytesFromHeaders({
        'x-clickhouse-summary': ['{"read_bytes":"5"}', '{"read_bytes":"9"}'],
      })
    ).toBe(5)
  })

  it('returns undefined when headers are missing entirely', () => {
    expect(parseReadBytesFromHeaders(undefined)).toBeUndefined()
    expect(parseReadBytesFromHeaders({})).toBeUndefined()
    expect(
      parseReadBytesFromHeaders({ 'x-clickhouse-summary': undefined })
    ).toBeUndefined()
    expect(parseReadBytesFromHeaders({ 'x-clickhouse-summary': '' })).toBe(
      undefined
    )
  })

  it('returns undefined for malformed JSON or non-numeric values', () => {
    expect(
      parseReadBytesFromHeaders({ 'x-clickhouse-summary': 'not-json' })
    ).toBeUndefined()
    expect(
      parseReadBytesFromHeaders({ 'x-clickhouse-summary': '{"read_bytes":' })
    ).toBeUndefined()
    expect(
      parseReadBytesFromHeaders({
        'x-clickhouse-summary': '{"read_bytes":"abc"}',
      })
    ).toBeUndefined()
    expect(
      parseReadBytesFromHeaders({ 'x-clickhouse-summary': '{"read_rows":"3"}' })
    ).toBeUndefined()
  })
})

describe('parseRowsBeforeLimitFromHeaders', () => {
  it('parses rows_before_limit_at_least from the summary header', () => {
    expect(
      parseRowsBeforeLimitFromHeaders({
        'x-clickhouse-summary': '{"rows_before_limit_at_least":"250"}',
      })
    ).toBe(250)
  })

  it('returns undefined when the field or header is absent', () => {
    expect(parseRowsBeforeLimitFromHeaders(undefined)).toBeUndefined()
    expect(
      parseRowsBeforeLimitFromHeaders({
        'x-clickhouse-summary': '{"read_bytes":"10"}',
      })
    ).toBeUndefined()
  })

  it('returns undefined for malformed or non-numeric values', () => {
    expect(
      parseRowsBeforeLimitFromHeaders({ 'x-clickhouse-summary': '{oops' })
    ).toBeUndefined()
    expect(
      parseRowsBeforeLimitFromHeaders({
        'x-clickhouse-summary': '{"rows_before_limit_at_least":"many"}',
      })
    ).toBeUndefined()
  })
})

describe('countJsonEachRowRows', () => {
  it('counts non-empty lines without allocating line arrays', () => {
    expect(countJsonEachRowRows('')).toBe(0)
    expect(countJsonEachRowRows('\n  \n\t\n')).toBe(0)
    expect(countJsonEachRowRows('{"a":1}\n{"a":2}\n')).toBe(2)
    expect(countJsonEachRowRows('{"a":1}\n\n{"a":2}')).toBe(2)
  })

  it('handles CRLF line endings and a missing trailing newline', () => {
    expect(countJsonEachRowRows('{"a":1}\r\n{"a":2}\r\n')).toBe(2)
    expect(countJsonEachRowRows('{"a":1}')).toBe(1)
  })
})
