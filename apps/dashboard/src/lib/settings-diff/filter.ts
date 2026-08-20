import type { SettingsDiffRow } from './types'

export function filterSettingsDiffRows(
  rows: SettingsDiffRow[],
  opts: { showDiffsOnly: boolean; showChangedOnly: boolean; nameFilter: string }
): SettingsDiffRow[] {
  const q = opts.nameFilter.toLowerCase()
  // Differences with zero deltas still lists matching rows so the table
  // is a real catalog, not an empty "All matched" card.
  const hasAnyDiff = rows.some((row) => row.hasDiff)
  const hideMatched = opts.showDiffsOnly && hasAnyDiff
  return rows.filter((row) => {
    if (hideMatched && !row.hasDiff) return false
    if (opts.showChangedOnly && !row.changedFromDefault) return false
    if (q && !row.name.toLowerCase().includes(q)) return false
    return true
  })
}
