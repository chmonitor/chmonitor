/**
 * Tests for the shared TTL / PARTITION BY SQL builders.
 *
 * Shape assertions — tables read, thresholds, recommend-only copy — not
 * exact whitespace. The inventory query-config test covers the page SQL.
 */

import {
  PARTITION_COUNT_CRITICAL,
  PARTITION_COUNT_WARNING,
  PARTS_PER_PARTITION_WARNING,
} from './ttl-partition-heuristics'
import {
  buildTtlPartitionFlaggedCountSql,
  buildTtlPartitionHealthDetailSql,
  buildTtlPartitionInventorySql,
  TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME,
  TTL_PARTITION_INVENTORY_MAX_EXECUTION_TIME,
} from './ttl-partition-sql'
import { describe, expect, test } from 'bun:test'
import { HEALTH_CHECKS } from '@/components/health/health-checks'

function assertSharedConstraints(sql: string) {
  expect(sql).toContain('system.tables')
  expect(sql).toContain('system.parts')
  expect(sql).toContain('engine_full')
  expect(sql).toContain('mergetree_tables')
  expect(sql).toContain(String(PARTITION_COUNT_WARNING))
  expect(sql).toContain(String(PARTITION_COUNT_CRITICAL))
  expect(sql).toContain(String(PARTS_PER_PARTITION_WARNING))
  expect(sql).not.toContain('system.part_log')
  expect(sql).not.toContain('create_table_query')
  expect(sql).not.toMatch(/\bt\.ttl\b/)
}

describe('buildTtlPartitionInventorySql', () => {
  test('reads tables + parts and parses TTL from engine_full', () => {
    const sql = buildTtlPartitionInventorySql()
    assertSharedConstraints(sql)
    expect(sql).toContain("positionCaseInsensitive(t.engine_full, ' TTL ')")
    expect(sql).toContain('Rebuild with coarser PARTITION BY')
    expect(sql).toContain('Add table TTL')
    expect(sql).toContain(
      `SETTINGS max_execution_time = ${TTL_PARTITION_INVENTORY_MAX_EXECUTION_TIME}`
    )
    expect(sql).toContain('bytes_past_ttl')
    expect(sql).toContain('bytes_in_range')
    expect(sql).toContain('ttl_retention')
    expect(sql).toContain('max_date')
    expect(sql).toContain('INTERVAL')
  })
})

describe('buildTtlPartitionFlaggedCountSql', () => {
  test('counts tables with a non-empty recommendation', () => {
    const sql = buildTtlPartitionFlaggedCountSql()
    assertSharedConstraints(sql)
    expect(sql).toContain('flagged_count')
    expect(sql).toContain("WHERE recommendation != ''")
    expect(sql).toContain(
      `SETTINGS max_execution_time = ${TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME}`
    )
  })
})

describe('buildTtlPartitionHealthDetailSql', () => {
  test('returns flagged tables worst-first with a row cap', () => {
    const sql = buildTtlPartitionHealthDetailSql({ limit: 20 })
    assertSharedConstraints(sql)
    expect(sql).toContain('full_table')
    expect(sql).toContain('recommendation')
    expect(sql).toContain("WHERE recommendation != ''")
    expect(sql).toContain('LIMIT 20')
    expect(sql).toContain(
      `SETTINGS max_execution_time = ${TTL_PARTITION_HEALTH_MAX_EXECUTION_TIME}`
    )
  })
})

describe('HEALTH_CHECKS ttl-partition-health', () => {
  const check = HEALTH_CHECKS.find((c) => c.id === 'ttl-partition-health')

  test('is registered as a count check with a detail breakdown', () => {
    expect(check).toBeDefined()
    expect(check?.chartName).toBe('health-ttl-partition-health')
    expect(check?.detailChartName).toBe('health-ttl-partition-health-detail')
    expect(check?.valueKey).toBe('flagged_count')
    expect(check?.defaults.warning).toBeGreaterThanOrEqual(1)
    expect(check?.defaults.critical).toBeGreaterThan(
      check?.defaults.warning ?? 0
    )
  })

  test('display SQL matches the shared flagged-count builder', () => {
    expect(check?.sql).toBe(buildTtlPartitionFlaggedCountSql())
  })
})
