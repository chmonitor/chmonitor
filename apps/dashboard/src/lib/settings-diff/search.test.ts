import { filterSettingsDiffRows } from './filter'
import { mergeSettingsDiff } from './merge'
import { buildSettingsDiffRequest, validateSettingsDiffSearch } from './search'
import { describe, expect, test } from 'bun:test'

describe('settings-diff request shape', () => {
  test('builds a node-pair query string', () => {
    expect(
      buildSettingsDiffRequest({
        host: 0,
        scope: 'nodes',
        source: 0,
        target: 1,
      })
    ).toBe('/api/v1/settings-diff?host=0&scope=nodes&source=0&target=1')
  })

  test('parses node-pair search params', () => {
    expect(
      validateSettingsDiffSearch({
        host: '0',
        scope: 'nodes',
        source: '0',
        target: '1',
      })
    ).toEqual({
      host: 0,
      source: 0,
      target: 1,
      scope: 'nodes',
    })
  })

  test('drops invalid scope', () => {
    expect(validateSettingsDiffSearch({ host: '0', scope: 'nope' })).toEqual({
      host: 0,
    })
  })

  test('parses pair view and negative user-connection ids', () => {
    expect(
      validateSettingsDiffSearch({
        host: '-1000',
        scope: 'hosts',
        view: 'pair',
        source: '-1000',
        target: '-1',
      })
    ).toEqual({
      host: -1000,
      source: -1000,
      target: -1,
      scope: 'hosts',
      view: 'pair',
    })
  })

  test('builds a pair query string that keeps negative ids', () => {
    expect(
      buildSettingsDiffRequest({
        host: -1000,
        scope: 'hosts',
        view: 'pair',
        source: -1000,
        target: -1,
      })
    ).toBe(
      '/api/v1/settings-diff?host=-1000&scope=hosts&view=pair&source=-1000&target=-1'
    )
  })
})

describe('settings-diff node pair filter', () => {
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
          name: 'max_threads',
          value: '16',
          changed: 1,
          description: '',
          defaultValue: '0',
        },
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

  test('flags values that differ across the selected node pair', () => {
    const threads = rows.find((r) => r.name === 'max_threads')
    const cache = rows.find((r) => r.name === 'use_uncompressed_cache')
    expect(threads?.hasDiff).toBe(true)
    expect(cache?.hasDiff).toBe(false)
    expect(threads?.values[0]?.value).toBe('8')
    expect(threads?.values[1]?.value).toBe('16')
  })

  test('show diffs only keeps the node-pair delta', () => {
    const filtered = filterSettingsDiffRows(rows, {
      showDiffsOnly: true,
      showChangedOnly: false,
      nameFilter: '',
    })
    expect(filtered.map((r) => r.name)).toEqual(['max_threads'])
  })
})

describe('settings-diff matching catalog', () => {
  test('diffs-only with no deltas still lists matching rows', () => {
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
            name: 'max_threads',
            value: '8',
            changed: 0,
            description: '',
            defaultValue: '8',
          },
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
    const filtered = filterSettingsDiffRows(rows, {
      showDiffsOnly: true,
      showChangedOnly: false,
      nameFilter: '',
    })
    expect(filtered.map((r) => r.name).sort()).toEqual([
      'max_threads',
      'use_uncompressed_cache',
    ])
    expect(filtered.every((r) => r.hasDiff === false)).toBe(true)
  })
})
