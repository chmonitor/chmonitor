import type { TableDiff } from './types'

export function tableNameOf(row: TableDiff): string {
  return row.source?.table ?? row.target?.table ?? lastSegment(row.key)
}

export function databaseNameOf(row: TableDiff): string {
  return row.source?.database ?? row.target?.database ?? firstSegment(row.key)
}

function firstSegment(key: string): string {
  const i = key.indexOf('.')
  return i === -1 ? key : key.slice(0, i)
}

function lastSegment(key: string): string {
  const i = key.indexOf('.')
  return i === -1 ? key : key.slice(i + 1)
}

export function groupDiffsByDatabase(
  rows: TableDiff[]
): { database: string; tables: TableDiff[] }[] {
  const map = new Map<string, TableDiff[]>()
  for (const row of rows) {
    const database = databaseNameOf(row)
    const list = map.get(database)
    if (list) list.push(row)
    else map.set(database, [row])
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([database, tables]) => ({
      database,
      tables: [...tables].sort((a, b) =>
        tableNameOf(a).localeCompare(tableNameOf(b))
      ),
    }))
}
