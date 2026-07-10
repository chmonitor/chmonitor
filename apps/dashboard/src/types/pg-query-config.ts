/**
 * `PgQueryConfig` — the Postgres analog of `QueryConfig`, kept deliberately
 * minimal and SEPARATE (issue #2450 / RFC #2264).
 *
 * `QueryConfig` bakes in ClickHouse specifics — `sql: string | VersionedSql[]`
 * versioned by ClickHouse version string, plus a direct `ClickHouseSettings`
 * import. Generalizing it to be engine-parametric would touch every existing
 * ClickHouse page for a benefit only Postgres needs, so instead we add this
 * small parallel type: a single read-only SQL string (run through the
 * `@chm/postgres-client` read-only query path), declarative column formatting,
 * and an optional `extensionCheck` — the Postgres analog of `tableCheck` for
 * optional ClickHouse system tables.
 */

/** How a column's raw value is formatted for display. */
export type PgColumnFormat =
  /** Locale-grouped integer (e.g. `12,345`). */
  | 'number'
  /** Milliseconds → `1.2s` / `340ms` via `formatDuration`. */
  | 'duration_ms'
  /** A value already in milliseconds, shown as `1,234 ms`. */
  | 'ms'
  /** Byte count → `1.2 MB` via `formatReadableSize`. */
  | 'bytes'
  /** A 0–100 number rendered as `98.4%`. */
  | 'percent'
  /** Monospaced code/SQL (truncated with expand). */
  | 'code'
  /** Plain text (default). */
  | 'text'

/** A single displayed column in a `PgQueryConfig`. */
export interface PgColumn {
  /** Row key this column reads (must exist in the SQL projection). */
  key: string
  /** Human header label. */
  label: string
  /** Value formatter; defaults to `text`. */
  format?: PgColumnFormat
  /**
   * When set, an inline share bar is drawn behind the cell using this row key,
   * which must project a 0–100 percentage (mirrors the ClickHouse
   * BackgroundBar `pct_*` convention).
   */
  barPctKey?: string
  /** Right-align numeric columns. Defaults from `format` when omitted. */
  align?: 'left' | 'right'
  /** Optional short header tooltip. */
  help?: string
}

/** A declarative Postgres data view. */
export interface PgQueryConfig {
  /** Stable registry key (also the `/api/v1/pg/query/:name` segment). */
  name: string
  /** Page/table title. */
  title: string
  /** One-line description shown under the title. */
  description?: string
  /** Optional external documentation link. */
  docs?: string
  /**
   * A SINGLE read-only SQL statement. Sent through
   * `@chm/postgres-client.queryPostgres`, which pins the session read-only,
   * gates to a single SELECT/WITH/…, and always uses the extended protocol.
   */
  sql: string
  /** Columns to render, in order. */
  columns: PgColumn[]
  /**
   * A Postgres extension that MUST be installed for this view to return data
   * (e.g. `pg_stat_statements`). When missing, the server returns an empty
   * result flagged `extensionMissing` and the page renders a graceful
   * "enable the extension" EmptyState instead of any raw Postgres error.
   */
  extensionCheck?: string
  /** When true, clicking a row opens the detail flyout. */
  rowClickable?: boolean
}
