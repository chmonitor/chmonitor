/**
 * The query attribution record (issue #4164): who and what sent a dashboard
 * query, attached to every request so `system.query_log` can answer audit and
 * usage questions.
 *
 * Two carriers, built from one record:
 * - `log_comment` setting (primary). Compact JSON in its own query_log column,
 *   read back with `JSONExtractString(log_comment, 'user')`.
 * - a leading SQL comment (optional). Visible in `system.processes` and server
 *   logs that do not carry settings. Built from a safe character set only.
 *
 * Every value here can come from a request header, so both encoders treat
 * fields as untrusted text.
 */

export const ATTRIBUTION_APP = 'chmonitor'

/** Bump when a field changes meaning; the usage page reads `v`. */
export const ATTRIBUTION_SCHEMA_VERSION = 1

/** Upper bound for the encoded `log_comment`, in UTF-8 bytes. */
export const MAX_LOG_COMMENT_BYTES = 1024

/** Upper bound for one field before encoding. */
const MAX_FIELD_CHARS = 200

export interface AttributionRecord {
  readonly app: typeof ATTRIBUTION_APP
  readonly v: typeof ATTRIBUTION_SCHEMA_VERSION
  /** App version and build SHA, e.g. `0.3.0+f679398`. */
  readonly version: string | null
  /** Authenticated principal subject; `null` for anonymous and cron. */
  readonly user: string | null
  /** Principal email; present only when the operator opted in. */
  readonly email?: string
  /** Configured host name (`CLICKHOUSE_NAME` entry). */
  readonly host: string | null
  /** What issued the query: `chart:<name>`, `table:<name>`, `console`, `agent`, `cron:<job>`, … */
  readonly source: string | null
  /** Dashboard page the request came from, e.g. `/overview`. */
  readonly page?: string
  /** Free-form deployment label from config. */
  readonly label?: string
}

export interface AttributionInput {
  readonly version: string | null
  readonly user: string | null
  readonly email: string | null
  readonly host: string | null
  readonly source: string | null
  readonly page: string | null
  readonly label: string | null
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g

function clean(value: string | null | undefined): string | null {
  if (value == null) return null
  const text = value.replace(CONTROL_CHARS, '').trim().slice(0, MAX_FIELD_CHARS)
  return text.length > 0 ? text : null
}

export function buildAttributionRecord(
  input: AttributionInput
): AttributionRecord {
  const email = clean(input.email)
  const page = clean(input.page)
  const label = clean(input.label)
  return {
    app: ATTRIBUTION_APP,
    v: ATTRIBUTION_SCHEMA_VERSION,
    version: clean(input.version),
    user: clean(input.user),
    ...(email ? { email } : {}),
    host: clean(input.host),
    source: clean(input.source),
    ...(page ? { page } : {}),
    ...(label ? { label } : {}),
  }
}

const utf8 = new TextEncoder()

function fits(json: string): boolean {
  return utf8.encode(json).length <= MAX_LOG_COMMENT_BYTES
}

/**
 * JSON for the `log_comment` setting, at most {@link MAX_LOG_COMMENT_BYTES}.
 *
 * Fields are already capped, so overflow only comes from many long multi-byte
 * values. Optional fields go first (label, page, email); the identity fields
 * stay, shortened, so the output is always valid JSON.
 */
export function encodeLogComment(record: AttributionRecord): string {
  let current: AttributionRecord = record
  let json = JSON.stringify(current)
  for (const key of ['label', 'page', 'email'] as const) {
    if (fits(json)) return json
    const { [key]: _dropped, ...rest } = current
    current = rest as AttributionRecord
    json = JSON.stringify(current)
  }
  for (let chars = MAX_FIELD_CHARS; !fits(json) && chars > 0; chars >>= 1) {
    current = {
      ...current,
      version: current.version?.slice(0, chars) ?? null,
      user: current.user?.slice(0, chars) ?? null,
      host: current.host?.slice(0, chars) ?? null,
      source: current.source?.slice(0, chars) ?? null,
    }
    json = JSON.stringify(current)
  }
  return json
}

/**
 * Anything outside this set becomes `_`. It has no `*`, so neither `*` + `/`
 * (end of comment) nor `/` + `*` (a nested comment, which ClickHouse supports)
 * can form, and no whitespace or quotes.
 */
const SQL_COMMENT_UNSAFE = /[^A-Za-z0-9._:@/=,+-]/g
const MAX_SQL_COMMENT_VALUE = 64

function sqlSafe(value: string): string {
  return value.replace(SQL_COMMENT_UNSAFE, '_').slice(0, MAX_SQL_COMMENT_VALUE)
}

/** `/* chmonitor v=1 user=jane source=console *\/` plus a newline. */
export function encodeSqlComment(record: AttributionRecord): string {
  const pairs: string[] = [`v=${record.v}`]
  const fields: ReadonlyArray<[string, string | null | undefined]> = [
    ['version', record.version],
    ['user', record.user],
    ['host', record.host],
    ['source', record.source],
    ['page', record.page],
    ['label', record.label],
  ]
  for (const [key, value] of fields) {
    if (value) pairs.push(`${key}=${sqlSafe(value)}`)
  }
  return `/* ${ATTRIBUTION_APP} ${pairs.join(' ')} */\n`
}
