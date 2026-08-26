import { filterSettingsDiffRows } from './filter'
import { mergeSettingsDiff } from './merge'
import { describe, expect, test } from 'bun:test'

function sampleRows() {
  return mergeSettingsDiff([
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
}

describe('filterSettingsDiffRows', () => {
  test('returns all rows when no filters are active', () => {
    const filtered = filterSettingsDiffRows(sampleRows(), {
      showDiffsOnly: false,
      showChangedOnly: false,
      nameFilter: '',
    })

    expect(filtered.map((row) => row.name).sort()).toEqual([
      'max_threads',
      'use_uncompressed_cache',
    ])
  })

  test('showDiffsOnly keeps only rows with peer deltas when any diff exists', () => {
    const filtered = filterSettingsDiffRows(sampleRows(), {
      showDiffsOnly: true,
      showChangedOnly: false,
      nameFilter: '',
    })

    expect(filtered.map((row) => row.name)).toEqual(['max_threads'])
  })

  test('showChangedOnly keeps rows changed from default on any peer', () => {
    const filtered = filterSettingsDiffRows(sampleRows(), {
      showDiffsOnly: false,
      showChangedOnly: true,
      nameFilter: '',
    })

    expect(filtered.map((row) => row.name)).toEqual(['max_threads'])
  })

  test('nameFilter is case-insensitive and matches substrings', () => {
    const filtered = filterSettingsDiffRows(sampleRows(), {
      showDiffsOnly: false,
      showChangedOnly: false,
      nameFilter: 'CACHE',
    })

    expect(filtered.map((row) => row.name)).toEqual(['use_uncompressed_cache'])
  })
})
