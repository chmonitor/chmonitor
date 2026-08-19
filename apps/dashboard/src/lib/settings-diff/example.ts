import type { SettingsDiffResponse, SettingsDiffRow } from './types'

import { EXAMPLE_PEERS } from '@/lib/compare/example-peers'

function cell(
  value: string,
  changed: number,
  defaultValue: string
): SettingsDiffRow['values'][number] {
  return { value, changed, defaultValue }
}

function row(
  name: string,
  table: SettingsDiffRow['table'],
  a: SettingsDiffRow['values'][number],
  b: SettingsDiffRow['values'][number]
): SettingsDiffRow {
  return {
    name,
    table,
    values: { 0: a, 1: b },
    hasDiff: a.value !== b.value,
    changedFromDefault: a.changed === 1 || b.changed === 1,
  }
}

/** Deterministic sample settings diff for the one-host example preview. */
export function buildExampleSettingsDiff(): SettingsDiffResponse {
  const rows: SettingsDiffRow[] = [
    row(
      'max_memory_usage',
      'settings',
      cell('10000000000', 1, '0'),
      cell('20000000000', 1, '0')
    ),
    row('max_threads', 'settings', cell('8', 1, '0'), cell('16', 1, '0')),
    row(
      'use_uncompressed_cache',
      'settings',
      cell('0', 0, '0'),
      cell('1', 1, '0')
    ),
    row(
      'parts_to_delay_insert',
      'merge_tree_settings',
      cell('150', 1, '150'),
      cell('300', 1, '150')
    ),
    row(
      'max_bytes_to_merge_at_max_space_in_pool',
      'merge_tree_settings',
      cell('161061273600', 0, '161061273600'),
      cell('161061273600', 0, '161061273600')
    ),
  ]

  rows.sort((a, b) => {
    if (a.hasDiff !== b.hasDiff) return a.hasDiff ? -1 : 1
    if (a.table !== b.table) return a.table.localeCompare(b.table)
    return a.name.localeCompare(b.name)
  })

  return {
    success: true,
    hosts: EXAMPLE_PEERS,
    nodes: [],
    scope: 'hosts',
    sourceHostId: EXAMPLE_PEERS[0].id,
    targetHostId: EXAMPLE_PEERS[1].id,
    rows,
  }
}
