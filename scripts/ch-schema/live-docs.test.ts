import type { Query } from './live-docs'

import {
  fetchColumnComments,
  fetchTieredSettings,
  renderColumnComments,
  renderSettingsTiers,
  toCell,
} from './live-docs'
import { describe, expect, test } from 'bun:test'

const isDiscovery = (sql: string, table: string) =>
  sql.startsWith('SELECT name FROM') && sql.includes(`table = '${table}'`)

const fake =
  (settingsColumns: string[], hasComment = true): Query =>
  (sql) => {
    if (isDiscovery(sql, 'settings'))
      return settingsColumns.map((name) => ({ name }))
    if (isDiscovery(sql, 'columns'))
      return [{ name: hasComment ? 'comment' : 'name' }]
    if (sql.includes("table = 'merges'") && sql.includes('ORDER BY position'))
      return [
        {
          name: 'elapsed',
          type: 'Float64',
          comment: sql.includes("'' AS comment") ? '' : 'Seconds',
        },
      ]
    if (sql.includes('FROM system.settings'))
      return [{ name: 'a', tier: 'Beta', description: 'x' }]
    return []
  }

describe('live docs', () => {
  test('selects comment only when the version has it', () => {
    expect(fetchColumnComments(fake([]))[0]?.columns[0]?.comment).toBe(
      'Seconds'
    )
    expect(fetchColumnComments(fake([], false))[0]?.columns[0]?.comment).toBe(
      ''
    )
  })

  test('skips tables the server does not have', () => {
    expect(fetchColumnComments(fake([])).map((t) => t.table)).toEqual([
      'system.merges',
    ])
  })

  test('returns null on versions without the tier column', () => {
    expect(fetchTieredSettings(fake(['name']))).toBeNull()
    expect(fetchTieredSettings(fake(['name', 'tier']))).toHaveLength(1)
  })

  test('toCell keeps one table-safe line', () => {
    expect(toCell('x | y\n\nsecond')).toBe('x \\| y')
  })

  test('renders both tiers and the version', () => {
    const md = renderSettingsTiers('26.5.1', [
      { name: 'a', tier: 'Beta', description: 'd' },
    ])
    expect(md).toContain('## Experimental (0)')
    expect(md).toContain('| `a` | d |')
    expect(renderColumnComments('26.5.1', [])).toContain('26.5.1')
  })
})
