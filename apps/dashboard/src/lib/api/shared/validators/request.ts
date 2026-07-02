/**
 * Request Validators
 *
 * Validation utilities for API request bodies and search parameters.
 *
 * @module lib/api/shared/validators/request
 */

import type { ApiError, ApiRequest } from '@/lib/api/types'

import { validateFormat } from './format'
import { validateHostIdWithError } from './host-id'
import { VALID_INTERVALS } from '@chm/types'
import { ApiErrorType } from '@/lib/api/types'

/**
 * Validate that a required string field is present and non-empty
 *
 * @param value - The value to validate
 * @param fieldName - The name of the field for error messages
 * @returns ApiError if validation fails, undefined otherwise
 *
 * @example
 * ```ts
 * const error = validateRequiredString(body.query, 'query')
 * if (error) return createErrorResponse(error, 400)
 * ```
 */
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

/**
 * Validate an API request body for the /api/v1/data endpoint
 *
 * Validates that required fields (query, hostId) are present and valid.
 * Optionally validates the format field if provided.
 *
 * @param body - Partial API request body to validate
 * @returns ApiError if validation fails, undefined otherwise
 *
 * @example
 * ```ts
 * const body = await request.json()
 * const error = validateDataRequest(body)
 * if (error) return createErrorResponse(error, 400)
 * ```
 */
export function validateDataRequest(
  body: Partial<ApiRequest>
): ApiError | undefined {
  // Validate required query field
  const queryError = validateRequiredString(body.query, 'query')
  if (queryError) return queryError

  // Validate required hostId field
  const hostIdError = validateHostIdWithError(body.hostId)
  if (hostIdError) return hostIdError

  // Validate optional format field
  const formatError = validateFormat(body.format)
  if (formatError) return formatError

  return undefined
}

/**
 * Validate URL search parameters for GET requests
 *
 * Ensures that all required parameters are present and non-empty.
 *
 * @param searchParams - URLSearchParams object from request URL
 * @param requiredParams - Array of required parameter names
 * @returns ApiError if validation fails, undefined otherwise
 *
 * @example
 * ```ts
 * const url = new URL(request.url)
 * const error = validateSearchParams(url.searchParams, ['hostId', 'sql'])
 * if (error) return createErrorResponse(error, 400)
 * ```
 */
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
/** Default limit when not specified */
const DEFAULT_LIMIT = 100

/**
 * Validate pagination parameters (limit and offset)
 * Prevents DoS via excessively large limits and invalid offsets
 */
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

/**
 * Validate ClickHouse interval parameter
 */
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

/**
 * Validate that a query parameter is one of the allowed values
 *
 * Generic validator for enum-like parameters. Useful for validating
 * formats, sort orders, and other finite-value parameters.
 *
 * @param value - The value to validate
 * @param allowedValues - Array of allowed string values
 * @param fieldName - The name of the field for error messages
 * @returns ApiError if validation fails, undefined otherwise
 */
export function validateEnumValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[],
  fieldName: string
): ApiError | undefined {
  // Optional field - undefined/null is allowed
  if (value === undefined || value === null) {
    return undefined
  }

  // Type check
  if (typeof value !== 'string') {
    return {
      type: ApiErrorType.ValidationError,
      message: `Invalid ${fieldName}: must be a string`,
    }
  }

  // Value check
  if (!allowedValues.includes(value as T)) {
    return {
      type: ApiErrorType.ValidationError,
      message: `Invalid ${fieldName}: must be one of ${allowedValues.join(', ')}`,
    }
  }

  return undefined
}
