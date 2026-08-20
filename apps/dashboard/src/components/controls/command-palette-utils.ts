/**
 * Pure helpers for the command palette's "Quick Navigation" feature.
 *
 * Kept free of React / DOM imports so the detection logic can be unit-tested in
 * isolation (bun:test) without rendering the dialog or mocking the router.
 */

const UUID_PATTERN =
  /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i
// At least 8 hex/dash chars AND at least one hex digit, so a string of only
// dashes ("--------") is never mistaken for a (partial) query id.
const UUID_PREFIX_PATTERN = /^(?=[a-f0-9-]{8,}$)(?=.*[a-f0-9])[a-f0-9-]+$/i
const TABLE_PATTERN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i

export interface QuickNavMatch {
  /** Looks like a (possibly partial) query/trace UUID. */
  isQueryId: boolean
  /** Looks like a `database.table` reference. */
  isTableName: boolean
  /** True when at least one quick-nav action applies. */
  hasMatch: boolean
}

/**
 * Classify raw palette input into the quick-navigation shortcuts it unlocks.
 * The input is trimmed before matching; empty input never matches.
 */
export function detectQuickNav(raw: string): QuickNavMatch {
  const value = raw.trim()
  const isQueryId =
    value.length > 0 &&
    (UUID_PATTERN.test(value) || UUID_PREFIX_PATTERN.test(value))
  // A `database.table` reference is matched on its own; a bare UUID must not be
  // misread as one (UUIDs contain no dot, so this is naturally exclusive).
  const isTableName = TABLE_PATTERN.test(value)
  return { isQueryId, isTableName, hasMatch: isQueryId || isTableName }
}

/**
 * cmdk `CommandItem.value` for a menu leaf. Includes the group title, page
 * title, href, description, and optional aliases so ⌘K can find pages by
 * route (`schema-diff`) or nickname (`ddl`, `ttl inventory`) as well as the
 * visible label.
 */
export function menuItemPaletteValue(
  item: {
    title: string
    href?: string
    description?: string
    keywords?: readonly string[]
  },
  groupTitle?: string
): string {
  return [
    groupTitle,
    item.title,
    item.href,
    item.description,
    ...(item.keywords ?? []),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
}

/**
 * Split a `database.table` reference into its parts. Only the first dot is
 * treated as the separator so table names containing dots are preserved.
 */
export function parseTableName(raw: string): {
  database: string
  table: string
} {
  const value = raw.trim()
  const dot = value.indexOf('.')
  if (dot === -1) return { database: value, table: '' }
  return { database: value.slice(0, dot), table: value.slice(dot + 1) }
}
