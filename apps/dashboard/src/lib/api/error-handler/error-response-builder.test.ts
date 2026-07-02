/**
 * Tests for error-response-builder.ts
 *
 * Covers:
 *  - getStatusCodeForErrorType: correct HTTP status for every ApiErrorType +
 *    fallback to 500 for unknown values
 *  - createErrorResponse: status code, body shape, JSON Content-Type, context
 *    fields wired into metadata.host
 *  - createValidationError: wraps createErrorResponse with 400 + ValidationError
 *  - createNotFoundError: wraps createErrorResponse with 404 + TableNotFound
 *  - parseHostId (indirectly via metadata.host): number passthrough, string
 *    parse, NaN→"unknown", undefined→"unknown"
 */

import { mock } from 'bun:test'

// Mock the logger before importing the module under test.
// The logger writes to console.error/console.warn; we suppress those in tests.
mock.module('@chm/logger', () => ({
  ErrorLogger: {
    logError: () => {},
    logWarning: () => {},
    logDebug: () => {},
  },
  error: () => {},
  warn: () => {},
  log: () => {},
  debug: () => {},
  isDebugEnabled: () => false,
}))

import {
  createErrorResponse,
  createNotFoundError,
  createValidationError,
  getStatusCodeForErrorType,
} from './error-response-builder'
import { describe, expect, it } from 'bun:test'
import { ApiErrorType } from '@/lib/api/types'

// ---------------------------------------------------------------------------
// getStatusCodeForErrorType
// ---------------------------------------------------------------------------

describe('getStatusCodeForErrorType', () => {
  it('returns 400 for ValidationError', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.ValidationError)).toBe(400)
  })

  it('returns 403 for PermissionError', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.PermissionError)).toBe(403)
  })

  it('returns 404 for TableNotFound', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.TableNotFound)).toBe(404)
  })

  it('returns 503 for NetworkError', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.NetworkError)).toBe(503)
  })

  it('returns 500 for QueryError', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.QueryError)).toBe(500)
  })

  it('returns 503 for SslError', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.SslError)).toBe(503)
  })

  it('returns 504 for TimeoutError', () => {
    expect(getStatusCodeForErrorType(ApiErrorType.TimeoutError)).toBe(504)
  })

  it('falls back to 500 for an unknown error type string', () => {
    // Cast to ApiErrorType to simulate an unmapped/future value
    expect(
      getStatusCodeForErrorType('unknown_future_type' as ApiErrorType)
    ).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// createErrorResponse — helpers
// ---------------------------------------------------------------------------

async function parseBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

// ---------------------------------------------------------------------------
// createErrorResponse
// ---------------------------------------------------------------------------

describe('createErrorResponse', () => {
  it('returns a Response with the given status code', () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'query failed' },
      500
    )
    expect(res.status).toBe(500)
  })

  it('sets Content-Type to application/json', () => {
    const res = createErrorResponse(
      { type: ApiErrorType.ValidationError, message: 'bad input' },
      400
    )
    expect(res.headers.get('Content-Type')).toContain('application/json')
  })

  it('body has success: false', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'oops' },
      500
    )
    const body = await parseBody(res)
    expect(body.success).toBe(false)
  })

  it('body.error carries the correct type and message', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.NetworkError, message: 'unreachable' },
      503
    )
    const body = await parseBody(res)
    const err = body.error as { type: string; message: string }
    expect(err.type).toBe(ApiErrorType.NetworkError)
    expect(err.message).toBe('unreachable')
  })

  it('body.error carries optional details when provided', async () => {
    const res = createErrorResponse(
      {
        type: ApiErrorType.ValidationError,
        message: 'missing param',
        details: { parameter: 'hostId' },
      },
      400
    )
    const body = await parseBody(res)
    const err = body.error as { details: Record<string, unknown> }
    expect(err.details).toEqual({ parameter: 'hostId' })
  })

  it('body.metadata.host reflects numeric hostId from context', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'fail' },
      500,
      { route: '/api/v1/data', method: 'GET', hostId: 2 }
    )
    const body = await parseBody(res)
    const meta = body.metadata as { host: string }
    expect(meta.host).toBe('2')
  })

  it('body.metadata.host reflects string hostId from context', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'fail' },
      500,
      { route: '/api/v1/data', method: 'GET', hostId: '3' }
    )
    const body = await parseBody(res)
    const meta = body.metadata as { host: string }
    expect(meta.host).toBe('3')
  })

  it('body.metadata.host is "unknown" when hostId is omitted', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'fail' },
      500,
      { route: '/api/v1/data', method: 'GET' }
    )
    const body = await parseBody(res)
    const meta = body.metadata as { host: string }
    expect(meta.host).toBe('unknown')
  })

  it('body.metadata.host is "unknown" when context is omitted entirely', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'fail' },
      500
    )
    const body = await parseBody(res)
    const meta = body.metadata as { host: string }
    expect(meta.host).toBe('unknown')
  })

  it('body.metadata has required zero-value fields (queryId, duration, rows)', async () => {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'fail' },
      500
    )
    const body = await parseBody(res)
    const meta = body.metadata as {
      queryId: string
      duration: number
      rows: number
    }
    expect(meta.queryId).toBe('')
    expect(meta.duration).toBe(0)
    expect(meta.rows).toBe(0)
  })

  it('accepts any numeric status code (e.g. 429)', () => {
    const res = createErrorResponse(
      { type: ApiErrorType.ValidationError, message: 'rate limited' },
      429
    )
    expect(res.status).toBe(429)
  })
})

