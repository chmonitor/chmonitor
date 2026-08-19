import type { SettingsDiffRow } from './types'

export function filterSettingsDiffRows(
  rows: SettingsDiffRow[],
  opts: { showDiffsOnly: boolean; showChangedOnly: boolean; nameFilter: string }
): SettingsDiffRow[] {
  const q = opts.nameFilter.toLowerCase()
  return rows.filter((row) => {
    if (opts.showDiffsOnly && !row.hasDiff) return false
    if (opts.showChangedOnly && !row.changedFromDefault) return false
    if (q && !row.name.toLowerCase().includes(q)) return false
    return true
  })
}

/** Diffs-only with zero deltas and no other filter — show "All matched", not a filter miss. */
export function isSettingsDiffAllMatchedEmpty(opts: {
  totalRows: number
  diffCount: number
  showDiffsOnly: boolean
  showChangedOnly: boolean
  nameFilter: string
}): boolean {
  return (
    opts.showDiffsOnly &&
    opts.diffCount === 0 &&
    opts.totalRows > 0 &&
    !opts.showChangedOnly &&
    opts.nameFilter.trim() === ''
  )
}
