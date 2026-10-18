import type { ApiError, ApiRequest } from '@/lib/api/types'

import { validateFormat } from './format'
import { validateHostIdWithError } from './host-id'
import { VALID_INTERVALS } from '@chm/types'
import { ApiErrorType } from '@/lib/api/types'

export function validateRequiredString(
  value: unknown,
  fieldName: string
): ApiError | undefined {
  if (typeof value !== 'string' || value.trim() === '') {
    return {
      type: ApiErrorType.ValidationError,
      message: `Missing required field: ${fieldName}`,
    }
  }
  return undefined
}

export function validateDataRequest(
  body: Partial<ApiRequest>
): ApiError | undefined {
  const queryError = validateRequiredString(body.query, 'query')
  if (queryError) return queryError

  const hostIdError = validateHostIdWithError(body.hostId)
  if (hostIdError) return hostIdError

  const formatError = validateFormat(body.format)
  if (formatError) return formatError

  return undefined
}

export function validateSearchParams(
  searchParams: URLSearchParams,
  requiredParams: string[]
): ApiError | undefined {
  for (const param of requiredParams) {
    const value = searchParams.get(param)
    if (!value || value.trim() === '') {
      return {
        type: ApiErrorType.ValidationError,
        message: `Missing required parameter: ${param}`,
      }
    }
  }
  return undefined
}

/** Maximum allowed limit to prevent DoS via large result sets */
const MAX_LIMIT = 10_000
const DEFAULT_LIMIT = 100

export function validatePaginationParams(searchParams: URLSearchParams): {
  limit: number
  offset: number
  error?: ApiError
} {
  const limitStr = searchParams.get('limit')
  const offsetStr = searchParams.get('offset')

  let limit = DEFAULT_LIMIT
  let offset = 0

  if (limitStr !== null) {
    limit = parseInt(limitStr, 10)
    if (Number.isNaN(limit) || limit < 1) {
      return {
        limit: DEFAULT_LIMIT,
        offset: 0,
        error: {
          type: ApiErrorType.ValidationError,
          message: `Invalid limit: must be a positive integer`,
        },
      }
    }
    if (limit > MAX_LIMIT) {
      return {
        limit: DEFAULT_LIMIT,
        offset: 0,
        error: {
          type: ApiErrorType.ValidationError,
          message: `Limit exceeds maximum allowed value of ${MAX_LIMIT}`,
        },
      }
    }
  }

  if (offsetStr !== null) {
    offset = parseInt(offsetStr, 10)
    if (Number.isNaN(offset) || offset < 0) {
      return {
        limit,
        offset: 0,
        error: {
          type: ApiErrorType.ValidationError,
          message: `Invalid offset: must be a non-negative integer`,
        },
      }
    }
  }

  return { limit, offset }
}

export function validateIntervalParam(
  interval: string | null
): ApiError | undefined {
  if (!interval) return undefined

  if (!VALID_INTERVALS.includes(interval as (typeof VALID_INTERVALS)[number])) {
    return {
      type: ApiErrorType.ValidationError,
      message: `Invalid interval: ${interval}. Must be one of: ${VALID_INTERVALS.join(', ')}`,
    }
  }

  return undefined
}

export function validateEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string
): ApiError | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  if (typeof value !== 'string') {
    return {
      type: ApiErrorType.ValidationError,
      message: `Invalid ${fieldName}: must be a string`,
    }
  }

  if (!allowedValues.includes(value as T)) {
    return {
      type: ApiErrorType.ValidationError,
      message: `Invalid ${fieldName}: must be one of ${allowedValues.join(', ')}`,
    }
  }

  return undefined
}
