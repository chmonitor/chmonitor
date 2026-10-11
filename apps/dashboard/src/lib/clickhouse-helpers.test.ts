/**
 * Tests for clickhouse-helpers.ts
 *
 * hostId resolution — exercised through fetchDataWithHost.
 * fetchDataWithHost — calls external I/O (fetchData, ErrorLogger); those are
 * stubbed via mock.module so we test the wrapper's routing and error-handling
 * logic without hitting ClickHouse.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// ── Stub external I/O before any import of the module under test. ─────────

let fetchDataImpl: (...args: unknown[]) => unknown = async () => ({
  data: [],
  metadata: { queryId: 'q1', duration: 5, rows: 0, host: 'localhost' },
  error: null,
})

const logErrorCalls: unknown[][] = []
const logWarningCalls: unknown[][] = []

mock.module('@chm/clickhouse-client', () => ({
  fetchData: (...args: unknown[]) => fetchDataImpl(...args),
}))

mock.module('@chm/logger', () => ({
  ErrorLogger: {
    logError: (...args: unknown[]) => {
      logErrorCalls.push(args)
    },
    logWarning: (...args: unknown[]) => {
      logWarningCalls.push(args)
    },
  },
  isDebugEnabled: () => false,
}))

// ── Import AFTER mocks are registered ────────────────────────────────────

import { fetchDataWithHost } from './clickhouse-helpers'

// =========================================================================
// hostId resolution (via fetchDataWithHost; shared parseHostIdParam)
// =========================================================================

/** Run fetchDataWithHost and report the hostId fetchData got, or the error. */
async function resolveHostId(
  hostId: unknown
): Promise<{ resolved?: unknown; error?: string }> {
  let resolved: unknown
  let reached = false
  fetchDataImpl = async (args) => {
    reached = true
    resolved = (args as unknown as Record<string, unknown>).hostId
    return {
      data: [],
      metadata: { queryId: '', duration: 0, rows: 0, host: '' },
      error: null,
    }
  }
  const result = (await fetchDataWithHost({
    query: 'SELECT 1',
    hostId: hostId as number | string,
  })) as unknown as { error?: { message: string } | null }
  if (reached) return { resolved }
  return { error: result.error?.message }
}

describe('hostId resolution', () => {
  test('undefined, null and "" mean unset → 0', async () => {
    expect((await resolveHostId(undefined)).resolved).toBe(0)
    expect((await resolveHostId(null)).resolved).toBe(0)
    expect((await resolveHostId('')).resolved).toBe(0)
  })

  test('whole non-negative numbers and digit strings pass', async () => {
    expect((await resolveHostId(0)).resolved).toBe(0)
    expect((await resolveHostId(42)).resolved).toBe(42)
    expect((await resolveHostId('0')).resolved).toBe(0)
    expect((await resolveHostId('42')).resolved).toBe(42)
  })

  test('negative ids are rejected', async () => {
    expect((await resolveHostId(-1)).error).toBe('Invalid hostId: -1')
    expect((await resolveHostId('-1')).error).toBe('Invalid hostId: -1')
  })

  test('fractions, NaN and Infinity are rejected, never truncated', async () => {
    expect((await resolveHostId(1.5)).error).toBe('Invalid hostId: 1.5')
    expect((await resolveHostId('1.5')).error).toBe('Invalid hostId: 1.5')
    expect((await resolveHostId(Number.NaN)).error).toBe('Invalid hostId: NaN')
    expect((await resolveHostId(Number.POSITIVE_INFINITY)).error).toBe(
      'Invalid hostId: Infinity'
    )
  })

  test('trailing junk and non-numeric strings are rejected (unlike parseInt)', async () => {
    for (const bad of ['abc', '1a', 'a1', '2abc', '   ', ' 3 ']) {
      expect((await resolveHostId(bad)).error).toBe(`Invalid hostId: ${bad}`)
    }
  })

  test('other types are rejected', async () => {
    expect((await resolveHostId(true)).error).toBe('Invalid hostId: true')
    expect((await resolveHostId({ id: 1 })).error).toBeDefined()
    expect((await resolveHostId([1])).error).toBeDefined()
  })
})

// =========================================================================
// fetchDataWithHost
// =========================================================================

