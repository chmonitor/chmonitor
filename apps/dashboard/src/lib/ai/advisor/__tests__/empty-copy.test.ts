import { describe, expect, test } from 'bun:test'
import { advisorUserInputCopy } from '@/lib/ai/advisor/empty-copy'

describe('advisorUserInputCopy', () => {
  test('no_target_table is a next-step empty, not a parser dump', () => {
    const copy = advisorUserInputCopy(
      'no_target_table',
      'Could not identify a target table in the query (no FROM/JOIN found).'
    )
    expect(copy.title).toBe('Needs a table to analyze')
    expect(copy.description).toContain('FROM')
    expect(copy.description).not.toContain('no FROM/JOIN found')
  })

  test('query_not_found keeps the server message', () => {
    const copy = advisorUserInputCopy('query_not_found', 'No finished query')
    expect(copy.title).toBe('Query not found')
    expect(copy.description).toBe('No finished query')
  })
})
