import type { ApiError } from '@/lib/api/types'

import { ApiErrorType } from '@/lib/api/types'

/**
 * Strictly parse a host id from a query param, form field, or JSON body.
 *
 * The single shared host id parser (#3741). Accepts only a whole number:
 * a safe-integer `number`, or a string of digits with an optional leading
 * `-`. Everything else — fractions (`"1.5"`, `1.5`), trailing junk
 * (`"1abc"`), whitespace, hex, exponents, `""`, `null`, other types —
 * returns `NaN`, so it is never truncated to a different host the way
 * `parseInt` would.
 *
 * Sign is NOT checked here: negative ids are per-user connections, and
 * each route decides whether it accepts them (most reject `< 0`).
 *
 * @returns The parsed integer, or `NaN` when `raw` is not a whole number.
 */
export function parseHostIdParam(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) ? raw : NaN
  }
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) return NaN
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : NaN
}

function parseStrictHostId(raw: string): number {
  const n = parseHostIdParam(raw)
  return n >= 0 ? n : NaN
}

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
