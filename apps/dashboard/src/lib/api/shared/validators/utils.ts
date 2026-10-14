/**
 * Validator Utilities
 *
 * Shared utility functions for query parameter sanitization.
 *
 * @module lib/api/shared/validators/utils
 */

/**
 * Sanitize query parameters by converting values to strings and validating types
 *
 * Removes undefined values and ensures proper types for ClickHouse parameterized queries.
 * This is essential for safely passing parameters to ClickHouse to prevent injection.
 *
 * @param params - Raw query parameters from request
 * @returns Sanitized parameters with string values
 *
 * @example
 * ```ts
 * sanitizeQueryParams({
 *   name: 'users',
 *   limit: 100,
 *   offset: undefined,
 *   active: true,
 * })
 * // Returns: { name: 'users', limit: '100', active: 'true' }
 *
 * sanitizeQueryParams({
 *   ids: [1, 2, 3],
 *   config: { key: 'value' },
 *   nullable: null,
 * })
 * // Returns: { ids: '1,2,3', config: '{"key":"value"}', nullable: '' }
 * ```
 */
export function sanitizeQueryParams(
  params: Record<string, unknown>
): Record<string, string> {
  const sanitized: Record<string, string> = {}

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) {
      continue
    }

    if (value === null) {
      sanitized[key] = ''
      continue
    }

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      sanitized[key] = String(value)
      continue
    }

    // For arrays, join with commas (useful for IN clauses)
    if (Array.isArray(value)) {
      sanitized[key] = value.map((v) => String(v)).join(',')
      continue
    }

    // For objects, stringify as JSON (useful for complex parameters)
    if (typeof value === 'object') {
      sanitized[key] = JSON.stringify(value)
      continue
    }

    // Fallback: convert to string
    sanitized[key] = String(value)
  }

  return sanitized
}

/**
 * Truncate a string to a maximum length with ellipsis
 *
 * Useful for logging query previews without exposing full sensitive data.
 *
 * @param str - The string to truncate
 * @param maxLength - Maximum length before truncation
 * @returns Truncated string with ellipsis if needed
 *
 * @example
 * ```ts
 * truncateString('SELECT * FROM system.users', 20)
 * // Returns: 'SELECT * FROM syst...'
 * ```
 */
export function truncateString(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return `${str.substring(0, maxLength)}...`
}

/**
 * Check if a value is a non-empty string
 *
 * @param value - The value to check
 * @returns True if value is a non-empty string
 *
 * @example
 * ```ts
 * isNonEmptyString('hello') // true
 * isNonEmptyString('') // false
 * isNonEmptyString(null) // false
 * isNonEmptyString(123) // false
 * ```
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Check if a value is a valid number (not NaN)
 *
 * @param value - The value to check
 * @returns True if value is a valid number
 *
 * @example
 * ```ts
 * isValidNumber(123) // true
 * isValidNumber(0) // true
 * isValidNumber(NaN) // false
 * isValidNumber('123') // false
 * ```
 */
export function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

/**
 * Check if a value is a positive number (greater than or equal to 0)
 *
 * @param value - The value to check
 * @returns True if value is a positive number
 *
 * @example
 * ```ts
 * isPositiveNumber(10) // true
 * isPositiveNumber(0) // true
 * isPositiveNumber(-5) // false
 * isPositiveNumber('10') // false
 * ```
 */
export function isPositiveNumber(value: unknown): value is number {
  return isValidNumber(value) && value >= 0
}
