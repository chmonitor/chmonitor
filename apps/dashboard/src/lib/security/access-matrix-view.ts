/**
 * Matrix rows and filters for the Access matrix page (#4123). Pure, so the
 * filter semantics are unit tested apart from the React view.
 */

import type {
  AccessInputs,
  CellAccess,
  Grantee,
  GranteeAccess,
} from './access-matrix'

import { ACCESS_LEVELS, computeCell, granteeAccess } from './access-matrix'

/** Databases ClickHouse creates itself; hidden unless asked for. */
export const SYSTEM_DATABASES = new Set([
  'system',
  'INFORMATION_SCHEMA',
  'information_schema',
])

export interface UserInfo {
  name: string
  storage: string
}

export interface MatrixRow {
  access: GranteeAccess
  /** Storage of the user or role, e.g. local_directory or users_xml. */
  storage: string
  /** Effective access per database name. */
  cells: Map<string, CellAccess>
}

export interface MatrixFilters {
  search: string
  /** Only rows with at least read on this database ('' = any). */
  database: string
  writeOnly: boolean
  /** Hide users defined in users.xml (the built-in `default` user and config users). */
  hideConfigUsers: boolean
}

export function buildRows(
  kind: Grantee['kind'],
  grantees: UserInfo[],
  databases: string[],
  inputs: AccessInputs
): MatrixRow[] {
  return grantees.map((g) => {
    const access = granteeAccess({ kind, name: g.name }, inputs)
    const cells = new Map<string, CellAccess>()
    for (const database of databases) {
      cells.set(
        database,
        computeCell(access.sourced, { database }, access.readonly)
      )
    }
    return { access, storage: g.storage, cells }
  })
}

const atLeast = (cell: CellAccess | undefined, level: 'read' | 'write') =>
  cell !== undefined &&
  ACCESS_LEVELS.indexOf(cell.level) >= ACCESS_LEVELS.indexOf(level)

export function filterRows(
  rows: MatrixRow[],
  filters: MatrixFilters
): MatrixRow[] {
  const needle = filters.search.trim().toLowerCase()
  return rows.filter((row) => {
    if (needle && !row.access.grantee.name.toLowerCase().includes(needle))
      return false
    if (
      filters.hideConfigUsers &&
      row.access.grantee.kind === 'user' &&
      row.storage === 'users_xml'
    )
      return false
    const cells = filters.database
      ? [row.cells.get(filters.database)]
      : [...row.cells.values()]
    if (filters.database && !atLeast(cells[0], 'read')) return false
    // Effective write, after the readonly cap.
    if (filters.writeOnly && !cells.some((c) => atLeast(c, 'write')))
      return false
    return true
  })
}
