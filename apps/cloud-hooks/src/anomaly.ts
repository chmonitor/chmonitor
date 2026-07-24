/**
 * Usage anomaly detection — alert when DAU moves far enough from its own recent
 * behaviour to mean something broke.
 *
 * The daily digest reports DAU as a number, which is passive: it only helps if
 * someone reads it and remembers what yesterday's number was. A collapse in
 * active installs almost always means a broken release, a broken telemetry
 * endpoint, or an outage nobody caught — all things worth interrupting someone
 * for. So we compare yesterday against the days before it and alert on the
 * deviation, not the value.
 *
 * Design choices that keep this from crying wolf:
 *
 * - **Median baseline, not mean.** One viral day (an HN front page) would drag a
 *   mean up for a week and make every following day look like a 40% collapse.
 *   The median ignores it.
 * - **A minimum baseline.** Below `MIN_BASELINE` installs, normal jitter is a
 *   huge percentage — 3 → 1 is "-67%" and means nothing. Small numbers stay
 *   silent.
 * - **Drops only, by default.** A spike is interesting but not urgent; a
 *   collapse is. Spikes are surfaced with a lower-key message and a much higher
 *   threshold, since a genuine 3× spike is usually good news worth knowing.
 */

import { shiftDay } from './usage'

/**
 * Minimal D1 subset for the day-series query. Declared here rather than reused
 * from `usage.ts` because this query needs `.all()` (a row per day) where the
 * usage queries need `.first()`.
 */
export interface D1SeriesDb {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>
    }
  }
}

/** Fraction below baseline that counts as a drop (0.3 = 30% down). */
export const DEFAULT_DROP_THRESHOLD = 0.3
/** Multiple of baseline that counts as a spike. */
export const DEFAULT_SPIKE_MULTIPLE = 3
/** Baselines below this are too small for a percentage to be meaningful. */
export const MIN_BASELINE = 10
/** How many prior days form the baseline. */
export const BASELINE_DAYS = 7

export interface DailyCount {
  day: string
  n: number
}

export interface Anomaly {
  kind: 'drop' | 'spike'
  /** The value observed on the reference day. */
  current: number
  /** Median of the baseline window. */
  baseline: number
  /** Signed change vs baseline as a percentage, rounded to one decimal. */
  changePct: number
  referenceDay: string
}

/** Median of a numeric list. Returns 0 for an empty list. */
export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export interface DetectOptions {
  dropThreshold?: number
  spikeMultiple?: number
  minBaseline?: number
}

/**
 * Compare the reference day against the median of the preceding days. Pure, so
 * every threshold decision is testable without a database. Returns null when
 * nothing is worth reporting — including when the baseline is too small to
 * judge.
 */
export function detectAnomaly(
  series: DailyCount[],
  referenceDay: string,
  opts: DetectOptions = {}
): Anomaly | null {
  const dropThreshold = opts.dropThreshold ?? DEFAULT_DROP_THRESHOLD
  const spikeMultiple = opts.spikeMultiple ?? DEFAULT_SPIKE_MULTIPLE
  const minBaseline = opts.minBaseline ?? MIN_BASELINE

  const currentRow = series.find((row) => row.day === referenceDay)
  // A missing reference day is itself a signal: zero installs reported.
  const current = currentRow?.n ?? 0

  const baselineDays = series.filter((row) => row.day !== referenceDay)
  if (baselineDays.length === 0) return null

  const baseline = median(baselineDays.map((row) => row.n))
  if (baseline < minBaseline) return null

  const changePct = Math.round(((current - baseline) / baseline) * 1000) / 10

  if (current <= baseline * (1 - dropThreshold)) {
    return { kind: 'drop', current, baseline, changePct, referenceDay }
  }
  if (current >= baseline * spikeMultiple) {
    return { kind: 'spike', current, baseline, changePct, referenceDay }
  }
  return null
}

/**
 * Daily distinct-install counts for the baseline window plus the reference day.
 * Returns [] on any failure — the caller then simply skips detection rather
 * than alerting on a database error.
 */
export async function fetchDailySeries(
  db: D1SeriesDb,
  referenceDay: string,
  days: number = BASELINE_DAYS,
  logError: (message: string, meta?: unknown) => void = (m, meta) =>
    console.error(m, meta)
): Promise<DailyCount[]> {
  const from = shiftDay(referenceDay, -days)
  try {
    const rows = await db
      .prepare(
        `SELECT day, COUNT(DISTINCT instance_hash) AS n
           FROM ping_daily
          WHERE day >= ?1 AND day <= ?2
          GROUP BY day
          ORDER BY day`
      )
      .bind(from, referenceDay)
      .all<DailyCount>()
    return rows.results ?? []
  } catch (err) {
    logError('[cloud-hooks] daily series query failed', err)
    return []
  }
}

export function formatAnomaly(anomaly: Anomaly): string {
  if (anomaly.kind === 'drop') {
    return [
      `\u{1F4C9} <b>Active installs dropped ${Math.abs(anomaly.changePct)}%</b>`,
      `  • ${anomaly.referenceDay}: <b>${anomaly.current}</b> (baseline ${anomaly.baseline})`,
      '',
      '<i>Usually a broken release, a broken telemetry endpoint, or an outage.</i>',
    ].join('\n')
  }
  return [
    `\u{1F680} <b>Active installs up ${anomaly.changePct}%</b>`,
    `  • ${anomaly.referenceDay}: <b>${anomaly.current}</b> (baseline ${anomaly.baseline})`,
  ].join('\n')
}
