/**
 * Projection vs. Summing/Aggregating MV design choice for the MV/projection
 * designer. Pure, no I/O.
 *
 * See `./index.ts` for the module overview.
 */

import type { AggregateCall } from './sql-parsing'

/** ClickHouse aggregate functions whose merge semantics are a plain sum (safe for SummingMergeTree). Everything else needs `-State`/`-Merge` (AggregatingMergeTree). */
const SUM_COMPATIBLE_FUNCTIONS = new Set(['sum', 'count'])

export type DesignKind = 'projection' | 'summing_mv' | 'aggregating_mv'

export interface DesignInput {
  tableCount: number
  groupByKeys: string[]
  sortingKeyCols: string[]
  aggregateCalls: AggregateCall[]
}

export interface Design {
  kind: DesignKind
  rationale: string
}

function normalizeKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * True when `groupByKeys` (order-insensitive, as a set) equals the first
 * `groupByKeys.length` columns of `sortingKeyCols` — i.e. the aggregation can
 * ride the table's existing part ordering, the precondition for preferring a
 * projection over a second MV table.
 */
export function groupByMatchesSortingPrefix(
  groupByKeys: string[],
  sortingKeyCols: string[]
): boolean {
  if (groupByKeys.length === 0) return false
  if (sortingKeyCols.length < groupByKeys.length) return false
  const prefix = new Set(
    sortingKeyCols.slice(0, groupByKeys.length).map(normalizeKey)
  )
  return groupByKeys.every((k) => prefix.has(normalizeKey(k)))
}

/**
 * Choose projection vs. Summing/Aggregating MV for one mined shape.
 *
 * Tie-breaker (resolves the plan's "MV vs projection default" open
 * question, per the plan's own approach section): a single-table shape whose
 * GROUP BY keys match a prefix of the table's existing ORDER BY prefers a
 * PROJECTION — no second table, and ClickHouse re-aggregates it on merge
 * without needing `-State`/`-Merge`. This check runs *before* the
 * Summing/Aggregating choice, so it can win even for a sum/count-only shape
 * (a projection handles those fine too). Only when a projection isn't
 * eligible (multi-table, or GROUP BY doesn't match the sort prefix) do we
 * fall back to choosing between SummingMergeTree (sum/count only) and
 * AggregatingMergeTree (anything else) for a standalone MV.
 *
 * "Read-mostly" isn't independently verified (that would need a
 * `system.part_log` write-rate query on top of the ones this already does) —
 * the rationale states it as a labeled assumption instead of hiding it.
 */
export function chooseDesign(input: DesignInput): Design {
  const { tableCount, groupByKeys, sortingKeyCols, aggregateCalls } = input

  if (
    tableCount === 1 &&
    groupByMatchesSortingPrefix(groupByKeys, sortingKeyCols)
  ) {
    return {
      kind: 'projection',
      rationale: `Single-table aggregation whose GROUP BY keys (${groupByKeys.join(', ')}) match a prefix of the table's existing ORDER BY (${sortingKeyCols.slice(0, groupByKeys.length).join(', ')}) — a PROJECTION serves this without a second table and ClickHouse re-aggregates it on merge automatically (no -State/-Merge needed). Assumes the table is read-mostly; if it has heavy concurrent inserts, verify the projection's merge-time rebuild cost before applying.`,
    }
  }

  const funcs = aggregateCalls.map((c: AggregateCall) => c.func.toLowerCase())
  const sumCountOnly =
    funcs.length > 0 && funcs.every((f) => SUM_COMPATIBLE_FUNCTIONS.has(f))

  if (sumCountOnly) {
    return {
      kind: 'summing_mv',
      rationale:
        'Aggregation uses only sum/count — a SummingMergeTree materialized view pre-aggregates these on merge without needing AggregateFunction state columns.',
    }
  }

  const distinctFuncs = [...new Set(funcs)]
  return {
    kind: 'aggregating_mv',
    rationale: `Aggregation includes non-summable functions (${distinctFuncs.join(', ')}) — an AggregatingMergeTree materialized view with -State columns is required; queries against it must use the matching -Merge combinators (e.g. ${distinctFuncs.map((f) => `${f}Merge`).join(', ')}).`,
  }
}
