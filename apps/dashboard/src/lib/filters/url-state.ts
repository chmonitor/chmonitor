/**
 * Translate filter state between the URL and {@link ActiveFilter} objects.
 *
 * URL encoding: one query param per field, named after the field `key`, with
 * the value `operator:rawValue` (e.g. `?user=in:default,monitoring`). A bare
 * value without a recognized operator prefix (e.g. a legacy `?user=default`)
 * falls back to the field's default operator.
 */

import type {
  ActiveFilter,
  FilterField,
  FilterSchema,
} from '@/lib/filters/types'

import {
  isFilterOperator,
  isMultiValueOperator,
  isRangeOperator,
} from '@/lib/filters/operators'

/** Minimal read interface satisfied by URLSearchParams. */
export type ReadableParams = Pick<URLSearchParams, 'get' | 'has'>

/** Split a stored value into individual entries based on the operator arity. */
function splitValues(
  operator: ActiveFilter['operator'],
  raw: string
): string[] {
  if (isMultiValueOperator(operator) || isRangeOperator(operator)) {
    return raw.split(',')
  }
  return [raw]
}

/** Join multiple values into the single string stored in the URL. */
function joinValues(values: string[]): string {
  return values.join(',')
}

/**
 * Parse a single `operator:value` URL fragment for one field. A fragment
 * without a known operator prefix is treated as a bare value using the
 * field's default operator (backward compatible with plain params).
 */
export function parseFilterValue(
  field: FilterField,
  raw: string
): ActiveFilter | null {
  const defaultOperator = field.operators[0]
  let operator = defaultOperator
  let valuePart = raw

  const colonIndex = raw.indexOf(':')
  if (colonIndex > 0) {
    const candidate = raw.slice(0, colonIndex)
    if (isFilterOperator(candidate)) {
      operator = candidate
      valuePart = raw.slice(colonIndex + 1)
    }
  }

  // An operator the field does not allow falls back to the default.
  if (!field.operators.includes(operator)) {
    operator = defaultOperator
  }

  const values = splitValues(operator, valuePart)
    .map((v) => v.trim())
    .filter((v) => v.length > 0)
  if (values.length === 0) return null

  return { key: field.key, operator, values }
}

/**
 * Build the list of active filters for a schema from URL params.
 *
 * For each field: an explicit param value is parsed; an explicit empty value
 * (`?key=`) means "cleared"; a missing param falls back to the field's
 * `defaultValue` when present.
 */
export function parseFiltersFromParams(
  schema: FilterSchema,
  params: ReadableParams
): ActiveFilter[] {
  const filters: ActiveFilter[] = []

  for (const field of schema.fields) {
    if (params.has(field.key)) {
      const raw = params.get(field.key) ?? ''
      if (raw.trim().length === 0) continue // explicitly cleared
      const parsed = parseFilterValue(field, raw)
      if (parsed) filters.push(parsed)
    } else if (field.defaultValue) {
      const parsed = parseFilterValue(
        field,
        `${field.defaultValue.operator}:${field.defaultValue.value}`
      )
      if (parsed) filters.push(parsed)
    }
  }

  return filters
}

/** Serialize one active filter into its `operator:value` URL fragment. */
export function serializeFilter(filter: ActiveFilter): string {
  return `${filter.operator}:${joinValues(filter.values)}`
}

/**
 * Serialize active filters into a plain record (`{ key: "operator:value" }`),
 * suitable for passing as table search params.
 */
export function serializeActiveFilters(
  filters: ActiveFilter[]
): Record<string, string> {
  const record: Record<string, string> = {}
  for (const filter of filters) {
    record[filter.key] = serializeFilter(filter)
  }
  return record
}