describe('fetchDataWithHost', () => {
  beforeEach(() => {
    logErrorCalls.length = 0
    logWarningCalls.length = 0
    // reset to a clean success stub
    fetchDataImpl = async (args) =>
      ({
        data: [{ col: 'val' }],
        metadata: { queryId: 'q1', duration: 10, rows: 1, host: 'localhost' },
        error: null,
        _args: args,
      }) as unknown
  })

  afterEach(() => {
    logErrorCalls.length = 0
    logWarningCalls.length = 0
  })

  test('happy path: passes resolved hostId and other params to fetchData', async () => {
    let capturedArgs: unknown

    fetchDataImpl = async (args) => {
      capturedArgs = args
      return {
        data: [{ row: 1 }],
        metadata: { queryId: 'q2', duration: 5, rows: 1, host: 'ch' },
        error: null,
      }
    }

    const result = await fetchDataWithHost({
      query: 'SELECT 1',
      hostId: 2,
    })

    expect((capturedArgs as Record<string, unknown>).hostId).toBe(2)
    expect((capturedArgs as Record<string, unknown>).query).toBe('SELECT 1')
    expect((result as unknown as Record<string, unknown>).data).toEqual([
      { row: 1 },
    ])
    expect(logErrorCalls).toHaveLength(0)
  })

  test('string hostId is coerced to a number', async () => {
    let capturedArgs: unknown

    fetchDataImpl = async (args) => {
      capturedArgs = args
      return {
        data: [],
        metadata: { queryId: '', duration: 0, rows: 0, host: '' },
        error: null,
      }
    }

    await fetchDataWithHost({ query: 'SELECT 1', hostId: '5' })

    expect((capturedArgs as Record<string, unknown>).hostId).toBe(5)
  })

  test('invalid string hostId returns a query_error result (no silent fallback)', async () => {
    let fetchDataCalled = false

    fetchDataImpl = async () => {
      fetchDataCalled = true
      return {
        data: [],
        metadata: { queryId: '', duration: 0, rows: 0, host: '' },
        error: null,
      }
    }

    const result = await fetchDataWithHost({
      query: 'SELECT 1',
      hostId: 'bad',
    })

    // fetchData must never be reached with an unvalidated hostId.
    expect(fetchDataCalled).toBe(false)

    const err = (result as unknown as Record<string, unknown>)
      .error as unknown as Record<string, unknown>
    expect(err.type).toBe('query_error')
    expect(err.message).toBe('Invalid hostId: bad')
    expect(logErrorCalls).toHaveLength(1)
  })

  test('default hostId is 0 when omitted', async () => {
    let capturedHostId: unknown

    fetchDataImpl = async (args) => {
      capturedHostId = (args as unknown as Record<string, unknown>).hostId
      return {
        data: [],
        metadata: { queryId: '', duration: 0, rows: 0, host: '' },
        error: null,
      }
    }

    await fetchDataWithHost({ query: 'SELECT 1' })

    expect(capturedHostId).toBe(0)
  })

  test('default format is JSONEachRow when omitted', async () => {
    let capturedFormat: unknown

    fetchDataImpl = async (args) => {
      capturedFormat = (args as unknown as Record<string, unknown>).format
      return {
        data: [],
        metadata: { queryId: '', duration: 0, rows: 0, host: '' },
        error: null,
      }
    }

    await fetchDataWithHost({ query: 'SELECT 1' })

    expect(capturedFormat).toBe('JSONEachRow')
  })

  test('explicit format is forwarded to fetchData', async () => {
    let capturedFormat: unknown

    fetchDataImpl = async (args) => {
      capturedFormat = (args as unknown as Record<string, unknown>).format
      return {
        data: [],
        metadata: { queryId: '', duration: 0, rows: 0, host: '' },
        error: null,
      }
    }

    await fetchDataWithHost({ query: 'SELECT 1', format: 'JSON' })

    expect(capturedFormat).toBe('JSON')
  })

  test('when fetchData throws an Error, returns structured error response', async () => {
    fetchDataImpl = async () => {
      throw new Error('connection refused')
    }

    const result = await fetchDataWithHost({ query: 'SELECT 1' })

    expect((result as unknown as Record<string, unknown>).data).toBeNull()
    const err = (result as unknown as Record<string, unknown>)
      .error as unknown as Record<string, unknown>
    expect(err.type).toBe('query_error')
    expect(err.message).toBe('connection refused')
    const details = err.details as Record<string, unknown>
    expect(details.originalError).toBeInstanceOf(Error)
    expect((details.originalError as Error).message).toBe('connection refused')

    const meta = (result as unknown as Record<string, unknown>)
      .metadata as Record<string, unknown>
    expect(meta.queryId).toBe('')
    expect(meta.duration).toBe(0)
    expect(meta.rows).toBe(0)
    expect(meta.host).toBe('unknown')

    // ErrorLogger.logError must have been called
    expect(logErrorCalls).toHaveLength(1)
    expect(logErrorCalls[0][0]).toBeInstanceOf(Error)
  })

  test('when fetchData throws a non-Error, wraps it in an Error for details', async () => {
    fetchDataImpl = async () => {
      throw 'string error'
    }

    const result = await fetchDataWithHost({ query: 'SELECT 1' })

    const err = (result as unknown as Record<string, unknown>)
      .error as unknown as Record<string, unknown>
    expect(err.message).toBe('An unknown error occurred')
    const details = err.details as Record<string, unknown>
    expect(details.originalError).toBeInstanceOf(Error)
    expect((details.originalError as Error).message).toBe('string error')
  })

  test('ErrorLogger.logError is called with component context on error', async () => {
    fetchDataImpl = async () => {
      throw new Error('boom')
    }

    await fetchDataWithHost({ query: 'SELECT 1' })

    expect(logErrorCalls).toHaveLength(1)
    expect(logErrorCalls[0][1]).toEqual({ component: 'fetchDataWithHost' })
  })

  test('no ErrorLogger calls on success', async () => {
    fetchDataImpl = async () => ({
      data: [],
      metadata: { queryId: 'ok', duration: 1, rows: 0, host: 'h' },
      error: null,
    })

    await fetchDataWithHost({ query: 'SELECT 1' })

    expect(logErrorCalls).toHaveLength(0)
    expect(logWarningCalls).toHaveLength(0)
  })
})
