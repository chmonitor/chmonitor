/**
 * Status Code Mapper Utilities
 *
 * Maps API error types to HTTP status codes.
 */

import { ApiErrorType } from '@/lib/api/types'

const ERROR_TYPE_STATUS_MAP: Readonly<Record<ApiErrorType, number>> = {
  [ApiErrorType.ValidationError]: 400,
  [ApiErrorType.PermissionError]: 403,
  [ApiErrorType.TableNotFound]: 404,
  [ApiErrorType.ColumnNotFound]: 404,
  [ApiErrorType.NetworkError]: 503,
  [ApiErrorType.QueryError]: 500,
  [ApiErrorType.SslError]: 503,
  [ApiErrorType.TimeoutError]: 504,
} as const

export function mapErrorTypeToStatusCode(errorType: ApiErrorType): number {
  return ERROR_TYPE_STATUS_MAP[errorType] ?? 500
}
