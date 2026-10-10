import type { FilterField, FilterSchema } from './types'

import { isVersionOlder } from '@/lib/card-error-utils'

/** True when the field may be offered on a server running `serverVersion`. */
function isFieldAvailable(field: FilterField, serverVersion?: string): boolean {
  if (!field.since) return true
  // Version unknown (still loading, or host-status failed): hide gated fields
  // rather than offer a filter on a column the server may not have.
  if (!serverVersion) return false
  return !isVersionOlder(serverVersion, field.since)
}

/**
 * Drop fields (and the presets / quick filters that reference them) whose
 * `since` is newer than the server. Returns the same object when nothing is
 * gated, so unaffected pages keep a stable reference.
 */
export function filterSchemaForVersion(
  schema: FilterSchema,
  serverVersion?: string
): FilterSchema {
  const fields = schema.fields.filter((f) => isFieldAvailable(f, serverVersion))
  if (fields.length === schema.fields.length) return schema

  const keys = new Set(fields.map((f) => f.key))
  return {
    ...schema,
    fields,
    presets: schema.presets?.filter((p) =>
      p.filters.every((f) => keys.has(f.key))
    ),
    quickFilters: schema.quickFilters?.filter((q) => keys.has(q.key)),
  }
}
