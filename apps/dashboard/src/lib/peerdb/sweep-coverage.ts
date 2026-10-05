/**
 * Coverage contract for a bounded PeerDB sweep (issue #3687).
 *
 * A sweep that stops early — a wall-clock budget elapsing, or an operator-set
 * guard — used to return a number (`mirrorsChecked: 50`) with nothing saying how
 * many mirrors PeerDB had actually listed. On a 72-mirror fleet that made 22
 * mirrors invisible: a failure at position 60 produced no alert, no audit row,
 * and no indication that the tick was partial.
 *
 * So every bounded read path reports the same four facts:
 *
 *   - `listed`   — items the upstream listed this tick, before any bound.
 *   - `checked`  — items this tick actually read.
 *   - `partial`  — `listed > checked`; some items produced NO signal at all.
 *   - `unchecked`— `listed - checked`; how many produced no signal.
 *
 * `partial` is the load-bearing field. A green result over a partial fleet is
 * the failure mode this type exists to make impossible: readers must surface
 * it, not average it away.
 *
 * Dependency-free (no logger, no fetch client, no env) so every PeerDB reader
 * can import it — the alert collector today, the mirror-logs feed (#3678) next.
 * `formatSweepCoverage` is the human phrasing both put in their output.
 */

/** How much of an upstream listing a single sweep read. */
export interface PeerDBSweepCoverage {
  /** Items the upstream list returned this tick, before any bound. */
  listed: number
  /** Items this tick actually read (a read that FAILED still counts as read). */
  checked: number
  /** `listed > checked` — some items produced no signal whatsoever. */
  partial: boolean
  /** `listed - checked` — items with no signal. Zero whenever `partial` is false. */
  unchecked: number
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : 0
}

/**
 * Build the coverage facts from "listed" and "checked".
 *
 * Pure and total: non-numeric, negative, or inconsistent input is clamped
 * rather than thrown on, and `checked` can never exceed `listed` (a caller
 * that reports more checked than listed is reporting a bug, and must not turn
 * it into a negative "unchecked" that hides a real shortfall).
 */
export function summarizeSweepCoverage(
  listed: number,
  checked: number
): PeerDBSweepCoverage {
  const l = count(listed)
  const c = Math.min(count(checked), l)
  const unchecked = l - c
  return { listed: l, checked: c, partial: unchecked > 0, unchecked }
}

/**
 * One-line human phrasing of a coverage result, for audit rows and API
 * responses. Always names both counts, so a reader never has to infer whether
 * the result was partial.
 *
 * `noun` defaults to `mirrors` (this lane's item); a caller reading something
 * else passes its own noun.
 */
export function formatSweepCoverage(
  coverage: PeerDBSweepCoverage,
  noun = 'mirrors'
): string {
  const c = summarizeSweepCoverage(coverage.listed, coverage.checked)
  return c.partial
    ? `${c.checked} of ${c.listed} ${noun} checked — partial result: ${c.unchecked} unchecked`
    : `${c.checked} of ${c.listed} ${noun} checked — complete`
}
