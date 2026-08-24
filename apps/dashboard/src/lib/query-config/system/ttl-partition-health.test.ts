import { ttlPartitionHealthConfig } from './ttl-partition-health'
import { describe, expect, test } from 'bun:test'
import { getAllSqlStrings } from '@chm/sql-builder'
import { getQueryConfigByName } from '@/lib/query-config'
import { ColumnFormat } from '@/types/column-format'

describe('ttlPartitionHealthConfig', () => {
  test('is registered by name', () => {
    expect(getQueryConfigByName('ttl-partition-health')?.name).toBe(
      'ttl-partition-health'
    )
  })

  test('never queries part_log, create_table_query, or a fictional tables.ttl', () => {
    const variants = getAllSqlStrings(ttlPartitionHealthConfig.sql)
    expect(variants.length).toBeGreaterThanOrEqual(1)
    for (const sql of variants) {
      expect(sql).toContain('system.tables')
      expect(sql).toContain('system.parts')
      expect(sql).toContain('engine_full')
      expect(sql).toContain('mergetree_tables')
      expect(sql).not.toContain('system.part_log')
      expect(sql).not.toContain('create_table_query')
      expect(sql).not.toMatch(/\bt\.ttl\b/)
    }
  })

  test('parses table TTL from engine_full before SETTINGS', () => {
    const sql = getAllSqlStrings(ttlPartitionHealthConfig.sql)[0]
    expect(sql).toContain("positionCaseInsensitive(t.engine_full, ' TTL ')")
    expect(sql).toContain('SETTINGS')
  })

  test('filters system databases on both tables and parts', () => {
    const sql = getAllSqlStrings(ttlPartitionHealthConfig.sql)[0]
    const systemFilter =
      "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')"
    expect(sql).toContain(systemFilter)
    expect(sql.split(systemFilter).length - 1).toBeGreaterThanOrEqual(2)
  })

  test('caps execution under the Worker wall-clock', () => {
    const sql = getAllSqlStrings(ttlPartitionHealthConfig.sql)[0]
    expect(sql).toContain('SETTINGS max_execution_time = 25')
  })

  test('keeps inventory columns used by row highlighting and recommendations', () => {
    for (const col of [
      'full_table',
      'partition_key',
      'ttl_expression',
      'recommendation',
      'partitions',
      'active_parts',
      'ttl_retention',
      'readable_bytes_past_ttl',
    ]) {
      expect(ttlPartitionHealthConfig.columns).toContain(col)
    }
    expect(ttlPartitionHealthConfig.rowClassName).toBeDefined()
    expect(ttlPartitionHealthConfig.columnFormats?.ttl_retention).toBe(
      ColumnFormat.StackedShare
    )
  })

  test('recommendation SQL uses the same partition thresholds as the heuristics', () => {
    const sql = getAllSqlStrings(ttlPartitionHealthConfig.sql)[0]
    expect(sql).toContain('recommendation')
    expect(sql).toContain('Rebuild with coarser PARTITION BY')
    expect(sql).toContain('Add table TTL')
    expect(sql).toContain(String(500))
    expect(sql).toContain(String(1000))
  })
})
