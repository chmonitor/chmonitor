/**
 * Data transformation utilities for ClickHouse responses
 *
 * ClickHouse returns large numbers as strings to preserve precision.
 * This module provides utilities to convert numeric strings to numbers
 * for chart rendering and other use cases.
 */

function isNumericString(value: string): boolean {
  if (value === '' || value === null || value === undefined) return false
  // Match integers, floats, negative numbers, and scientific notation
  // Also handles UInt64/Int64 large numbers from ClickHouse
  return /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(value)
}

function safeParseNumber(value: string): number | string {
  const num = Number(value)
  // Check for precision loss with large integers
  // JavaScript can safely represent integers up to 2^53 - 1
  if (Number.isInteger(num) && Math.abs(num) > Number.MAX_SAFE_INTEGER) {
    return value // Keep as string to preserve precision
  }
  return num
}

function transformValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  if (typeof value === 'string' && isNumericString(value)) {
    return safeParseNumber(value)
  }

  if (Array.isArray(value)) {
    return value.map(transformValue)
  }

  if (typeof value === 'object') {
    return transformRecord(value as Record<string, unknown>)
  }

  return value
}

function transformRecord(
  record: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    result[key] = transformValue(value)
  }

  return result
}

/** ClickHouse returns UInt64/Int64 as strings in JSON to preserve precision; convert them back. */
export function transformClickHouseData<T extends Record<string, unknown>>(
  data: T[]
): T[] {
  if (!Array.isArray(data)) {
    return data
  }

  return data.map((record) => transformRecord(record) as T)
}
