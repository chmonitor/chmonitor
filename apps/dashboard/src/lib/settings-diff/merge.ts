import type { SettingsDiffRow, SettingsDiffTable } from './types'

export type SettingRow = {
  name: string
  value: string
  changed: number
  description: string
  defaultValue: string
}

export type SettingsPeerBatch = {
  peerId: number
  table: SettingsDiffTable
  rows: SettingRow[]
}

export function mergeSettingsDiff(
  batches: SettingsPeerBatch[]
): SettingsDiffRow[] {
  const diffMap = new Map<string, SettingsDiffRow>()

  for (const batch of batches) {
    for (const row of batch.rows) {
      const key = `${batch.table}::${row.name}`
      if (!diffMap.has(key)) {
        diffMap.set(key, {
          name: row.name,
          table: batch.table,
          values: {},
          hasDiff: false,
          changedFromDefault: false,
        })
      }
      const entry = diffMap.get(key)!
      entry.values[batch.peerId] = {
        value: row.value,
        changed: row.changed,
        defaultValue: row.defaultValue,
      }
    }
  }

  const rows: SettingsDiffRow[] = []
  for (const entry of diffMap.values()) {
    const hostValues = Object.values(entry.values)
    const uniqueValues = new Set(hostValues.map((v) => v.value))
    entry.hasDiff = uniqueValues.size > 1
    entry.changedFromDefault = hostValues.some((v) => v.changed === 1)
    rows.push(entry)
  }

  rows.sort((a, b) => {
    if (a.hasDiff !== b.hasDiff) return a.hasDiff ? -1 : 1
    if (a.table !== b.table) return a.table.localeCompare(b.table)
    return a.name.localeCompare(b.name)
  })

  return rows
}
