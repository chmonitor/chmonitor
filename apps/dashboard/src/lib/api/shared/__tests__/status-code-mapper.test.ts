import { describe, expect, test } from 'bun:test'
import { mapErrorTypeToStatusCode } from '@/lib/api/shared/status-code-mapper'
import { ApiErrorType } from '@/lib/api/types'

describe('mapErrorTypeToStatusCode', () => {
  test('maps ColumnNotFound to 404 like TableNotFound', () => {
    expect(mapErrorTypeToStatusCode(ApiErrorType.ColumnNotFound)).toBe(404)
    expect(mapErrorTypeToStatusCode(ApiErrorType.TableNotFound)).toBe(404)
  })

  test('covers every ApiErrorType without falling back to 500 except QueryError', () => {
    const expected: Record<ApiErrorType, number> = {
      [ApiErrorType.ValidationError]: 400,
      [ApiErrorType.PermissionError]: 403,
      [ApiErrorType.TableNotFound]: 404,
      [ApiErrorType.ColumnNotFound]: 404,
      [ApiErrorType.NetworkError]: 503,
      [ApiErrorType.QueryError]: 500,
      [ApiErrorType.SslError]: 503,
      [ApiErrorType.TimeoutError]: 504,
    }
    for (const type of Object.values(ApiErrorType)) {
      expect(mapErrorTypeToStatusCode(type)).toBe(expected[type])
    }
  })
})
