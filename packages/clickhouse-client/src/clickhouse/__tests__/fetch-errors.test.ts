import { classifyFetchError, handleFetchError } from '../fetch-errors'
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

// Raw server text captured from ClickHouse 26.5. The client's parseError turns
// it into a ClickHouseError whose message drops the code and type and keeps
// them as `.code` / `.type`. Other test files mock '@clickhouse/client', so the
// error is built here with the same shape instead of importing parseError.
// The classifier must use the type, not words such as "access", "connection"
// or "timeout" that appear in identifiers.
describe('handleFetchError classifies by ClickHouse error type', () => {
  const run = (originalError: unknown) =>
    handleFetchError({ originalError, host: 'h', start: new Date() }).error
      ?.type
  const asClientError = (raw: string) => {
    const m = raw.match(/^Code: (\d+)\. DB::Exception: (.+?)\(([A-Z_]+)\)$/)
    if (!m) throw new Error(`not a server error: ${raw}`)
    return Object.assign(new Error(m[2]), { code: m[1], type: m[3] })
  }
  const classify = (raw: string) => {
    const typed = run(asClientError(raw))
    expect(run(new Error(raw))).toBe(typed)
    return typed
  }

  test.each([
    [
      "Code: 47. DB::Exception: Unknown expression identifier `access_typo` in scope SELECT access_typo FROM system.grants. Maybe you meant: ['access_type']. (UNKNOWN_IDENTIFIER)",
      'query_error',
    ],
    [
      'Code: 47. DB::Exception: Unknown expression or function identifier `connection_typo` in scope SELECT * FROM system.tables WHERE connection_typo = 1. (UNKNOWN_IDENTIFIER)',
      'query_error',
    ],
    [
      "Code: 115. DB::Exception: Unknown setting 'receive_timeout_x': Maybe you meant ['receive_timeout']. (UNKNOWN_SETTING)",
      'query_error',
    ],
    [
      "Code: 60. DB::Exception: Unknown table expression identifier 'system.certificates_x' in scope SELECT * FROM system.certificates_x. (UNKNOWN_TABLE)",
      'table_not_found',
    ],
    [
      "Code: 497. DB::Exception: ro: Not enough privileges. To execute this query, it's necessary to have the grant SELECT(event_time) ON system.query_log. (ACCESS_DENIED)",
      'permission_error',
    ],
    [
      'Code: 516. DB::Exception: ro: Authentication failed: password is incorrect, or there is no user with such name. (AUTHENTICATION_FAILED)',
      'permission_error',
    ],
    [
      'Code: 159. DB::Exception: Timeout exceeded: elapsed 1112.257282 ms, maximum: 1000 ms. (TIMEOUT_EXCEEDED)',
      'timeout_error',
    ],
  ] as const)('%s', (raw, expected) => {
    expect(classify(raw)).toBe(expected)
  })

  test('uses the innermost type of a cluster-wrapped error', () => {
    const raw =
      "Code: 279. DB::Exception: There was an error on [n2:9000]: Code: 497. DB::Exception: ro: Not enough privileges. To execute this query, it's necessary to have the grant SELECT ON system.parts. (ACCESS_DENIED)"
    expect(run(new Error(raw))).toBe('permission_error')
  })

  test('falls back to message heuristics for non-ClickHouse errors', () => {
    expect(run(new Error('fetch failed: ECONNREFUSED 127.0.0.1:8123'))).toBe(
      'network_error'
    )
  })
})
