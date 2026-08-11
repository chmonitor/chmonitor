/**
 * Pure parsers for ClickHouse HTTP response headers and JSONEachRow payloads.
 *
 * Extracted from `clickhouse-fetch.ts` — no I/O, no config, directly unit
 * testable.
 */

/**
 * Parse `read_bytes` out of the `X-ClickHouse-Summary` response header (always
 * sent by the ClickHouse HTTP interface, regardless of format). Returns
 * `undefined` when the header is absent/unparseable — or when the result set
 * itself doesn't carry response_headers, e.g. in unit tests that stub a
 * minimal client — so callers only ever see a genuine value, never a guess.
 */
export function parseReadBytesFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): number | undefined {
  const raw = headers?.['x-clickhouse-summary']
  const text = Array.isArray(raw) ? raw[0] : raw
  if (!text) return undefined

  try {
    const summary = JSON.parse(text) as { read_bytes?: string }
    const bytes = summary.read_bytes ? Number(summary.read_bytes) : undefined
    return bytes !== undefined && Number.isFinite(bytes) ? bytes : undefined
  } catch {
    return undefined
  }
}

/**
 * Parse `rows_before_limit_at_least` out of the `X-ClickHouse-Summary`
 * response header (#2490). ClickHouse sets this when a query hits
 * `max_result_rows` with `result_overflow_mode: 'break'` (or a plain LIMIT) —
 * it reports how many rows existed before the cap/limit truncated the result.
 * Returns `undefined` when absent/unparseable, mirroring
 * `parseReadBytesFromHeaders`.
 */
export function parseRowsBeforeLimitFromHeaders(
  headers: Record<string, string | string[] | undefined> | undefined
): number | undefined {
  const raw = headers?.['x-clickhouse-summary']
  const text = Array.isArray(raw) ? raw[0] : raw
  if (!text) return undefined

  try {
    const summary = JSON.parse(text) as {
      rows_before_limit_at_least?: string
    }
    const value = summary.rows_before_limit_at_least
      ? Number(summary.rows_before_limit_at_least)
      : undefined
    return value !== undefined && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Count non-empty lines in a JSONEachRow payload without allocating an array
 * of lines (these payloads can be large).
 */
export function countJsonEachRowRows(input: string): number {
  let rows = 0
  let hasContent = false

  for (let index = 0; index < input.length; index += 1) {
    const ch = input.charCodeAt(index)
    if (ch === 10) {
      if (hasContent) {
        rows += 1
        hasContent = false
      }
    } else if (ch !== 13 && ch !== 32 && ch !== 9) {
      hasContent = true
    }
  }

  if (hasContent) {
    rows += 1
  }

  return rows
}
