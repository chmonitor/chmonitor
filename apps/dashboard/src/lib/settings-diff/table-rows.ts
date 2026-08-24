import {
  CheckCircle2Icon,
  PencilIcon,
  ServerIcon,
  SlidersHorizontalIcon,
  Table2Icon,
  Undo2Icon,
} from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'
import type { SettingsDiffHostInfo, SettingsDiffRow } from './types'

import { ColumnFormat } from '@/types/column-format'

const RESERVED_COLUMN_KEYS = new Set([
  'match',
  'name',
  'table',
  'changed',
  'default',
  '_hasdiff',
])

export type SettingsDiffHostColumn = {
  id: number
  key: string
}

export type SettingsDiffTableRow = Record<string, unknown>

function tableLabel(table: SettingsDiffRow['table']): string {
  return table === 'merge_tree_settings' ? 'merge_tree' : 'settings'
}

/**
 * Stable, unique DataTable column keys for compared hosts.
 * Host names are used as headers; collisions with reserved keys or other
 * hosts get a `(id)` suffix.
 */
export function uniqueHostColumnKeys(
  hosts: SettingsDiffHostInfo[]
): SettingsDiffHostColumn[] {
  const used = new Set<string>()
  return hosts.map((host) => {
    let key = host.name.trim() || `host-${host.id}`
    const taken = (candidate: string) => {
      const lower = candidate.toLocaleLowerCase()
      return reservedOrUsed(lower, used)
    }
    if (taken(key)) {
      key = `${key} (${host.id})`
    }
    used.add(key.toLocaleLowerCase())
    return { id: host.id, key }
  })
}

function reservedOrUsed(lower: string, used: Set<string>): boolean {
  return RESERVED_COLUMN_KEYS.has(lower) || used.has(lower)
}

export function toSettingsDiffTableRows(
  rows: SettingsDiffRow[],
  hostColumns: SettingsDiffHostColumn[],
  showMatchColumn: boolean
): SettingsDiffTableRow[] {
  return rows.map((row) => {
    const defaultValue =
      hostColumns.length > 0
        ? (row.values[hostColumns[0].id]?.defaultValue ?? '—')
        : '—'
    const next: SettingsDiffTableRow = {
      name: row.name,
      table: tableLabel(row.table),
      changed: row.changedFromDefault ? 'modified' : '',
      default: defaultValue,
      _hasDiff: row.hasDiff,
    }
    if (showMatchColumn) {
      next.match = !row.hasDiff
    }
    for (const host of hostColumns) {
      next[host.key] = row.values[host.id]?.value ?? 'n/a'
    }
    return next
  })
}

export function buildSettingsDiffQueryConfig(
  hostColumns: SettingsDiffHostColumn[],
  showMatchColumn: boolean
): QueryConfig {
  const hostKeys = hostColumns.map((h) => h.key)
  const columns = [
    ...(showMatchColumn ? ['match'] : []),
    'name',
    'table',
    'changed',
    'default',
    ...hostKeys,
  ]

  const columnFormats: QueryConfig['columnFormats'] = {
    name: ColumnFormat.Code,
    table: ColumnFormat.ColoredBadge,
    changed: ColumnFormat.ColoredBadge,
    default: ColumnFormat.Code,
  }
  if (showMatchColumn) {
    columnFormats.match = ColumnFormat.Boolean
  }
  for (const key of hostKeys) {
    columnFormats[key] = ColumnFormat.Code
  }

  const columnIcons: NonNullable<QueryConfig['columnIcons']> = {
    name: SlidersHorizontalIcon,
    table: Table2Icon,
    changed: PencilIcon,
    default: Undo2Icon,
  }
  if (showMatchColumn) {
    columnIcons.match = CheckCircle2Icon
  }
  for (const key of hostKeys) {
    columnIcons[key] = ServerIcon
  }

  const columnSizing: NonNullable<QueryConfig['columnSizing']> = {
    match: { size: 72, minSize: 56, maxSize: 96 },
    name: { size: 280, minSize: 160 },
    table: { size: 140, minSize: 100 },
    changed: { size: 120, minSize: 88 },
    default: { size: 140, minSize: 88 },
  }
  for (const key of hostKeys) {
    columnSizing[key] = { size: 160, minSize: 96 }
  }

  const columnDescriptions: Record<string, string> = {
    match: 'Whether every compared host has the same value.',
    name: 'Setting name.',
    table: 'system.settings or system.merge_tree_settings.',
    changed: 'Value differs from the server default.',
    default: 'Default value for this setting.',
  }
  for (const host of hostColumns) {
    columnDescriptions[host.key] = `Current value on ${host.key}.`
  }

  return {
    name: 'settings-diff',
    description:
      'system.settings and merge_tree_settings compared across the selected hosts',
    sql: '-- client-side settings diff',
    disableSqlValidation: true,
    columns,
    columnFormats,
    columnIcons,
    columnSizing,
    columnDescriptions,
    defaultView: 'table',
    card: {
      primary: 'name',
      badges: showMatchColumn
        ? ['match', 'table', 'changed']
        : ['table', 'changed'],
      metrics: ['default', ...hostKeys],
    },
    tableBehavior: {
      enableColumnResizing: true,
      enableSorting: true,
      enableColumnReordering: true,
    },
    rowClassName: (row) =>
      row._hasDiff ? 'bg-[var(--chart-yellow)]/10' : undefined,
  }
}
