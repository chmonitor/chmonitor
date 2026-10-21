/**
 * Best-effort EXPLAIN probing of sampled `system.query_log` text.
 *
 * A sampled query is not always valid to prepend `EXPLAIN` to, and the failure
 * is deterministic. This module holds the pure pieces the insights collector
 * uses to avoid re-sending SQL that is known not to work: a bounded in-memory
 * TTL memory of failed query hashes, and a prep step that drops samples that
 * cannot be analysed and cleans the ones that can.
 */

/** How long a failed hash is skipped before it is probed again. */
export const FAILED_PROBE_TTL_MS = 24 * 60 * 60 * 1000

/** Most failed hashes remembered; the oldest entry is evicted past this. */
export const FAILED_PROBE_MAX_ENTRIES = 300

/**
 * `log_queries_cut_to_length` default. `system.query_log.query` is cut to this
 * many characters, so a sample at or above it is truncated SQL.
 */
export const QUERY_LOG_CUT_LENGTH = 100_000

export interface FailedProbeMemory {
  has(hash: string): boolean
  add(hash: string): void
  readonly size: number
}

export function createFailedProbeMemory(
  options: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}
): FailedProbeMemory {
  const {
    ttlMs = FAILED_PROBE_TTL_MS,
    maxEntries = FAILED_PROBE_MAX_ENTRIES,
    now = Date.now,
  } = options
  // A Map iterates in insertion order and every entry gets the same TTL, so
  // the first key is always the one that expires first.
  const expiresAt = new Map<string, number>()

  function prune(): void {
    const t = now()
    for (const [hash, expiry] of expiresAt) {
      if (expiry > t) break
      expiresAt.delete(hash)
    }
  }

  return {
    has(hash) {
      prune()
      return expiresAt.has(hash)
    },
    add(hash) {
      prune()
      expiresAt.delete(hash)
      expiresAt.set(hash, now() + ttlMs)
      while (expiresAt.size > maxEntries) {
        const oldest = expiresAt.keys().next().value
        if (oldest === undefined) break
        expiresAt.delete(oldest)
      }
    },
    get size() {
      prune()
      return expiresAt.size
    },
  }
}

/**
 * Make a sampled query text safe to prepend `EXPLAIN` to: drop trailing `;`
 * and a trailing `FORMAT <name>` clause. Returns `null` for text that cannot be
 * analysed (empty, or cut by `log_queries_cut_to_length`).
 */
export function prepareSampleSql(sample: string): string | null {
  if (sample.length >= QUERY_LOG_CUT_LENGTH) return null
  let sql = sample.trim()
  for (;;) {
    const next = sql
      .replace(/;+\s*$/, '')
      .replace(/\s+FORMAT\s+[A-Za-z0-9_]+\s*$/i, '')
      .trim()
    if (next === sql) break
    sql = next
  }
  return sql.length > 0 ? sql : null
}

/** ClickHouse codes whose failure repeats for the same SQL text. */
const DETERMINISTIC_ERROR_CODES = new Set([
  62, // SYNTAX_ERROR
  47, // UNKNOWN_IDENTIFIER
  60, // UNKNOWN_TABLE
  80, // INCORRECT_QUERY
  81, // UNKNOWN_DATABASE
  36, // BAD_ARGUMENTS
  48, // NOT_IMPLEMENTED
  184, // ILLEGAL_AGGREGATION
])

const DETERMINISTIC_ERROR_TYPES =
  /\((SYNTAX_ERROR|UNKNOWN_IDENTIFIER|UNKNOWN_TABLE|INCORRECT_QUERY|UNKNOWN_DATABASE|BAD_ARGUMENTS|NOT_IMPLEMENTED|ILLEGAL_AGGREGATION)\)/

/**
 * True when an EXPLAIN failure is a property of the SQL text (so it is safe to
 * remember the hash). Timeouts, unreachable hosts and the `readonly` setting
 * refusal (code 164) are not: they say nothing about the query.
 */
export function isDeterministicQueryError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  const code = message.match(/\bCode:\s*(\d+)/)?.[1]
  if (code !== undefined) return DETERMINISTIC_ERROR_CODES.has(Number(code))
  return (
    /\bSyntax error\b/i.test(message) || DETERMINISTIC_ERROR_TYPES.test(message)
  )
}
