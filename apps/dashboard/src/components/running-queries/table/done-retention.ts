import type { RunningQueryRow } from './types'

/**
 * Reconcile the set of "retained Done" rows after one running-queries poll.
 *
 * The Running Queries table lists live `system.processes` rows, so a query
 * vanishes the instant it finishes. When the user has EXPANDED a row to inspect
 * it, that mid-inspection disappearance is jarring — so we retain the row's
 * last-known snapshot, flip it to a "Done" state, and keep it in the table
 * until the user dismisses it (navigating away drops all state).
 *
 * This is the pure core of that lifecycle, kept side-effect free so it can be
 * unit-tested:
 *
 * - A row present on the previous poll but absent now ("finished") is retained
 *   ONLY if its query_id is currently expanded. Non-expanded finishes are left
 *   to the separate "Recently completed" table, so the running table never
 *   duplicates the whole completed log.
 * - A retained id that shows up live again is dropped (it is running once more).
 * - Explicit dismissal is handled by the caller (a plain map delete).
 *
 * Returns the SAME `prevDone` reference when nothing changed, so a React state
 * setter fed with it bails out of a re-render.
 *
 * @param prevDone     Previously-retained Done rows, keyed by query_id.
 * @param finishedRows Rows present on the previous poll but gone on this one.
 * @param currentIds   query_ids present on this poll.
 * @param expandedKeys Currently-expanded row keys (equal to query_id for keyed
 *                     rows).
 */
export function reconcileDoneRows(
  prevDone: Map<string, RunningQueryRow>,
  finishedRows: RunningQueryRow[],
  currentIds: Set<string>,
  expandedKeys: Set<string>
): Map<string, RunningQueryRow> {
  const next = new Map(prevDone)
  let changed = false

  // A retained row that is running again drops back to the live list.
  for (const id of prevDone.keys()) {
    if (currentIds.has(id)) {
      next.delete(id)
      changed = true
    }
  }

  // Newly-finished rows the user was inspecting become retained Done rows.
  for (const row of finishedRows) {
    const id = String(row.query_id ?? '')
    if (!id || currentIds.has(id) || !expandedKeys.has(id)) continue
    if (!next.has(id)) {
      next.set(id, row)
      changed = true
    }
  }

  return changed ? next : prevDone
}
