/**
 * Pure helpers for the command palette's "Quick Navigation" feature.
 *
 * Kept free of React / DOM imports so the detection logic can be unit-tested in
 * isolation (bun:test) without rendering the dialog or mocking the router.
 */

import { pageTitlesForHref } from '@/lib/page-title'

const UUID_PATTERN =
  /^[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}$/i
// At least 8 hex/dash chars AND at least one hex digit, so a string of only
// dashes ("--------") is never mistaken for a (partial) query id.
const UUID_PREFIX_PATTERN = /^(?=[a-f0-9-]{8,}$)(?=.*[a-f0-9])[a-f0-9-]+$/i
const TABLE_PATTERN = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i

export type PaletteTab = 'all' | 'pages' | 'databases' | 'tables' | 'actions'

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
 * cmdk `CommandItem.value` for a menu leaf. Includes the group title, sidebar
 * label, document `<title>` / OG headline, href, description, and optional
 * aliases so ⌘K can find pages by the tab title as well as the nav label.
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
    ...(item.href ? pageTitlesForHref(item.href) : []),
    item.href,
    item.description,
    ...(item.keywords ?? []),
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
}

/**
 * Inclusive `[start, end)` ranges in `text` that match any whitespace-separated
 * token from `query` (case-insensitive). Overlapping hits are merged so the
 * highlight renderer can walk the string once.
 */
export function matchRanges(
  text: string,
  query: string
): Array<[number, number]> {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
  if (tokens.length === 0 || text.length === 0) return []

  const lower = text.toLowerCase()
  const hits: Array<[number, number]> = []
  for (const token of tokens) {
    const needle = token.toLowerCase()
    if (needle.length === 0) continue
    let from = 0
    while (from <= lower.length - needle.length) {
      const index = lower.indexOf(needle, from)
      if (index === -1) break
      hits.push([index, index + needle.length])
      from = index + needle.length
    }
  }
  if (hits.length === 0) return []

  hits.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged: Array<[number, number]> = [[hits[0][0], hits[0][1]]]
  for (let i = 1; i < hits.length; i++) {
    const last = merged[merged.length - 1]
    const current = hits[i]
    if (current[0] <= last[1]) {
      last[1] = Math.max(last[1], current[1])
    } else {
      merged.push([current[0], current[1]])
    }
  }
  return merged
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
