import { classifyFetchError } from '../fetch-errors'
import { describe, expect, test } from 'bun:test'

describe('classifyFetchError permission errors', () => {
  // Regression for #3526: the demo user lacks SELECT on system.processes and
  // ClickHouse answers with "Not enough privileges" (ACCESS_DENIED, 497). It
  // must classify as permission_error (HTTP 403), not a generic query_error 500.
  test('classifies "Not enough privileges" as permission_error', () => {
    const msg =
      "demo: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(is_cancelled) ON system.processes"
    expect(classifyFetchError(msg)).toBe('permission_error')
  })

  test('keeps unrelated failures as query_error', () => {
    expect(classifyFetchError('Syntax error: failed at position 5')).toBe(
      'query_error'
    )
  })
})
