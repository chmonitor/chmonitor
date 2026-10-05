/**
 * Tests for anomaly-queries.ts
 *
 * Validates each exported QueryConfig's required shape (name, sql, columns)
 * and all field-level contracts: defaultParams, optional, tableCheck,
 * columnFormats, and versioned-sql structure.
 */

import {
  anomalyQueries,
  anomalySummaryConfig,
  diskUsageChangeConfig,
  errorRateBaselineConfig,
  memoryUsageBaselineConfig,
  mergePerformanceBaselineConfig,
  queryCountBaselineConfig,
  replicationLagBaselineConfig,
} from './anomaly-queries'
import { describe, expect, test } from 'bun:test'
import { ColumnFormat } from '@/types/column-format'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten versioned or plain sql into one string for assertions. */
function allSql(config: { sql: string | { sql: string }[] }): string {
  return typeof config.sql === 'string'
    ? config.sql
    : config.sql.map((v) => v.sql).join('\n')
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

// ---------------------------------------------------------------------------
// Shape guard — applies to every exported QueryConfig
// ---------------------------------------------------------------------------

describe('all anomaly QueryConfig objects — common shape', () => {
  const configs = [
    queryCountBaselineConfig,
    memoryUsageBaselineConfig,
    mergePerformanceBaselineConfig,
    replicationLagBaselineConfig,
    errorRateBaselineConfig,
    diskUsageChangeConfig,
    anomalySummaryConfig,
  ]

  for (const config of configs) {
    test(`${config.name}: has a non-empty name`, () => {
      expect(isNonEmptyString(config.name)).toBe(true)
    })

    test(`${config.name}: has a non-empty description`, () => {
      expect(isNonEmptyString(config.description)).toBe(true)
    })

    test(`${config.name}: has a non-empty sql (string or versioned array)`, () => {
      if (typeof config.sql === 'string') {
        expect(config.sql.trim().length).toBeGreaterThan(0)
      } else {
        expect(Array.isArray(config.sql)).toBe(true)
        expect(config.sql.length).toBeGreaterThan(0)
        for (const entry of config.sql) {
          expect(isNonEmptyString(entry.sql)).toBe(true)
          expect(isNonEmptyString(entry.since)).toBe(true)
        }
      }
    })

    test(`${config.name}: has a non-empty columns array`, () => {
      expect(Array.isArray(config.columns)).toBe(true)
      expect(config.columns.length).toBeGreaterThan(0)
    })

    test(`${config.name}: all columns are non-empty strings`, () => {
      for (const col of config.columns) {
        expect(isNonEmptyString(col)).toBe(true)
      }
    })

    test(`${config.name}: sql references all declared columns`, () => {
      const sql = allSql(config)
      for (const col of config.columns) {
        expect(sql).toContain(col)
      }
    })
  }
})

// ---------------------------------------------------------------------------
// queryCountBaselineConfig
// ---------------------------------------------------------------------------

describe('queryCountBaselineConfig', () => {
  test('name is query-count-baseline', () => {
    expect(queryCountBaselineConfig.name).toBe('query-count-baseline')
  })

  test('sql is a plain string', () => {
    expect(typeof queryCountBaselineConfig.sql).toBe('string')
  })

  test('columns are timestamp, time_bucket, query_count', () => {
    expect(queryCountBaselineConfig.columns).toEqual([
      'timestamp',
      'time_bucket',
      'query_count',
    ])
  })

  test('defaultParams.baseline_hours is 24', () => {
    expect(queryCountBaselineConfig.defaultParams?.baseline_hours).toBe(24)
  })

  test('sql selects from system.query_log', () => {
    expect(allSql(queryCountBaselineConfig)).toContain('system.query_log')
  })

  test('sql filters QueryFinish events', () => {
    expect(allSql(queryCountBaselineConfig)).toContain("type = 'QueryFinish'")
  })

  test('has no tableCheck or optional flags (non-optional table)', () => {
    expect(queryCountBaselineConfig.optional).toBeUndefined()
    expect(queryCountBaselineConfig.tableCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// memoryUsageBaselineConfig
// ---------------------------------------------------------------------------

describe('memoryUsageBaselineConfig', () => {
  test('name is memory-usage-baseline', () => {
    expect(memoryUsageBaselineConfig.name).toBe('memory-usage-baseline')
  })

  test('sql is a versioned array with 2 entries', () => {
    expect(Array.isArray(memoryUsageBaselineConfig.sql)).toBe(true)
    expect((memoryUsageBaselineConfig.sql as unknown[]).length).toBe(2)
  })

  test('versioned entries have ascending since values', () => {
    const versions = memoryUsageBaselineConfig.sql as {
      since: string
      sql: string
    }[]
    expect(versions[0].since).toBe('23.8')
    expect(versions[1].since).toBe('24.1')
  })

  test('newer version adds avg_cache_hit_memory column reference', () => {
    const versions = memoryUsageBaselineConfig.sql as {
      since: string
      sql: string
    }[]
    expect(versions[1].sql).toContain('avg_cache_hit_memory')
    expect(versions[1].sql).toContain("query_cache_usage = 'Read'")
    expect(versions[0].sql).not.toContain('avg_cache_hit_memory')
  })

  test('columns include all baseline memory metrics', () => {
    expect(memoryUsageBaselineConfig.columns).toContain('avg_memory')
    expect(memoryUsageBaselineConfig.columns).toContain('max_memory')
    expect(memoryUsageBaselineConfig.columns).toContain('p95_memory')
    expect(memoryUsageBaselineConfig.columns).toContain('p99_memory')
  })

  test('columnFormats uses NumberShort for memory columns', () => {
    const fmt = memoryUsageBaselineConfig.columnFormats
    expect(fmt?.avg_memory).toBe(ColumnFormat.NumberShort)
    expect(fmt?.max_memory).toBe(ColumnFormat.NumberShort)
    expect(fmt?.p95_memory).toBe(ColumnFormat.NumberShort)
    expect(fmt?.p99_memory).toBe(ColumnFormat.NumberShort)
  })

  test('defaultParams.baseline_hours is 24', () => {
    expect(memoryUsageBaselineConfig.defaultParams?.baseline_hours).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// mergePerformanceBaselineConfig
// ---------------------------------------------------------------------------

describe('mergePerformanceBaselineConfig', () => {
  test('name is merge-performance-baseline', () => {
    expect(mergePerformanceBaselineConfig.name).toBe(
      'merge-performance-baseline'
    )
  })

  test('sql is a plain string', () => {
    expect(typeof mergePerformanceBaselineConfig.sql).toBe('string')
  })

  test('is marked optional with tableCheck system.part_log', () => {
    expect(mergePerformanceBaselineConfig.optional).toBe(true)
    expect(mergePerformanceBaselineConfig.tableCheck).toBe('system.part_log')
  })

  test('columns include elapsed and merge_count', () => {
    const cols = mergePerformanceBaselineConfig.columns
    expect(cols).toContain('avg_elapsed')
    expect(cols).toContain('max_elapsed')
    expect(cols).toContain('p95_elapsed')
    expect(cols).toContain('merge_count')
  })

  test('columnFormats uses Duration for elapsed columns', () => {
    const fmt = mergePerformanceBaselineConfig.columnFormats
    expect(fmt?.avg_elapsed).toBe(ColumnFormat.Duration)
    expect(fmt?.max_elapsed).toBe(ColumnFormat.Duration)
    expect(fmt?.p95_elapsed).toBe(ColumnFormat.Duration)
  })

  test('sql queries system.part_log for MergeParts events', () => {
    const sql = allSql(mergePerformanceBaselineConfig)
    expect(sql).toContain('system.part_log')
    expect(sql).toContain('MergeParts')
  })

  test('defaultParams.baseline_hours is 24', () => {
    expect(mergePerformanceBaselineConfig.defaultParams?.baseline_hours).toBe(
      24
    )
  })
})

// ---------------------------------------------------------------------------
// replicationLagBaselineConfig
// ---------------------------------------------------------------------------

describe('replicationLagBaselineConfig', () => {
  test('name is replication-lag-baseline', () => {
    expect(replicationLagBaselineConfig.name).toBe('replication-lag-baseline')
  })

  test('is marked optional with tableCheck system.replication_queue', () => {
    expect(replicationLagBaselineConfig.optional).toBe(true)
    expect(replicationLagBaselineConfig.tableCheck).toBe(
      'system.replication_queue'
    )
  })

  test('columns include lag metrics and queue_entries', () => {
    const cols = replicationLagBaselineConfig.columns
    expect(cols).toContain('avg_lag')
    expect(cols).toContain('max_lag')
    expect(cols).toContain('p95_lag')
    expect(cols).toContain('queue_entries')
  })

  test('columnFormats uses Duration for lag columns', () => {
    const fmt = replicationLagBaselineConfig.columnFormats
    expect(fmt?.avg_lag).toBe(ColumnFormat.Duration)
    expect(fmt?.max_lag).toBe(ColumnFormat.Duration)
    expect(fmt?.p95_lag).toBe(ColumnFormat.Duration)
  })

  test('sql queries system.replication_queue', () => {
    expect(allSql(replicationLagBaselineConfig)).toContain(
      'system.replication_queue'
    )
  })

  test('defaultParams.baseline_hours is 24', () => {
    expect(replicationLagBaselineConfig.defaultParams?.baseline_hours).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// errorRateBaselineConfig
// ---------------------------------------------------------------------------

describe('errorRateBaselineConfig', () => {
  test('name is error-rate-baseline', () => {
    expect(errorRateBaselineConfig.name).toBe('error-rate-baseline')
  })

  test('sql is a plain string', () => {
    expect(typeof errorRateBaselineConfig.sql).toBe('string')
  })

  test('columns include all rate fields', () => {
    const cols = errorRateBaselineConfig.columns
    expect(cols).toContain('error_rate')
    expect(cols).toContain('error_before_start_rate')
    expect(cols).toContain('error_while_processing_rate')
    expect(cols).toContain('total_queries')
  })

  test('columnFormats uses Number for all rate columns', () => {
    const fmt = errorRateBaselineConfig.columnFormats
    expect(fmt?.error_rate).toBe(ColumnFormat.Number)
    expect(fmt?.error_before_start_rate).toBe(ColumnFormat.Number)
    expect(fmt?.error_while_processing_rate).toBe(ColumnFormat.Number)
  })

  test('sql covers ExceptionBeforeStart and ExceptionWhileProcessing', () => {
    const sql = allSql(errorRateBaselineConfig)
    expect(sql).toContain('ExceptionBeforeStart')
    expect(sql).toContain('ExceptionWhileProcessing')
  })

  test('sql uses countIf for error type discrimination', () => {
    expect(allSql(errorRateBaselineConfig)).toContain('countIf')
  })

  test('defaultParams.baseline_hours is 24', () => {
    expect(errorRateBaselineConfig.defaultParams?.baseline_hours).toBe(24)
  })

  test('has no optional or tableCheck (system.query_log always present)', () => {
    expect(errorRateBaselineConfig.optional).toBeUndefined()
    expect(errorRateBaselineConfig.tableCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// diskUsageChangeConfig
// ---------------------------------------------------------------------------

describe('diskUsageChangeConfig', () => {
  test('name is disk-usage-change', () => {
    expect(diskUsageChangeConfig.name).toBe('disk-usage-change')
  })

  test('sql is a plain string', () => {
    expect(typeof diskUsageChangeConfig.sql).toBe('string')
  })

  test('columns include disk_name, database, table, total_bytes, readable_size, total_rows', () => {
    const cols = diskUsageChangeConfig.columns
    expect(cols).toContain('disk_name')
    expect(cols).toContain('database')
    expect(cols).toContain('table')
    expect(cols).toContain('total_bytes')
    expect(cols).toContain('readable_size')
    expect(cols).toContain('total_rows')
  })

  test('columnFormats: total_bytes=NumberShort, readable_size=Text, total_rows=Number', () => {
    const fmt = diskUsageChangeConfig.columnFormats
    expect(fmt?.total_bytes).toBe(ColumnFormat.NumberShort)
    expect(fmt?.readable_size).toBe(ColumnFormat.Text)
    expect(fmt?.total_rows).toBe(ColumnFormat.Number)
  })

  test('sql queries system.parts with active filter', () => {
    const sql = allSql(diskUsageChangeConfig)
    expect(sql).toContain('system.parts')
    expect(sql).toContain('active')
  })

  test('sql is bounded by LIMIT 10000', () => {
    expect(allSql(diskUsageChangeConfig)).toContain('LIMIT 10000')
  })

  test('defaultParams.baseline_hours is 24', () => {
    expect(diskUsageChangeConfig.defaultParams?.baseline_hours).toBe(24)
  })
})

// ---------------------------------------------------------------------------
// anomalySummaryConfig
// ---------------------------------------------------------------------------

describe('anomalySummaryConfig', () => {
  test('name is anomaly-summary', () => {
    expect(anomalySummaryConfig.name).toBe('anomaly-summary')
  })

  test('sql is a plain string', () => {
    expect(typeof anomalySummaryConfig.sql).toBe('string')
  })

  test('columns include anomaly_type, current_value, baseline_value, deviation_percent, severity', () => {
    expect(anomalySummaryConfig.columns).toEqual([
      'anomaly_type',
      'current_value',
      'baseline_value',
      'deviation_percent',
      'severity',
    ])
  })

  test('columnFormats uses Number for numeric output columns', () => {
    const fmt = anomalySummaryConfig.columnFormats
    expect(fmt?.current_value).toBe(ColumnFormat.Number)
    expect(fmt?.baseline_value).toBe(ColumnFormat.Number)
    expect(fmt?.deviation_percent).toBe(ColumnFormat.Number)
  })

  test('sql contains both anomaly type literals: query_spike and memory_anomaly', () => {
    const sql = allSql(anomalySummaryConfig)
    expect(sql).toContain('query_spike')
    expect(sql).toContain('memory_anomaly')
  })

  test('sql uses UNION ALL to combine anomaly rows', () => {
    expect(allSql(anomalySummaryConfig)).toContain('UNION ALL')
  })

  test('severity has critical, high, medium, and normal cases', () => {
    const sql = allSql(anomalySummaryConfig)
    expect(sql).toContain("'critical'")
    expect(sql).toContain("'high'")
    expect(sql).toContain("'medium'")
    expect(sql).toContain("'normal'")
  })

  test('has no defaultParams (uses inline time intervals)', () => {
    expect(anomalySummaryConfig.defaultParams).toBeUndefined()
  })

  test('has no optional or tableCheck', () => {
    expect(anomalySummaryConfig.optional).toBeUndefined()
    expect(anomalySummaryConfig.tableCheck).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// anomalyQueries array — aggregate export
// ---------------------------------------------------------------------------

describe('anomalyQueries array', () => {
  const expectedNames = [
    'query-count-baseline',
    'memory-usage-baseline',
    'merge-performance-baseline',
    'replication-lag-baseline',
    'error-rate-baseline',
    'disk-usage-change',
    'anomaly-summary',
  ]

  test('exports all 7 configs', () => {
    expect(anomalyQueries.length).toBe(7)
  })

  test('contains all expected names in order', () => {
    expect(anomalyQueries.map((c) => c.name)).toEqual(expectedNames)
  })

  test('each entry is the same reference as the named export', () => {
    expect(anomalyQueries[0]).toBe(queryCountBaselineConfig)
    expect(anomalyQueries[1]).toBe(memoryUsageBaselineConfig)
    expect(anomalyQueries[2]).toBe(mergePerformanceBaselineConfig)
    expect(anomalyQueries[3]).toBe(replicationLagBaselineConfig)
    expect(anomalyQueries[4]).toBe(errorRateBaselineConfig)
    expect(anomalyQueries[5]).toBe(diskUsageChangeConfig)
    expect(anomalyQueries[6]).toBe(anomalySummaryConfig)
  })

  test('all names are unique', () => {
    const names = anomalyQueries.map((c) => c.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
