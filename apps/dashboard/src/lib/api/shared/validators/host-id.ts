/**
 * Host ID Validators
 *
 * Validation utilities for hostId parameter from URL search params.
 *
 * @module lib/api/shared/validators/host-id
 */

import type { ApiError } from '@/lib/api/types'

import { ApiErrorType } from '@/lib/api/types'

/**
 * Strictly parse a hostId string as a non-negative integer.
 *
 * Unlike `parseInt`, this rejects strings with trailing non-digit characters
 * (e.g. `"2abc"` would otherwise parse as `2`) by requiring the entire string
 * to be digits before converting.
 *
 * @returns The parsed integer, or `NaN` if `raw` is not a valid integer string.
 */
function parseStrictHostId(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : NaN
}

/**
 * Validate and extract hostId from URL search params
 *
 * @param hostId - The hostId value from URLSearchParams (can be null)
 * @returns Parsed hostId as number
 * @throws {Error} If hostId is missing, null, or invalid
 *
 * @example
 * ```ts
 * const url = new URL(request.url)
 * const hostId = validateHostId(url.searchParams.get('hostId'))
 * // Returns: 0, 1, 2, etc.
 * // Throws: "Missing required parameter: hostId"
 * // Throws: "Invalid hostId: must be a non-negative number"
 * ```
 */
export function validateHostId(hostId: string | null): number {
  if (!hostId) {
    throw new Error('Missing required parameter: hostId')
  }

  const parsed = parseStrictHostId(hostId)

  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error('Invalid hostId: must be a non-negative number')
  }

  return parsed
}

/**
 * Validate hostId parameter (returns ApiError instead of throwing)
 *
 * @param hostId - The hostId value to validate
 * @returns ApiError if validation fails, undefined otherwise
 *
 * @example
 * ```ts
 * const error = validateHostIdWithError(body.hostId)
 * if (error) return createErrorResponse(error, 400)
 * ```
 */
export function validateHostIdWithError(hostId: unknown): ApiError | undefined {
  if (hostId === undefined || hostId === null || hostId === '') {
    return {
      type: ApiErrorType.ValidationError,
      message: 'Missing required field: hostId',
    }
  }

  const parsed =
    typeof hostId === 'number'
      ? hostId
      : typeof hostId === 'string'
        ? parseStrictHostId(hostId)
        : NaN

  if (Number.isNaN(parsed) || parsed < 0) {
    return {
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    }
  }

  return undefined
}

/**
 * Validate and parse hostId from URL search params (returns ApiError instead of throwing)
 *
 * @param searchParams - URLSearchParams object from request URL
 * @returns Parsed hostId as number, or ApiError if validation fails
 *
 * @example
 * ```ts
 * const url = new URL(request.url)
 * const result = getAndValidateHostId(url.searchParams)
 * if (typeof result !== 'number') {
 *   return createValidationError(result.message, { route: '/api/v1/data', method: 'GET' })
 * }
 * const hostId = result
 * ```
 */
export function getAndValidateHostId(
  searchParams: URLSearchParams
): number | ApiError {
  const hostId = searchParams.get('hostId')

  if (!hostId) {
    return {
      type: ApiErrorType.ValidationError,
      message: 'Missing required parameter: hostId',
    }
  }

  const parsed = parseStrictHostId(hostId)

  if (Number.isNaN(parsed) || parsed < 0) {
    return {
      type: ApiErrorType.ValidationError,
      message: 'Invalid hostId: must be a non-negative number',
    }
  }

  return parsed
}
