import {
  detectQuickNav,
  menuItemPaletteValue,
  parseTableName,
} from './command-palette-utils'
import { describe, expect, test } from 'bun:test'

describe('detectQuickNav', () => {
  test('empty / whitespace input never matches', () => {
    for (const input of ['', '   ', '\t']) {
      expect(detectQuickNav(input)).toEqual({
        isQueryId: false,
        isTableName: false,
        hasMatch: false,
      })
    }
  })

  test('canonical and dashless UUIDs are query ids', () => {
    const dashed = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'
    const dashless = 'a1b2c3d4e5f67a8b9c0d1e2f3a4b5c6d'
    expect(detectQuickNav(dashed).isQueryId).toBe(true)
    expect(detectQuickNav(dashless).isQueryId).toBe(true)
  })

  test('partial hex input (while typing) still matches a query id', () => {
    expect(detectQuickNav('a1b2c3d4').isQueryId).toBe(true)
    expect(detectQuickNav('a1b2c3d4-e5f6').isQueryId).toBe(true)
  })

  test('trailing non-hex garbage is rejected as a query id', () => {
    // A real query id is entirely hex/dash; reject inputs that drift away.
    expect(detectQuickNav('a1b2c3d4xyz').isQueryId).toBe(false)
  })

  test('a string of only dashes is not a query id', () => {
    // Guards the "Go to query" action from a hyphen-only false positive.
    expect(detectQuickNav('--------').isQueryId).toBe(false)
    expect(detectQuickNav('--------').hasMatch).toBe(false)
  })

  test('input is trimmed before matching', () => {
    expect(detectQuickNav('  a1b2c3d4  ').isQueryId).toBe(true)
    expect(detectQuickNav('  system.tables  ').isTableName).toBe(true)
  })

  test('database.table references are table names, not query ids', () => {
    const match = detectQuickNav('system.query_log')
    expect(match.isTableName).toBe(true)
    expect(match.isQueryId).toBe(false)
    expect(match.hasMatch).toBe(true)
  })

  test('plain words and bare database names do not match', () => {
    for (const input of ['overview', 'queries', 'system']) {
      const match = detectQuickNav(input)
      expect(match.hasMatch).toBe(false)
    }
  })
})

describe('parseTableName', () => {
  test('splits database.table on the first dot', () => {
    expect(parseTableName('system.query_log')).toEqual({
      database: 'system',
      table: 'query_log',
    })
  })

  test('preserves dots in the table portion', () => {
    expect(parseTableName('db.weird.name')).toEqual({
      database: 'db',
      table: 'weird.name',
    })
  })

  test('no dot yields the whole value as database with empty table', () => {
    expect(parseTableName('default')).toEqual({
      database: 'default',
      table: '',
    })
  })

  test('trims surrounding whitespace', () => {
    expect(parseTableName('  system.tables  ')).toEqual({
      database: 'system',
      table: 'tables',
    })
  })
})

describe('menuItemPaletteValue', () => {
  test('includes title, href, description, group, keywords, and page <title>', () => {
    const value = menuItemPaletteValue(
      {
        title: 'Schema Compare',
        href: '/schema-diff',
        description: 'Compare table schemas',
        keywords: ['ddl', 'sync'],
      },
      'Tools'
    )
    expect(value).toContain('Tools')
    expect(value).toContain('Schema Compare')
    expect(value).toContain('Cross-Host Schema Compare')
    expect(value).toContain('/schema-diff')
    expect(value).toContain('Compare table schemas')
    expect(value).toContain('ddl')
    expect(value).toContain('sync')
  })

  test('omits empty optional fields', () => {
    const value = menuItemPaletteValue({
      title: 'Overview',
      href: '/overview',
    })
    expect(value).toContain('Overview')
    expect(value).toContain('Cluster Overview')
    expect(value).toContain('/overview')
  })

  test('TTL menu label also matches the document title', () => {
    const value = menuItemPaletteValue({
      title: 'TTL & Partitions',
      href: '/ttl-partition-health',
    })
    expect(value).toContain('TTL & Partitions')
    expect(value).toContain('TTL & Partition Health')
  })
})
