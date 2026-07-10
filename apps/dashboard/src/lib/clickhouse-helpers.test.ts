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

    test('negative number throws', () => {
      expect(() => validateHostId(-1)).toThrow('Invalid hostId: -1')
      expect(() => validateHostId(-100)).toThrow('Invalid hostId: -100')
    })

    test('non-integer (float) throws', () => {
      expect(() => validateHostId(1.5)).toThrow('Invalid hostId: 1.5')
      expect(() => validateHostId(0.1)).toThrow('Invalid hostId: 0.1')
    })

    test('NaN throws', () => {
      expect(() => validateHostId(Number.NaN)).toThrow('Invalid hostId: NaN')
    })

    test('Infinity throws (not an integer)', () => {
      // Number.isInteger(Infinity) === false → falls into the guard
      expect(() => validateHostId(Number.POSITIVE_INFINITY)).toThrow(
        'Invalid hostId: Infinity'
      )
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

    test('non-numeric string throws (no more silent coercion)', () => {
      expect(() => validateHostId('abc')).toThrow('Invalid hostId: abc')
      expect(() => validateHostId('1a')).toThrow('Invalid hostId: 1a')
      expect(() => validateHostId('a1')).toThrow('Invalid hostId: a1')
    })

    test('trailing garbage after digits throws (unlike parseInt)', () => {
      expect(() => validateHostId('2abc')).toThrow('Invalid hostId: 2abc')
    })

    test('empty string returns 0 (treated as missing, like undefined)', () => {
      expect(validateHostId('')).toBe(0)
    })

    test('whitespace-only string returns 0 (treated as missing)', () => {
      expect(validateHostId('   ')).toBe(0)
    })

    test('float string throws (contains dot, fails /^\\d+$/ test)', () => {
      expect(() => validateHostId('1.5')).toThrow('Invalid hostId: 1.5')
    })

    test('negative numeric string throws (contains minus, fails /^\\d+$/ test)', () => {
      expect(() => validateHostId('-1')).toThrow('Invalid hostId: -1')
    })
  })

  describe('other types → throw', () => {
    test('boolean throws', () => {
      expect(() => validateHostId(true)).toThrow('Invalid hostId: true')
      expect(() => validateHostId(false)).toThrow('Invalid hostId: false')
    })

    test('object throws', () => {
      expect(() => validateHostId({})).toThrow()
      expect(() => validateHostId({ id: 1 })).toThrow()
    })

    test('array throws', () => {
      expect(() => validateHostId([1])).toThrow()
    })

    test('symbol throws', () => {
      expect(() => validateHostId(Symbol('x'))).toThrow()
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
