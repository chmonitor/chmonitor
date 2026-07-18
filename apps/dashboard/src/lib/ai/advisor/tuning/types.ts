/**
 * Advisor auto fine-tune engine — shared types.
 *
 * A *schema-scoped* companion to the query-scoped `recommendation-engine.ts`:
 * instead of analyzing one SQL statement, it scans a database's columns
 * (`system.columns` + `system.parts`) and server/merge-tree settings
 * (`system.settings` / `system.merge_tree_settings`) and emits ranked,
 * recommend-only tuning findings — schema lint rules ranked by on-disk bytes,
 * plus settings tuning vs defaults with rationale. See issue #2764.
 *
 * ABSOLUTE INVARIANT: recommend-only. Nothing under `tuning/` executes,
 * applies, or mutates anything — the engine issues read-only metadata queries
 * only and every finding's `ddl` is inert text for the user to review and run
 * themselves. The rule functions are pure (no I/O), so they are unit-testable
 * with fixtures the same way `recommendation-engine.ts`'s scorers are.
 */

export type TuningCategory = 'schema' | 'settings'

export type TuningRuleId =
  | 'nullable_column'
  | 'oversized_integer'
  | 'compression_codec'
  | 'low_cardinality'
  | 'setting_tuning'

export type TuningSeverity = 'high' | 'medium' | 'low'

/**
 * One column, aggregated across active parts. `compressedBytes` /
 * `uncompressedBytes` come straight from `system.columns` (already summed over
 * parts); `rows` is the table's active row count (same for every column of a
 * table), used to project per-row width savings.
 */
export interface ColumnProfile {
  database: string
  table: string
  name: string
  /** Full ClickHouse type string, e.g. `Nullable(String)`, `UInt64`, `LowCardinality(String)`. */
  type: string
  /** `compression_codec` from system.columns — empty string means table/server default (LZ4). */
  compressionCodec: string
  compressedBytes: number
  uncompressedBytes: number
  /** Active rows in the owning table (0 when unknown). */
  rows: number
}

/**
 * One setting row from `system.settings` or `system.merge_tree_settings`,
 * normalized. `changed` reflects whether the value differs from the built-in
 * default.
 */
export interface SettingRow {
  name: string
  value: string
  changed: boolean
  /** Built-in default value (`default` column). Empty when unknown. */
  default: string
  source: 'settings' | 'merge_tree_settings'
}

export interface TuningFinding {
  ruleId: TuningRuleId
  category: TuningCategory
  /** Short imperative headline, e.g. "Drop Nullable from `events.user_id`". */
  title: string
  /** Fully-qualified subject: `db.table.column` for schema, setting name for settings. */
  target: string
  /** Why this was flagged. */
  rationale: string
  /** Concrete measured facts backing the finding (bytes, rows, ratios). */
  evidence: string
  /** Honest, explicitly-labelled-as-estimate benefit text. */
  estimatedBenefit: string
  /**
   * Byte figure used for ranking schema findings (bigger = higher). An
   * ESTIMATE — an upper bound projected from column widths, never a measured
   * result. 0 for settings findings (ranked by severity instead).
   */
  estimatedBytesSaved: number
  severity: TuningSeverity
  /** Ready-to-review statement. NEVER executed — the user runs it themselves. */
  ddl: string
  /**
   * Optional read-only query to confirm the finding before applying its DDL
   * (e.g. count NULLs, observe an integer's real range, measure distinct
   * ratio). Present when the rule's trigger is a heuristic over metadata that
   * a cheap data probe would confirm.
   */
  verifyQuery?: string
  risk: TuningSeverity
  riskNote: string
}

export interface TuningReportOk {
  ok: true
  /** Discriminator the chat tool-output renderer keys off to show the panel. */
  type: 'schema_tuning_findings'
  database: string
  /** Present when a single table was scanned; omitted for a whole-database scan. */
  table?: string
  findings: TuningFinding[]
  notes: string[]
}

export interface TuningReportError {
  ok: false
  error: string
}

export type TuningReport = TuningReportOk | TuningReportError
