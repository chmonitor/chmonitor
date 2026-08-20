import type { TableDiff, TableDiffKind } from './types'

export type TableSort = 'name-asc' | 'name-desc' | 'kind'

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

const KIND_ORDER: Record<TableDiffKind, number> = {
  changed: 0,
  only_source: 1,
  only_target: 2,
  identical: 3,
}

export function groupDiffsByDatabase(
  rows: TableDiff[],
  sort: TableSort = 'name-asc'
): { database: string; tables: TableDiff[] }[] {
  const map = new Map<string, TableDiff[]>()
  for (const row of rows) {
    const database = databaseNameOf(row)
    const list = map.get(database)
    if (list) list.push(row)
    else map.set(database, [row])
  }

  const nameCmp = (a: string, b: string) => {
    const n = a.localeCompare(b)
    return sort === 'name-desc' ? -n : n
  }

  return [...map.entries()]
    .sort(([a], [b]) => nameCmp(a, b))
    .map(([database, tables]) => ({
      database,
      tables: [...tables].sort((a, b) => {
        if (sort === 'kind') {
          const k = KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
          if (k !== 0) return k
        }
        return nameCmp(tableNameOf(a), tableNameOf(b))
      }),
    }))
}
