import { mergeSettingsDiff } from './merge'
import { describe, expect, test } from 'bun:test'

describe('mergeSettingsDiff', () => {
  test('marks hasDiff when peer values differ and preserves value order', () => {
    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 1,
            description: '',
            defaultValue: '0',
          },
        ],
      },
      {
        peerId: 1,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '16',
            changed: 1,
            description: '',
            defaultValue: '0',
          },
        ],
      },
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.hasDiff).toBe(true)
    expect(rows[0]?.changedFromDefault).toBe(true)
    expect(rows[0]?.values[0]?.value).toBe('8')
    expect(rows[0]?.values[1]?.value).toBe('16')
  })

  test('treats identical peer values as matched rows', () => {
    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'use_uncompressed_cache',
            value: '0',
            changed: 0,
            description: '',
            defaultValue: '0',
          },
        ],
      },
      {
        peerId: 1,
        table: 'settings',
        rows: [
          {
            name: 'use_uncompressed_cache',
            value: '0',
            changed: 0,
            description: '',
            defaultValue: '0',
          },
        ],
      },
    ])

    expect(rows[0]?.hasDiff).toBe(false)
    expect(rows[0]?.changedFromDefault).toBe(false)
  })

  test('merges duplicate setting names across tables independently', () => {
    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'max_threads',
            value: '8',
            changed: 0,
            description: '',
            defaultValue: '8',
          },
        ],
      },
      {
        peerId: 0,
        table: 'merge_tree_settings',
        rows: [
          {
            name: 'max_threads',
            value: '4',
            changed: 1,
            description: '',
            defaultValue: '0',
          },
        ],
      },
    ])

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.table).sort()).toEqual([
      'merge_tree_settings',
      'settings',
    ])
    expect(
      rows.find((row) => row.table === 'merge_tree_settings')
        ?.changedFromDefault
    ).toBe(true)
  })

  test('sorts diff rows before table/name for stable UI ordering', () => {
    const rows = mergeSettingsDiff([
      {
        peerId: 0,
        table: 'settings',
        rows: [
          {
            name: 'b_setting',
            value: '1',
            changed: 0,
            description: '',
            defaultValue: '1',
          },
          {
            name: 'a_setting',
            value: '2',
            changed: 0,
            description: '',
            defaultValue: '2',
          },
        ],
      },
      {
        peerId: 1,
        table: 'settings',
        rows: [
          {
            name: 'b_setting',
            value: '9',
            changed: 1,
            description: '',
            defaultValue: '1',
          },
          {
            name: 'a_setting',
            value: '2',
            changed: 0,
            description: '',
            defaultValue: '2',
          },
        ],
      },
    ])

    expect(rows[0]?.name).toBe('b_setting')
    expect(rows[0]?.hasDiff).toBe(true)
    expect(rows[1]?.name).toBe('a_setting')
    expect(rows[1]?.hasDiff).toBe(false)
  })
})