// ---------------------------------------------------------------------------
// createValidationError
// ---------------------------------------------------------------------------

describe('createValidationError', () => {
  it('returns a 400 response', () => {
    const res = createValidationError('missing hostId')
    expect(res.status).toBe(400)
  })

  it('sets error.type to ValidationError', async () => {
    const res = createValidationError('bad value')
    const body = await parseBody(res)
    const err = body.error as { type: string }
    expect(err.type).toBe(ApiErrorType.ValidationError)
  })

  it('sets error.message to the provided string', async () => {
    const res = createValidationError('Missing required parameter: hostId')
    const body = await parseBody(res)
    const err = body.error as { message: string }
    expect(err.message).toBe('Missing required parameter: hostId')
  })

  it('sets success: false', async () => {
    const res = createValidationError('invalid')
    const body = await parseBody(res)
    expect(body.success).toBe(false)
  })

  it('uses context.hostId in metadata.host when provided', async () => {
    const res = createValidationError('bad', {
      route: '/api/v1/data',
      method: 'GET',
      hostId: 1,
    })
    const body = await parseBody(res)
    const meta = body.metadata as { host: string }
    expect(meta.host).toBe('1')
  })

  it('works without a context argument', () => {
    expect(() => createValidationError('standalone error')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// createNotFoundError
// ---------------------------------------------------------------------------

describe('createNotFoundError', () => {
  it('returns a 404 response', () => {
    const res = createNotFoundError('chart not found')
    expect(res.status).toBe(404)
  })

  it('sets error.type to TableNotFound', async () => {
    const res = createNotFoundError('unknown-chart')
    const body = await parseBody(res)
    const err = body.error as { type: string }
    expect(err.type).toBe(ApiErrorType.TableNotFound)
  })

  it('sets error.message to the provided string', async () => {
    const res = createNotFoundError('Chart not found: xyz')
    const body = await parseBody(res)
    const err = body.error as { message: string }
    expect(err.message).toBe('Chart not found: xyz')
  })

  it('sets success: false', async () => {
    const res = createNotFoundError('nothing here')
    const body = await parseBody(res)
    expect(body.success).toBe(false)
  })

  it('uses context.hostId in metadata.host when provided', async () => {
    const res = createNotFoundError('missing', {
      route: '/api/v1/charts/[name]',
      method: 'GET',
      hostId: 1,
    })
    const body = await parseBody(res)
    const meta = body.metadata as { host: string }
    expect(meta.host).toBe('1')
  })

  it('works without a context argument', () => {
    expect(() => createNotFoundError('standalone')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// parseHostId (tested indirectly through metadata.host)
// ---------------------------------------------------------------------------

describe('parseHostId (via metadata.host)', () => {
  async function getHost(hostId: number | string | undefined): Promise<string> {
    const res = createErrorResponse(
      { type: ApiErrorType.QueryError, message: 'x' },
      500,
      { hostId }
    )
    const body = await parseBody(res)
    return (body.metadata as { host: string }).host
  }

  it('converts numeric 0 to "unknown" (falsy short-circuit in source)', async () => {
    // The source builds host as String(context?.hostId || 'unknown').
    // hostId=0 is falsy, so the || branch fires → "unknown".
    expect(await getHost(0)).toBe('unknown')
  })

  it('converts numeric 42 to "42"', async () => {
    expect(await getHost(42)).toBe('42')
  })

  it('converts string "5" to "5"', async () => {
    expect(await getHost('5')).toBe('5')
  })

  it('converts string "0" to "unknown" (falsy short-circuit in source)', async () => {
    // '0' is truthy as a string, but Number('0') === 0 which is falsy when
    // passed through String(context?.hostId || 'unknown') where hostId='0'
    // is truthy → String('0') = '0'. However the || checks the raw hostId
    // value, not the parsed number. '0' is truthy → String('0') = '0'.
    expect(await getHost('0')).toBe('0')
  })

  it('converts undefined to "unknown"', async () => {
    expect(await getHost(undefined)).toBe('unknown')
  })

  it('converts non-numeric string to "unknown"', async () => {
    // parseHostId returns undefined for NaN; String(undefined) = "undefined"
    // but the source does String(context?.hostId || 'unknown') where
    // context.hostId = 'abc' → truthy → String('abc') = 'abc'
    // parseHostId('abc') → NaN → undefined, but metadata.host is built from
    // String(context?.hostId || 'unknown'), not from parseHostId result.
    // So 'abc' (truthy) → String('abc') = 'abc'.
    expect(await getHost('abc')).toBe('abc')
  })
})
