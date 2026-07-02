/**
 * Tests for clickhouse-helpers.ts
 *
 * validateHostId — pure function, tested exhaustively.
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

import { fetchDataWithHost, validateHostId } from './clickhouse-helpers'

// =========================================================================
// validateHostId
// =========================================================================

describe('validateHostId', () => {
  describe('undefined / null → 0', () => {
    test('undefined returns 0', () => {
      expect(validateHostId(undefined)).toBe(0)
    })

    test('null returns 0', () => {
      expect(validateHostId(null)).toBe(0)
    })
  })

  describe('number inputs', () => {
    test('zero is valid', () => {
      expect(validateHostId(0)).toBe(0)
    })

    test('positive integer is returned as-is', () => {
      expect(validateHostId(1)).toBe(1)
      expect(validateHostId(42)).toBe(42)
    })

    test('negative number returns 0', () => {
      expect(validateHostId(-1)).toBe(0)
      expect(validateHostId(-100)).toBe(0)
    })

    test('non-integer (float) returns 0', () => {
      expect(validateHostId(1.5)).toBe(0)
      expect(validateHostId(0.1)).toBe(0)
    })

    test('NaN returns 0', () => {
      expect(validateHostId(Number.NaN)).toBe(0)
    })

    test('Infinity returns 0 (not an integer)', () => {
      // Number.isInteger(Infinity) === false → falls into the guard
      expect(validateHostId(Number.POSITIVE_INFINITY)).toBe(0)
    })
  })

  describe('string inputs', () => {
    test('valid numeric string "0" returns 0', () => {
      expect(validateHostId('0')).toBe(0)
    })

    test('valid numeric string returns parsed integer', () => {
      expect(validateHostId('1')).toBe(1)
      expect(validateHostId('42')).toBe(42)
    })

    test('numeric string with leading/trailing spaces is trimmed and parsed', () => {
      expect(validateHostId(' 3 ')).toBe(3)
    })

    test('non-numeric string returns 0', () => {
      expect(validateHostId('abc')).toBe(0)
      expect(validateHostId('1a')).toBe(0)
      expect(validateHostId('a1')).toBe(0)
    })

    test('empty string returns 0', () => {
      expect(validateHostId('')).toBe(0)
    })

    test('whitespace-only string returns 0', () => {
      expect(validateHostId('   ')).toBe(0)
    })

    test('float string returns 0 (contains dot, fails /^\\d+$/ test)', () => {
      expect(validateHostId('1.5')).toBe(0)
    })

    test('negative numeric string returns 0 (contains minus, fails /^\\d+$/ test)', () => {
      expect(validateHostId('-1')).toBe(0)
    })
  })

  describe('other types → 0', () => {
    test('boolean returns 0', () => {
      expect(validateHostId(true)).toBe(0)
      expect(validateHostId(false)).toBe(0)
    })

    test('object returns 0', () => {
      expect(validateHostId({})).toBe(0)
      expect(validateHostId({ id: 1 })).toBe(0)
    })

    test('array returns 0', () => {
      expect(validateHostId([1])).toBe(0)
    })

    test('symbol returns 0', () => {
      expect(validateHostId(Symbol('x'))).toBe(0)
    })
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

  test('string hostId is coerced via validateHostId', async () => {
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

  test('invalid string hostId falls back to 0', async () => {
    let capturedHostId: unknown

    fetchDataImpl = async (args) => {
      capturedHostId = (args as unknown as Record<string, unknown>).hostId
      return {
        data: [],
        metadata: { queryId: '', duration: 0, rows: 0, host: '' },
        error: null,
      }
    }

    await fetchDataWithHost({ query: 'SELECT 1', hostId: 'bad' })

    expect(capturedHostId).toBe(0)
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
