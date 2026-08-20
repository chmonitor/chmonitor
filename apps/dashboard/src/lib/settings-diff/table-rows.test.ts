import {
  buildSettingsDiffQueryConfig,
  toSettingsDiffTableRows,
  uniqueHostColumnKeys,
} from './table-rows'
import { describe, expect, test } from 'bun:test'
import { ColumnFormat } from '@/types/column-format'

describe('uniqueHostColumnKeys', () => {
  test('uses host names as column keys', () => {
    expect(
      uniqueHostColumnKeys([
        { id: 0, name: 'node-0' },
        { id: 1, name: 'node-1' },
      ])
    ).toEqual([
      { id: 0, key: 'node-0' },
      { id: 1, key: 'node-1' },
    ])
  })

  test('suffixes reserved names and collisions', () => {
    expect(
      uniqueHostColumnKeys([
        { id: 0, name: 'name' },
        { id: 1, name: 'prod' },
        { id: 2, name: 'prod' },
      ])
    ).toEqual([
      { id: 0, key: 'name (0)' },
      { id: 1, key: 'prod' },
      { id: 2, key: 'prod (2)' },
    ])
  })
})

describe('toSettingsDiffTableRows', () => {
  const hosts = uniqueHostColumnKeys([
    { id: 0, name: 'node-0' },
    { id: 1, name: 'node-1' },
  ])

  test('flattens match, changed, default, and host values', () => {
    const [row] = toSettingsDiffTableRows(
      [
        {
          name: 'max_threads',
          table: 'settings',
          values: {
            0: { value: '8', changed: 0, defaultValue: '0' },
            1: { value: '16', changed: 1, defaultValue: '0' },
          },
          hasDiff: true,
          changedFromDefault: true,
        },
      ],
      hosts,
      true
    )

    expect(row).toEqual({
      match: false,
      name: 'max_threads',
      table: 'settings',
      changed: 'modified',
      default: '0',
      _hasDiff: true,
      'node-0': '8',
      'node-1': '16',
    })
  })

  test('omits match for a single host and labels merge_tree', () => {
    const oneHost = uniqueHostColumnKeys([{ id: 0, name: 'prod' }])
    const [row] = toSettingsDiffTableRows(
      [
        {
          name: 'max_bytes_to_merge_at_max_space_in_pool',
          table: 'merge_tree_settings',
          values: {
            0: { value: '16384', changed: 0, defaultValue: '16384' },
          },
          hasDiff: false,
          changedFromDefault: false,
        },
      ],
      oneHost,
      false
    )

    expect(row.match).toBeUndefined()
    expect(row.table).toBe('merge_tree')
    expect(row.changed).toBe('')
    expect(row.prod).toBe('16384')
  })
})

describe('buildSettingsDiffQueryConfig', () => {
  test('enables sort, resize, reorder, and host columns', () => {
    const hosts = uniqueHostColumnKeys([
      { id: 0, name: 'node-0' },
      { id: 1, name: 'node-1' },
    ])
    const config = buildSettingsDiffQueryConfig(hosts, true)

    expect(config.columns).toEqual([
      'match',
      'name',
      'table',
      'changed',
      'default',
      'node-0',
      'node-1',
    ])
    expect(config.columnFormats?.match).toBe(ColumnFormat.Boolean)
    expect(config.columnFormats?.name).toBe(ColumnFormat.Code)
    expect(config.columnFormats?.['node-0']).toBe(ColumnFormat.Code)
    expect(config.tableBehavior).toEqual({
      enableColumnResizing: true,
      enableSorting: true,
      enableColumnReordering: true,
    })
    expect(config.defaultView).toBe('table')
    expect(config.columnIcons?.match).toBeDefined()
    expect(config.columnIcons?.name).toBeDefined()
    expect(config.columnIcons?.['node-0']).toBeDefined()
  })
})
