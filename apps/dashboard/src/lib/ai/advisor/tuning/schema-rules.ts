/**
 * Advisor tuning engine: column lint rules over `ColumnProfile[]`. Pure and
 * recommend-only; rules triggered by a metadata heuristic attach a
 * `verifyQuery`. Ranked by `estimatedBytesSaved`, an upper-bound estimate.
 */

import type { ColumnProfile, TuningFinding } from './types'

import {
  formatQualifiedTable,
  quoteIdentifier,
} from '@/lib/ai/agent/tools/sql-analysis'
import { formatBytes } from '@/lib/utils'

function unwrapType(type: string, wrapper: string): string | null {
  const m = new RegExp(`^${wrapper}\\((.+)\\)$`, 'i').exec(type.trim())
  return m ? m[1].trim() : null
}

function fullTable(c: ColumnProfile): string {
  return formatQualifiedTable(c.database, c.table)
}

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

const TIMESERIES_TYPE = /^(Date|DateTime|DateTime64)/i
const FLOAT_TYPE = /^(Float32|Float64)$/i

function usesDefaultCodec(c: ColumnProfile): boolean {
  return c.compressionCodec.trim() === ''
}

// Conservative ceilings for what a better codec typically reaches. They only
// bound the headroom above the column's MEASURED current ratio; real gains
// depend on the data.
const TIMESERIES_TARGET_RATIO = 6
const GENERIC_TARGET_RATIO = 4
const MAX_SAVED_FRACTION = 0.4
const MIN_SAVED_FRACTION = 0.05
// Used only when the column has no byte counts to measure a ratio from.
const FALLBACK_TIMESERIES_FRACTION = 0.4
const FALLBACK_GENERIC_FRACTION = 0.25

const INTEGER_LIKE_TYPE =
  /^(U?Int(8|16|32|64|128|256)|Date|Date32|DateTime|DateTime64|Decimal\d*|IPv4)\b/i

/** Strip `Nullable(...)` / `LowCardinality(...)` wrappers to the storage type. */
function baseType(type: string): string {
  let t = type.trim()
  for (;;) {
    const inner = unwrapType(t, 'Nullable') ?? unwrapType(t, 'LowCardinality')
    if (inner === null) return t
    t = inner
  }
}

/**
 * Fraction of the current on-disk size a better codec might save, derived from
 * the column's measured ratio (`uncompressed / compressed`): headroom up to a
 * conservative target ratio, capped. Falls back to a fixed guess only when the
 * column has no byte counts. `measured` tells the caller which one it got.
 */
function projectedSavedFraction(
  c: ColumnProfile,
  isTimeseries: boolean
): { fraction: number; measured: boolean } {
  const ratio = compressionRatio(c)
  if (ratio <= 0) {
    return {
      fraction: isTimeseries
        ? FALLBACK_TIMESERIES_FRACTION
        : FALLBACK_GENERIC_FRACTION,
      measured: false,
    }
  }
  const target = isTimeseries ? TIMESERIES_TARGET_RATIO : GENERIC_TARGET_RATIO
  return {
    fraction: Math.min(MAX_SAVED_FRACTION, Math.max(0, 1 - ratio / target)),
    measured: true,
  }
}

function benefitText(
  c: ColumnProfile,
  saved: number,
  fraction: number,
  measured: boolean
): string {
  const basis = measured
    ? `based on this column's current ${compressionRatio(c).toFixed(1)}x compression ratio and a conservative target`
    : `a conservative ${Math.round(fraction * 100)}% of current size, because no byte counts were available to measure the ratio`
  return `Estimated: up to ~${formatBytes(saved)} on-disk saved (${basis}). This is an ESTIMATE — real codec gains depend on the data; measure on a copy before rolling out.`
}

/**
 * Explicit codecs that deserve a second look. Returns the reason and a
 * replacement codec, or null when the codec looks sensible.
 *  - Delta/DoubleDelta on a Float: these subtract neighbouring values as
 *    integers; Gorilla is the float-specific codec.
 *  - DoubleDelta on a column that is neither integer/time-like nor in the
 *    sorting key: it needs smoothly-changing integer sequences to pay off.
 */
function suspiciousExplicitCodec(
  c: ColumnProfile
): { reason: string; codec: string } | null {
  const base = baseType(c.type)
  const hasDelta = /\bDelta\b/i.test(c.compressionCodec)
  const hasDoubleDelta = /\bDoubleDelta\b/i.test(c.compressionCodec)
  if (FLOAT_TYPE.test(base) && (hasDelta || hasDoubleDelta)) {
    return {
      reason: `\`${c.name}\` is \`${c.type}\` with an explicit \`${c.compressionCodec}\`. ${hasDoubleDelta ? 'DoubleDelta' : 'Delta'} works on integer-like sequences and usually helps floats little; Gorilla is the float-specific codec.`,
      codec: 'CODEC(Gorilla, ZSTD(1))',
    }
  }
  if (
    hasDoubleDelta &&
    !INTEGER_LIKE_TYPE.test(base) &&
    c.isInSortingKey !== true
  ) {
    return {
      reason: `\`${c.name}\` is \`${c.type}\` with an explicit \`${c.compressionCodec}\`, but is not a timestamp or integer-like column and is not in the sorting key. DoubleDelta only pays off on smoothly-changing integer sequences.`,
      codec: 'CODEC(ZSTD(1))',
    }
  }
  return null
}

