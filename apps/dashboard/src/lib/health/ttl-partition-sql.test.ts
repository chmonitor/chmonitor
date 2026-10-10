/**
 * Tests for the shared TTL / PARTITION BY SQL builders.
 *
 * Shape assertions — tables read, thresholds, recommend-only copy — not
 * exact whitespace. The inventory query-config test covers the page SQL.
 */

import type { ChartQueryResult } from '@/types/chart-data'

import { isBatchableRule } from './batch-kpi'
import {
  PARTITION_COUNT_CRITICAL,
  PARTITION_COUNT_WARNING,
  PARTS_PER_PARTITION_WARNING,
} from './ttl-partition-heuristics'
import {
  buildTtlPartitionFlaggedCountSql,
  buildTtlPartitionHealthDetailSql,
  buildTtlPartitionInventorySql,
  TTL_PARTITION_HEALTH_SETTINGS,
  TTL_PARTITION_INVENTORY_SETTINGS,
} from './ttl-partition-sql'
import { describe, expect, test } from 'bun:test'
import { HEALTH_CHECKS } from '@/components/health/health-checks'
import { BUILTIN_RULES } from '@/lib/alerting/builtin-rules'
import { healthCharts } from '@/lib/api/charts/system/health'
import { healthDetailACharts } from '@/lib/api/charts/system/health-detail-a'
import { ttlPartitionHealthConfig } from '@/lib/query-config/system/ttl-partition-health'

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
  // #3684: the cap is a client setting, never SQL text.
  expect(sql).not.toMatch(/SETTINGS\s+max_execution_time/i)
}

describe('buildTtlPartitionInventorySql', () => {
  test('reads tables + parts and parses TTL from engine_full', () => {
    const sql = buildTtlPartitionInventorySql()
    assertSharedConstraints(sql)
    expect(sql).toContain("positionCaseInsensitive(t.engine_full, ' TTL ')")
    expect(sql).toContain('Rebuild with coarser PARTITION BY')
    expect(sql).toContain('Add table TTL')
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

/**
 * #3684: the 15s / 25s caps moved from a `SETTINGS` clause into client
 * settings. Each consumer must carry them explicitly — dropping one would
 * silently raise that path to the 60s default, past the Worker timeout.
 */
describe('TTL partition consumers carry max_execution_time', () => {
  test('caps keep their values', () => {
    expect(TTL_PARTITION_HEALTH_SETTINGS.max_execution_time).toBe(15)
    expect(TTL_PARTITION_INVENTORY_SETTINGS.max_execution_time).toBe(25)
  })

  test('health scalar chart sends 15s', () => {
    const def = healthCharts['health-ttl-partition-health'](
      {}
    ) as ChartQueryResult
    expect(def.clickhouseSettings?.max_execution_time).toBe(15)
    expect(def.query).not.toMatch(/SETTINGS\s+max_execution_time/i)
  })

  test('health detail chart sends 15s', () => {
    const def = healthDetailACharts['health-ttl-partition-health-detail'](
      {}
    ) as ChartQueryResult
    expect(def.clickhouseSettings?.max_execution_time).toBe(15)
    expect(def.query).not.toMatch(/SETTINGS\s+max_execution_time/i)
  })

  test('inventory table config sends 25s', () => {
    expect(
      ttlPartitionHealthConfig.clickhouseSettings?.max_execution_time
    ).toBe(25)
  })

  test('alert rule sends 15s and stays out of the batched sweep', () => {
    const rule = BUILTIN_RULES.find((r) => r.id === 'ttl-partition-health')
    expect(rule?.clickhouseSettings?.max_execution_time).toBe(15)
    expect(rule?.sql).not.toMatch(/SETTINGS\s+max_execution_time/i)
    expect(rule && isBatchableRule(rule)).toBe(false)
  })

  test('any rule with its own settings is never batched', () => {
    // The batch is one request; per-rule settings would be dropped there.
    expect(
      isBatchableRule({
        id: 'x',
        type: 'custom',
        title: 'x',
        description: 'x',
        sql: 'SELECT 1 AS v',
        valueKey: 'v',
        defaults: { warning: 1, critical: 2 },
        clickhouseSettings: { max_execution_time: 5 },
      } as Parameters<typeof isBatchableRule>[0])
    ).toBe(false)
  })
})
