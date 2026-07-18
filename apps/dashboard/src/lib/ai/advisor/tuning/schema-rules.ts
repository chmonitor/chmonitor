/**
 * Advisor auto fine-tune engine — schema lint rules.
 *
 * Pure functions over `ColumnProfile[]` (already gathered read-only by
 * `tuning-engine.ts`). Each rule returns `TuningFinding[]` — no I/O, fully
 * unit-testable with fixtures. Every finding is recommend-only: `ddl` is inert
 * text, and rules whose trigger is a metadata heuristic (rather than a measured
 * fact) attach a `verifyQuery` so the user can confirm before applying.
 *
 * Ranking currency is `estimatedBytesSaved` — an upper-bound projection from
 * column widths, always surfaced as an estimate.
 */

import type { ColumnProfile, TuningFinding } from './types'

import {
  formatQualifiedTable,
  quoteIdentifier,
} from '@/lib/ai/agent/tools/sql-analysis'
import { formatBytes } from '@/lib/utils'

/** Strip one wrapping type modifier, e.g. `Nullable(String)` → `String`. */
function unwrapType(type: string, wrapper: string): string | null {
  const m = new RegExp(`^${wrapper}\\((.+)\\)$`, 'i').exec(type.trim())
  return m ? m[1].trim() : null
}

function fullTable(c: ColumnProfile): string {
  return formatQualifiedTable(c.database, c.table)
}

/** uncompressed / compressed, or 0 when compressed is 0. */
export function compressionRatio(c: ColumnProfile): number {
  if (c.compressedBytes <= 0) return 0
  return c.uncompressedBytes / c.compressedBytes
}

function bytesEvidence(c: ColumnProfile): string {
  const ratio = compressionRatio(c)
  const ratioText =
    ratio > 0 ? `${ratio.toFixed(1)}x compression` : 'unknown compression'
  return `${formatBytes(c.compressedBytes)} on disk (${formatBytes(c.uncompressedBytes)} uncompressed, ${ratioText})${c.rows > 0 ? `, ${c.rows.toLocaleString()} rows` : ''}`
}

// ---------------------------------------------------------------------------
// Rule 1 — needless Nullable.
// ---------------------------------------------------------------------------

/**
 * Flag `Nullable(T)` columns as candidates for dropping the wrapper. Nullable
 * keeps a separate null-map subcolumn (one byte/row uncompressed) and blocks
 * some optimizations; when a column holds no NULLs the wrapper is pure
 * overhead. Whether it actually holds NULLs needs a data probe, so this is a
 * candidate with a `verifyQuery`. Ranked by the column's on-disk bytes (bigger
 * column ⇒ bigger win). Skips key columns (can't `MODIFY` those in place).
 */