const CODEC_RISK_NOTE =
  'Changing a codec only affects newly written/merged parts unless you rewrite existing data (OPTIMIZE ... FINAL or a mutation), which is I/O-heavy. Results are unchanged; codec choice never affects correctness.'

/**
 * Compression codec advice, two cases:
 *  - Default codec (LZ4): Date/DateTime/Float columns → DoubleDelta/Gorilla
 *    (+ ZSTD); any sizable column compressing poorly (ratio < 3x) → ZSTD.
 *  - Explicit codec: left alone unless it looks mismatched with the type
 *    (see `suspiciousExplicitCodec`); a sensible explicit codec is never
 *    second-guessed.
 * The saved-bytes figure is an ESTIMATE from the column's measured ratio.
 * Ranked by on-disk bytes (the pool a better codec shrinks).
 */
export function ruleCompressionCodec(
  columns: ColumnProfile[],
  minBytes = 1_000_000
): TuningFinding[] {
  const findings: TuningFinding[] = []
  for (const c of columns) {
    if (c.compressedBytes < minBytes) continue

    if (!usesDefaultCodec(c)) {
      const suspicious = suspiciousExplicitCodec(c)
      if (!suspicious) continue
      const { fraction, measured } = projectedSavedFraction(c, true)
      const estimatedBytesSaved =
        measured && fraction < MIN_SAVED_FRACTION
          ? 0
          : Math.round(c.compressedBytes * fraction)
      findings.push({
        ruleId: 'compression_codec',
        category: 'schema',
        title: `Review the compression codec on ${c.database}.${c.table}.${c.name}`,
        target: `${c.database}.${c.table}.${c.name}`,
        rationale: suspicious.reason,
        evidence: bytesEvidence(c),
        estimatedBenefit:
          estimatedBytesSaved > 0
            ? benefitText(c, estimatedBytesSaved, fraction, measured)
            : `The column already compresses at ${compressionRatio(c).toFixed(1)}x, so a codec change may save little. This is an ESTIMATE — measure on a copy before changing it.`,
        estimatedBytesSaved,
        severity: 'low',
        ddl: `ALTER TABLE ${fullTable(c)} MODIFY COLUMN ${quoteIdentifier(c.name)} ${c.type} ${suspicious.codec};`,
        risk: 'low',
        riskNote: CODEC_RISK_NOTE,
      })
      continue
    }

    const ratio = compressionRatio(c)
    const isTimeseries = TIMESERIES_TYPE.test(c.type) || FLOAT_TYPE.test(c.type)
    const poorlyCompressed = ratio > 0 && ratio < 3

    if (!isTimeseries && !poorlyCompressed) continue

    const { fraction, measured } = projectedSavedFraction(c, isTimeseries)
    // Already at or above the target ratio: no headroom worth a finding.
    if (measured && fraction < MIN_SAVED_FRACTION) continue

    const codec = isTimeseries
      ? FLOAT_TYPE.test(c.type)
        ? 'CODEC(Gorilla, ZSTD(1))'
        : 'CODEC(DoubleDelta, ZSTD(1))'
      : 'CODEC(ZSTD(3))'
    const estimatedBytesSaved = Math.round(c.compressedBytes * fraction)

    findings.push({
      ruleId: 'compression_codec',
      category: 'schema',
      title: `Add a compression codec to ${c.database}.${c.table}.${c.name}`,
      target: `${c.database}.${c.table}.${c.name}`,
      rationale: isTimeseries
        ? `\`${c.name}\` is \`${c.type}\` on the default codec (LZ4). ${FLOAT_TYPE.test(c.type) ? 'Gorilla' : 'Delta/DoubleDelta'} + ZSTD is purpose-built for ${FLOAT_TYPE.test(c.type) ? 'slowly-changing numeric' : 'monotonic timestamp'} data and typically compresses it far better than LZ4.`
        : `\`${c.name}\` compresses at only ${ratio.toFixed(1)}x on the default codec (LZ4). ZSTD usually reaches a higher ratio for the same data at read cost that is negligible for a monitoring workload.`,
      evidence: bytesEvidence(c),
      estimatedBenefit: benefitText(c, estimatedBytesSaved, fraction, measured),
      estimatedBytesSaved,
      severity: 'low',
      ddl: `ALTER TABLE ${fullTable(c)} MODIFY COLUMN ${quoteIdentifier(c.name)} ${c.type} ${codec};`,
      risk: 'low',
      riskNote: CODEC_RISK_NOTE,
    })
  }
  return findings
}
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

export function runSchemaRules(columns: ColumnProfile[]): TuningFinding[] {
  return [
    ...ruleNullableColumns(columns),
    ...ruleOversizedIntegers(columns),
    ...ruleCompressionCodec(columns),
    ...ruleLowCardinality(columns),
  ]
}
