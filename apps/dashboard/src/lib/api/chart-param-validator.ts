/**
 * Chart query_params validator.
 *
 * The `params` query string field on /api/v1/charts/$name is user-supplied
 * JSON forwarded directly to ClickHouse parameterized queries. Parameterized
 * queries already prevent SQL injection, but we still need to guard against:
 *   - Oversized values / keys that waste memory or slow serialization
 *   - Deeply-nested objects (not expected by any chart; would stringify oddly)
 *   - Excessive key count
 *
 * When a chart registers an `allowedParams` set, unknown keys are rejected.
 * Otherwise, generic bounds are enforced.
 */

const MAX_PARAM_KEYS = 20
const MAX_KEY_LENGTH = 64
const MAX_VALUE_STRING_LENGTH = 512

export interface ChartParamError {
  type: 'validation'
  message: string
  field?: string
}

export interface ChartParamOk {
  type: 'ok'
  params: Record<string, string | number | boolean>
}

export type ChartParamResult = ChartParamOk | ChartParamError

export function validateChartParams(
  raw: Record<string, unknown>,
  allowedParams?: ReadonlySet<string> | readonly string[]
): ChartParamResult {
  const keys = Object.keys(raw)

  if (keys.length > MAX_PARAM_KEYS) {
    return {
      type: 'validation',
      message: `Too many chart params (${keys.length}). Maximum is ${MAX_PARAM_KEYS}.`,
    }
  }

  const allowed =
    allowedParams instanceof Set
      ? allowedParams
      : allowedParams
        ? new Set(allowedParams)
        : null

  const sanitized: Record<string, string | number | boolean> = {}

  for (const key of keys) {
    if (key.length > MAX_KEY_LENGTH) {
      return {
        type: 'validation',
        message: `Param key too long: "${key.slice(0, 32)}…". Max is ${MAX_KEY_LENGTH} chars.`,
        field: key,
      }
    }

    if (allowed && !allowed.has(key)) {
      return {
        type: 'validation',
        message: `Unknown chart param "${key}". Allowed: ${[...allowed].join(', ')}.`,
        field: key,
      }
    }

    const value = raw[key]

    // Reject nested objects / arrays — ClickHouse params are flat
    if (typeof value === 'object' && value !== null) {
      return {
        type: 'validation',
        message: `Param "${key}" must be a primitive (string, number, or boolean), not an object or array.`,
        field: key,
      }
    }

    if (value === null || value === undefined) {
      continue // skip nulls (treat as absent)
    }

    // String value bounds
    if (typeof value === 'string') {
      if (value.length > MAX_VALUE_STRING_LENGTH) {
        return {
          type: 'validation',
          message: `Param "${key}" value too long (${value.length} chars). Max is ${MAX_VALUE_STRING_LENGTH}.`,
          field: key,
        }
      }
      sanitized[key] = value
      continue
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return {
          type: 'validation',
          message: `Param "${key}" must be a finite number.`,
          field: key,
        }
      }
      sanitized[key] = value
      continue
    }

    if (typeof value === 'boolean') {
      sanitized[key] = value
      continue
    }

    // Unexpected type (bigint, symbol, function) — reject
    return {
      type: 'validation',
      message: `Param "${key}" has unsupported type "${typeof value}".`,
      field: key,
    }
  }

  return { type: 'ok', params: sanitized }
}
