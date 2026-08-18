import { ttlPartitionHealthConfig } from './ttl-partition-health'
import { describe, expect, test } from 'bun:test'
import { getAllSqlStrings } from '@chm/sql-builder'
import { getQueryConfigByName } from '@/lib/query-config'

describe('ttlPartitionHealthConfig', () => {
  test('is registered by name', () => {
    expect(getQueryConfigByName('ttl-partition-health')?.name).toBe(
      'ttl-partition-health'
    )
  })

  test('is version-aware and never queries part_log', () => {
    const variants = getAllSqlStrings(ttlPartitionHealthConfig.sql)
    expect(variants.length).toBe(2)
    for (const sql of variants) {
      expect(sql).toContain('system.tables')
      expect(sql).toContain('system.parts')
      expect(sql).not.toContain('system.part_log')
    }
  })

  test('older variant parses TTL from CREATE TABLE', () => {
    const sql = getAllSqlStrings(ttlPartitionHealthConfig.sql)[0]
    expect(sql).toContain('create_table_query')
    expect(sql).not.toMatch(/\bt\.ttl\b/)
  })

  test('newer variant reads system.tables.ttl', () => {
    const sql = getAllSqlStrings(ttlPartitionHealthConfig.sql)[1]
    expect(sql).toContain('t.ttl')
  })
})
