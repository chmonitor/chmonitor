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
