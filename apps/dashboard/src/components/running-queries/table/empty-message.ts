import { NO_ACTIVE_QUERIES_MESSAGE } from '@/components/query-tables/empty-state'

/**
 * Pick the empty-state copy for the running-queries table body.
 *
 * The table always renders its toolbar (search, filters, column visibility,
 * export) regardless of row count — only the body region swaps to an empty
 * message. That message differs by cause:
 * - No live or retained-Done rows at all → friendlier "nothing running" copy.
 * - Otherwise (a non-empty data set filtered down to zero) → `undefined`,
 *   letting the caller fall back to the shared "no matches" default.
 */
export function getEmptyMessage(
  rowCount: number,
  doneRowCount: number
): string | undefined {
  return rowCount === 0 && doneRowCount === 0
    ? NO_ACTIVE_QUERIES_MESSAGE
    : undefined
}