export function ruleNullableColumns(columns: ColumnProfile[]): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const c of columns) {
    const inner = unwrapType(c.type, 'Nullable')
    if (!inner) continue

    // Null-map is ~1 byte/row uncompressed; it compresses well, so the on-disk
    // win is modest but real. Rank by it, floored at a fraction of the column
    // size so large columns still sort above tiny ones.
    const nullMapBytes = c.rows > 0 ? c.rows : c.uncompressedBytes
    const estimatedBytesSaved = Math.max(
      Math.round(nullMapBytes / 20),
      Math.round(c.compressedBytes * 0.02)
    )

    findings.push({
      ruleId: 'nullable_column',
      category: 'schema',
      title: `Drop Nullable from ${c.database}.${c.table}.${c.name}`,
      target: `${c.database}.${c.table}.${c.name}`,
      rationale: `\`${c.name}\` is \`${c.type}\`. Nullable stores a separate null-map subcolumn (one byte per row uncompressed) and prevents some read optimizations. If the column never holds NULLs, the wrapper is pure overhead.`,
      evidence: bytesEvidence(c),
      estimatedBenefit: `Estimated: removes the null-map subcolumn (~${formatBytes(nullMapBytes)} uncompressed). This is an ESTIMATE — the exact win depends on how the null-map compresses. Only valid if the column truly holds no NULLs.`,
      estimatedBytesSaved,
      severity: 'low',
      ddl: `ALTER TABLE ${fullTable(c)} MODIFY COLUMN ${quoteIdentifier(c.name)} ${inner};`,
      verifyQuery: `SELECT count() AS null_rows FROM ${fullTable(c)} WHERE ${quoteIdentifier(c.name)} IS NULL;`,
      risk: 'medium',
      riskNote:
        'Dropping Nullable rewrites the column and FAILS if any NULLs exist — run the verify query first (it must return 0). MODIFY COLUMN mutates the table (a background mutation); schedule it off-peak.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule 2 — oversized integers.
// ---------------------------------------------------------------------------

/** Ordered widest→narrowest so we can propose the next step down. */
const INT_WIDTHS: Record<string, number> = {
  Int8: 1,
  UInt8: 1,
  Int16: 2,
  UInt16: 2,
  Int32: 4,
  UInt32: 4,
  Int64: 8,
  UInt64: 8,
  Int128: 16,
  UInt128: 16,
  Int256: 32,
  UInt256: 32,
}

/** The one-step-narrower type of the same signedness, or null if already smallest. */
export function narrowerInt(type: string): string | null {
  const order = [
    ['Int64', 'Int32'],
    ['Int32', 'Int16'],
    ['Int16', 'Int8'],
    ['UInt64', 'UInt32'],
    ['UInt32', 'UInt16'],
    ['UInt16', 'UInt8'],
    ['Int128', 'Int64'],
    ['UInt128', 'UInt64'],
    ['Int256', 'Int128'],
    ['UInt256', 'UInt128'],
  ]
  const found = order.find(([wide]) => wide === type)
  return found ? found[1] : null
}

/**
 * Flag wide integer columns (Int32 and up) as candidates for a narrower type.
 * We cannot read the observed min/max from system tables cheaply, so this is a
 * candidate with a `verifyQuery` (`min`/`max`) — apply only if the real range
 * fits the narrower type. Ranked by projected uncompressed width saved
 * (`rows * bytesPerRowSaved`).
 */
export function ruleOversizedIntegers(
  columns: ColumnProfile[]
): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const c of columns) {
    // Only bare integer types — not wrapped (Nullable/LowCardinality) or
    // Array/Map/etc. Those are handled by other rules or out of scope.
    const width = INT_WIDTHS[c.type.trim()]
    if (!width || width < 4) continue
    const narrower = narrowerInt(c.type.trim())
    if (!narrower) continue

    const bytesPerRowSaved = width - INT_WIDTHS[narrower]
    const estimatedBytesSaved =
      c.rows > 0
        ? Math.round(c.rows * bytesPerRowSaved)
        : Math.round(c.uncompressedBytes / 2)

    findings.push({
      ruleId: 'oversized_integer',
      category: 'schema',
      title: `Consider narrowing ${c.database}.${c.table}.${c.name} (${c.type} → ${narrower})`,
      target: `${c.database}.${c.table}.${c.name}`,
      rationale: `\`${c.name}\` is \`${c.type}\` (${width} bytes/row). If the observed value range fits \`${narrower}\` (${INT_WIDTHS[narrower]} bytes/row), the narrower type stores the same data in less space and compresses at least as well.`,
      evidence: `${bytesEvidence(c)} — ${bytesPerRowSaved} bytes/row narrower if the range fits`,
      estimatedBenefit: `Estimated: up to ~${formatBytes(estimatedBytesSaved)} uncompressed saved (${bytesPerRowSaved} bytes/row × rows). This is an ESTIMATE and only valid if every value fits \`${narrower}\` — confirm with the verify query.`,
      estimatedBytesSaved,
      severity: 'low',
      ddl: `ALTER TABLE ${fullTable(c)} MODIFY COLUMN ${quoteIdentifier(c.name)} ${narrower};`,
      verifyQuery: `SELECT min(${quoteIdentifier(c.name)}) AS min_v, max(${quoteIdentifier(c.name)}) AS max_v FROM ${fullTable(c)};`,
      risk: 'medium',
      riskNote:
        'Narrowing an integer type mutates the column and OVERFLOWS silently if any value is out of the target range — verify min/max fit the narrower type first. MODIFY COLUMN runs a background mutation; schedule off-peak.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule 3 — compression codec opportunities.
// ---------------------------------------------------------------------------

const TIMESERIES_TYPE = /^(Date|DateTime|DateTime64)/i
const FLOAT_TYPE = /^(Float32|Float64)$/i

/** True when the column has no explicit codec (uses the table/server default). */
function usesDefaultCodec(c: ColumnProfile): boolean {
  return c.compressionCodec.trim() === ''
}

/**
 * Flag columns that would benefit from an explicit codec:
 *  - Date/DateTime/metric columns on the default codec → DoubleDelta/Gorilla
 *    (+ ZSTD) which are purpose-built for monotonic timestamps / slowly-moving
 *    numerics.
 *  - Any sizable column compressing poorly (ratio < 3x) on the default codec
 *    → ZSTD, which usually beats LZ4 on ratio.
 * Ranked by on-disk bytes (the pool a better codec shrinks).
 */
export function ruleCompressionCodec(
  columns: ColumnProfile[],
  minBytes = 1_000_000
): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const c of columns) {
    if (c.compressedBytes < minBytes) continue
    if (!usesDefaultCodec(c)) continue

    const ratio = compressionRatio(c)
    const isTimeseries = TIMESERIES_TYPE.test(c.type) || FLOAT_TYPE.test(c.type)
    const poorlyCompressed = ratio > 0 && ratio < 3

    if (!isTimeseries && !poorlyCompressed) continue

    const codec = isTimeseries
      ? FLOAT_TYPE.test(c.type)
        ? 'CODEC(Gorilla, ZSTD(1))'
        : 'CODEC(DoubleDelta, ZSTD(1))'
      : 'CODEC(ZSTD(3))'
    // Conservative projected win: timeseries codecs commonly reach 2-4x beyond
    // LZ4; ZSTD-over-poorly-compressing ~1.3-2x. Take a modest fraction of the
    // current on-disk size as the ranking figure (labelled an estimate).
    const savedFraction = isTimeseries ? 0.4 : 0.25
    const estimatedBytesSaved = Math.round(c.compressedBytes * savedFraction)

    findings.push({
      ruleId: 'compression_codec',
      category: 'schema',
      title: `Add a compression codec to ${c.database}.${c.table}.${c.name}`,
      target: `${c.database}.${c.table}.${c.name}`,
      rationale: isTimeseries
        ? `\`${c.name}\` is \`${c.type}\` on the default codec (LZ4). ${FLOAT_TYPE.test(c.type) ? 'Gorilla' : 'Delta/DoubleDelta'} + ZSTD is purpose-built for ${FLOAT_TYPE.test(c.type) ? 'slowly-changing numeric' : 'monotonic timestamp'} data and typically compresses it far better than LZ4.`
        : `\`${c.name}\` compresses at only ${ratio.toFixed(1)}x on the default codec (LZ4). ZSTD usually reaches a higher ratio for the same data at read cost that is negligible for a monitoring workload.`,
      evidence: bytesEvidence(c),
      estimatedBenefit: `Estimated: ~${formatBytes(estimatedBytesSaved)} on-disk saved (a conservative ${Math.round(savedFraction * 100)}% of current size). This is an ESTIMATE — real codec gains depend on the data; measure on a copy before rolling out.`,
      estimatedBytesSaved,
      severity: 'low',
      ddl: `ALTER TABLE ${fullTable(c)} MODIFY COLUMN ${quoteIdentifier(c.name)} ${c.type} ${codec};`,
      risk: 'low',
      riskNote:
        'Changing a codec only affects newly written/merged parts unless you rewrite existing data (OPTIMIZE ... FINAL or a mutation), which is I/O-heavy. Results are unchanged; codec choice never affects correctness.',
    })
  }
  return findings
}

// ---------------------------------------------------------------------------
// Rule 4 — LowCardinality candidates.
// ---------------------------------------------------------------------------

/**
 * Flag plain `String` / `FixedString` columns (not already LowCardinality) as
 * LowCardinality candidates. The real win depends on the distinct ratio, which
 * needs a data probe, so this is a candidate with a `verifyQuery`
 * (`uniqExact/count`). Ranked by on-disk bytes.
 */
export function ruleLowCardinality(
  columns: ColumnProfile[],
  minBytes = 1_000_000
): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const c of columns) {
    if (c.compressedBytes < minBytes) continue
    const t = c.type.trim()
    const isPlainString = /^String$/i.test(t) || /^FixedString\(/i.test(t)
    if (!isPlainString) continue
    if (/LowCardinality/i.test(t)) continue

    // LowCardinality dictionary-encodes; a low distinct ratio yields large
    // wins. Use a conservative 30% of on-disk size as the ranking figure.
    const estimatedBytesSaved = Math.round(c.compressedBytes * 0.3)

    findings.push({
      ruleId: 'low_cardinality',
      category: 'schema',
      title: `Consider LowCardinality for ${c.database}.${c.table}.${c.name}`,
      target: `${c.database}.${c.table}.${c.name}`,
      rationale: `\`${c.name}\` is \`${c.type}\`. If it has few distinct values relative to its row count, wrapping it in LowCardinality dictionary-encodes the values — usually a large storage and query-speed win.`,
      evidence: bytesEvidence(c),
      estimatedBenefit: `Estimated: up to ~${formatBytes(estimatedBytesSaved)} on-disk saved when the distinct ratio is low. This is an ESTIMATE — confirm the column is low-cardinality with the verify query (rule of thumb: fewer than ~100k distinct values, ratio well under 10%).`,
      estimatedBytesSaved,
      severity: 'low',
      ddl: `ALTER TABLE ${fullTable(c)} MODIFY COLUMN ${quoteIdentifier(c.name)} LowCardinality(${t});`,
      verifyQuery: `SELECT uniqExact(${quoteIdentifier(c.name)}) AS distinct_values, count() AS rows, round(uniqExact(${quoteIdentifier(c.name)}) / count(), 4) AS distinct_ratio FROM ${fullTable(c)};`,
      risk: 'low',
      riskNote:
        'LowCardinality HURTS for high-cardinality columns (dictionary overhead exceeds the saving) — only apply when the verify query shows a low distinct ratio. MODIFY COLUMN runs a background mutation.',
    })
  }
  return findings
}

/** Run every schema lint rule over the columns. */
export function runSchemaRules(columns: ColumnProfile[]): TuningFinding[] {
  return [
    ...ruleNullableColumns(columns),
    ...ruleOversizedIntegers(columns),
    ...ruleCompressionCodec(columns),
    ...ruleLowCardinality(columns),
  ]
}
