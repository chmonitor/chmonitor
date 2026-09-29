/**
 * The one merge helper for health definitions (#3497).
 *
 * Implements "The merge contract" in
 * docs/knowledge/metadata-db-optional-config.md, once, for all seven
 * read-only definition stores:
 *
 * - Every source is always read. Precedence (d1 > file > env) only decides
 *   who wins a key; it never decides which sources are consulted.
 * - `union`: every key from every source appears; on a collision the higher
 *   source wins field by field, so a file can set `enabled` while D1 owns a
 *   token and the merged entry keeps both.
 * - `time-union`: every entry from every source appears; a shared key is
 *   replaced whole by the higher source. Used for maintenance windows, where
 *   mixing `startsAt` from one source with `endsAt` from another is wrong.
 * - `single`: the highest source that names the key wins outright.
 *
 * A key that only a lower source defines disappears when that source stops
 * defining it — there is no tombstone.
 *
 * Pure: no I/O, no logging.
 */

/** Where a definition came from, lowest precedence first. */
export type HealthDefinitionSource = 'env' | 'file' | 'd1'

export const HEALTH_SOURCE_PRECEDENCE: readonly HealthDefinitionSource[] = [
  'env',
  'file',
  'd1',
]

export type MergeShape = 'union' | 'time-union' | 'single'

export interface SourceLayer<T> {
  source: HealthDefinitionSource
  entries: readonly T[]
}

/** A merged entry, tagged with the highest source that contributed to it. */
export type Sourced<T> = T & { source: HealthDefinitionSource }

/**
 * Whether a field value "says something". `undefined`, `null`, `''`, and an
 * empty plain object do not, so a D1 row whose secret column is empty keeps
 * the file's secret (the store's write-only secret convention), and a D1 row
 * with `target: {}` keeps the file's target. Known limit: a higher source
 * cannot clear a lower source's value back to null (e.g. a D1 `minSeverity:
 * null` does not undo a file's `warning` floor).
 */
function isSet(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === 0
  ) {
    return false
  }
  return true
}

function mergeFields<T extends object>(lower: T, higher: T): T {
  const out = { ...lower } as Record<string, unknown>
  for (const [field, value] of Object.entries(higher)) {
    if (isSet(value) || !(field in out)) out[field] = value
  }
  return out as T
}

/**
 * Merge keyed entries from several sources. `layers` may come in any order;
 * they are applied by {@link HEALTH_SOURCE_PRECEDENCE}. Output order: keys in
 * first-seen order, walking from the highest source down, so D1 rows keep
 * their query order and declarative entries follow.
 */
export function mergeSources<T extends object>(
  layers: readonly SourceLayer<T>[],
  keyFn: (entry: T) => string,
  shape: MergeShape
): Sourced<T>[] {
  const rank = (s: HealthDefinitionSource) =>
    HEALTH_SOURCE_PRECEDENCE.indexOf(s)
  const ordered = [...layers].sort((a, b) => rank(a.source) - rank(b.source))

  const merged = new Map<string, Sourced<T>>()
  for (const layer of ordered) {
    for (const entry of layer.entries) {
      const key = keyFn(entry)
      const existing = merged.get(key)
      const next =
        existing && shape === 'union'
          ? mergeFields<T>(existing, entry)
          : { ...entry }
      merged.set(key, { ...next, source: layer.source })
    }
  }

  // Walk the keys highest-source-first for a stable, D1-first order.
  const out: Sourced<T>[] = []
  const seen = new Set<string>()
  for (const layer of [...ordered].reverse()) {
    for (const entry of layer.entries) {
      const key = keyFn(entry)
      if (seen.has(key)) continue
      seen.add(key)
      const value = merged.get(key)
      if (value) out.push(value)
    }
  }
  return out
}
