/**
 * Heavy system-log scans must stay bounded.
 *
 * system.query_log and system.part_log grow without limit on busy servers. A
 * query without an event_date bound reads every partition, and a
 * `max(...) OVER ()` evaluated before LIMIT forces the whole filtered set to be
 * materialized. These tests fail if a bound or the LIMIT-in-subquery shape is
 * dropped, from either the TS config or its declarative twin.
 */

import type { QueryConfig } from '@/types/query-config'

import { DECLARATIVE_CATALOG } from '../declarative/catalog'
import { mergePerformanceConfig } from '../merges/merge-performance'
import { hotQueryShapesConfig } from '../more/hot-query-shapes'
import { topUsageColumnsConfig } from '../more/top-usage-columns'
import { topUsageTablesConfig } from '../more/top-usage-tables'
import { unusedColumnsConfig } from '../more/unused-columns'
import { unusedProjectionsConfig } from '../more/unused-projections'
import { unusedTablesConfig } from '../more/unused-tables'
import { queryChildrenConfig } from '../queries/query-children'
import { queryDetailConfig } from '../queries/query-detail'
import {
  USAGE_MAX_DAYS,
  usageByUserConfig,
  usageInactiveUsersConfig,
} from '../queries/usage'
import {
  USER_DAILY_MAX_DAYS,
  userUsageConfigs,
  userUsageDailyConfig,
  userUsageShapesConfig,
} from '../queries/user-usage'
import { partLogConfig } from '../system/part-log'
import { ttlStorageMovesConfig } from '../system/storage-economics'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ColumnFormat } from '@/types/column-format'

const sqlsOf = (c: { sql: QueryConfig['sql'] }): string[] =>
  typeof c.sql === 'string' ? [c.sql] : c.sql.map((v) => v.sql)

const DAYS_BOUND = /event_date >= today\(\) - \{days:UInt16\}/

const daysBounded: [QueryConfig, string][] = [
  [topUsageColumnsConfig, '7'],
  [topUsageTablesConfig, '7'],
  [unusedTablesConfig, '30'],
  [unusedColumnsConfig, '30'],
  [hotQueryShapesConfig, '30'],
  [unusedProjectionsConfig, '30'],
  [mergePerformanceConfig, '30'],
  [queryDetailConfig, '30'],
  [queryChildrenConfig, '30'],
]

describe('event_date-bounded log configs', () => {
  for (const [config, days] of daysBounded) {
    test(`${config.name}: every SQL version has the event_date bound`, () => {
      for (const sql of sqlsOf(config)) expect(sql).toMatch(DAYS_BOUND)
      expect(config.defaultParams?.days).toBe(days)
    })
  }

  test('top-usage-columns: every SQL version is LIMITed', () => {
    for (const sql of sqlsOf(topUsageColumnsConfig))
      expect(sql).toMatch(/LIMIT 200\s*$/)
  })
})

describe('unused-tables: both query_log scans are bounded', () => {
  test('SQL is LIMITed and every query_log read has the event_date bound', () => {
    const [sql] = sqlsOf(unusedTablesConfig)
    expect(sql).toMatch(/LIMIT 200\s*$/)
    const logReads = sql.match(/merge\('system', '\^query_log'\)/g) ?? []
    const bounds = sql.match(/event_date >= today\(\) - \{days:UInt16\}/g) ?? []
    expect(logReads.length).toBe(2)
    expect(bounds.length).toBe(logReads.length)
  })

  test('counts only Select reads, exposes the window start, says "unread"', () => {
    const [sql] = sqlsOf(unusedTablesConfig)
    expect(sql).toContain("query_kind = 'Select'")
    expect(sql).toContain('log_window_start')
    expect(unusedTablesConfig.description).toContain('This replica only')
    expect(unusedTablesConfig.description).not.toMatch(/safe to drop/i)
  })
})

describe('unused-columns / unused-projections: bounded, replica-only, never a verdict', () => {
  const LOG_READ = /merge\('system', '\^query_log'\)/g
  const BOUND = /event_date >= today\(\) - \{days:UInt16\}/g
  const cases: [QueryConfig, string][] = [
    [unusedColumnsConfig, 'unused-columns'],
    [unusedProjectionsConfig, 'unused-projections'],
  ]

  for (const [config, name] of cases) {
    test(`${name}: LIMITed, every query_log read has the event_date bound`, () => {
      for (const sql of sqlsOf(config)) {
        expect(sql).toMatch(/LIMIT 200\s*$/)
        const reads = sql.match(LOG_READ) ?? []
        expect(reads.length).toBe(2)
        expect((sql.match(BOUND) ?? []).length).toBe(reads.length)
      }
      expect(config.defaultParams?.days).toBe('30')
      expect(config.filterParamPresets?.map((p) => p.value)).toEqual([
        '7',
        '30',
        '90',
      ])
    })

    test(`${name}: only finished SELECTs, exposes log_window_start, no verdict wording`, () => {
      for (const sql of sqlsOf(config)) {
        expect(sql).toContain("query_kind = 'Select'")
        expect(sql).toContain("type = 'QueryFinish'")
        expect(sql).toContain('log_window_start')
        // #4084: a lambda alias in WITH breaks under enable_analyzer=0
        expect(sql).not.toMatch(/->[^\n]*\sAS\s+\w+\s*,\s*$/m)
        expect(sql).not.toMatch(/\b(DROP|ALTER)\b/i)
      }
      expect(config.description).toContain('This replica only')
      expect(config.description).not.toMatch(/safe to drop|\bDROP\b|\bALTER\b/i)
    })

    test(`${name}: BackgroundBar column has its pct_ and raw companions`, () => {
      const [sql] = sqlsOf(config)
      expect(config.columnFormats?.readable_bytes).toBe(
        ColumnFormat.BackgroundBar
      )
      expect(sql).toContain('AS readable_bytes')
      expect(sql).toContain('AS pct_bytes')
      expect(sql).toMatch(/AS bytes\b/)
    })
  }

  test('unused-columns: SELECT * queries are excluded server-side and the caveat is stated', () => {
    const [sql] = sqlsOf(unusedColumnsConfig)
    expect(sql).toContain("NOT match(query, '(?i)select\\\\s+\\\\*')")
    expect(sql).toContain('{table:String}')
    expect(sql).not.toMatch(/SELECT\s+query\b|,\s*query\s*[,\n]/)
    expect(unusedColumnsConfig.description).toContain('SELECT *')
    expect(unusedColumnsConfig.description).toMatch(/not the same as unused/)
    expect(unusedColumnsConfig.defaultParams?.table).toBe('')
  })

  test('unused-projections: gated by since and by both tables it reads', () => {
    expect(Array.isArray(unusedProjectionsConfig.sql)).toBe(true)
    expect(unusedProjectionsConfig.tableCheck).toEqual([
      'system.query_log',
      'system.projections',
    ])
    expect(unusedProjectionsConfig.description).toMatch(
      /not the same as unneeded/
    )
  })
})

describe('hot-query-shapes: bounded, replica-only, data only, never a verdict', () => {
  const [sql] = sqlsOf(hotQueryShapesConfig)

  test('LIMIT 50, one query_log read with the event_date bound, only finished SELECTs', () => {
    expect(sql).toMatch(/LIMIT 50\s*$/)
    expect((sql.match(/merge\('system', '\^query_log'\)/g) ?? []).length).toBe(
      1
    )
    expect(
      (sql.match(/event_date >= today\(\) - \{days:UInt16\}/g) ?? []).length
    ).toBe(1)
    expect(sql).toContain("query_kind = 'Select'")
    expect(sql).toContain("type = 'QueryFinish'")
    expect(hotQueryShapesConfig.defaultParams?.days).toBe('30')
    expect(hotQueryShapesConfig.defaultParams?.table).toBe('')
    expect(
      hotQueryShapesConfig.filterParamPresets?.map((p) => p.value)
    ).toEqual(['7', '30', '90'])
  })

  test('never returns the raw query: only truncated normalizeQuery text', () => {
    expect(sql).toContain(
      'substring(normalizeQuery(any(query)), 1, 300) AS sample'
    )
    expect(sql).not.toMatch(/SELECT\s+query\b|,\s*query\s*[,\n]/)
  })

  test('multi-table bytes are split evenly and the table param is the only filter', () => {
    expect(sql).toContain('sum(read_bytes / length(tables))')
    expect(sql).toContain('{table:String}')
    expect(hotQueryShapesConfig.description).toMatch(/split evenly/)
  })

  test('no lambda alias in WITH (#4084), no DDL, no verdict wording', () => {
    expect(sql).not.toMatch(/->[^\n]*\sAS\s+\w+\s*,\s*$/m)
    expect(sql).not.toMatch(/\b(DROP|ALTER)\b/i)
    expect(sql).not.toMatch(/\b(verdict|recommend|misses)\b/i)
    const d = hotQueryShapesConfig.description ?? ''
    expect(d).toContain('THIS REPLICA ONLY')
    expect(d).toContain('a hash read on another replica or shard is not shown')
    expect(d).toContain('No judgement is made')
    expect(d).not.toMatch(/safe to drop|\bDROP\b|\bALTER\b/i)
  })

  test('sorting_key and partition_key are context columns; BackgroundBar has its companions', () => {
    expect(hotQueryShapesConfig.columns).toEqual(
      expect.arrayContaining([
        'sorting_key',
        'partition_key',
        'p50_ms',
        'p95_ms',
      ])
    )
    expect(hotQueryShapesConfig.columnFormats?.readable_bytes).toBe(
      ColumnFormat.BackgroundBar
    )
    expect(sql).toContain('AS readable_bytes')
    expect(sql).toContain('AS pct_bytes')
    expect(sql).toMatch(/AS bytes\b/)
  })
})

describe('usage pages (#4125): capped window, end events only, LIMITed', () => {
  // URL search params reach ClickHouse unchanged, so the cap must live in the
  // SQL: `?days=9999` must still read at most the capped number of days.
  const capped = (max: number) =>
    `event_date >= today() - least({days:UInt16}, ${max})`
  const all = [usageByUserConfig, usageInactiveUsersConfig, ...userUsageConfigs]
  const aggregate = all.filter((c) => c !== userUsageDailyConfig)

  test('aggregate tables cap the window at 30 days, default 7', () => {
    expect(USAGE_MAX_DAYS).toBe(30)
    for (const c of aggregate) {
      const [sql] = sqlsOf(c)
      expect(sql).toContain(capped(30))
      expect(c.defaultParams?.days).toBe('7')
      expect(sql).toMatch(/LIMIT \d+\s*$/)
    }
  })

  test('daily activity (one row per day) is the only config allowed a year', () => {
    const [sql] = sqlsOf(userUsageDailyConfig)
    expect(USER_DAILY_MAX_DAYS).toBe(365)
    expect(sql).toContain(capped(365))
    expect(sql).toContain('GROUP BY day')
    expect(sql).toMatch(/LIMIT 366\s*$/)
  })

  test('every scan reads one merged query log and never counts QueryStart', () => {
    for (const c of all) {
      const [sql] = sqlsOf(c)
      expect(
        (sql.match(/merge\('system', '\^query_log'\)/g) ?? []).length
      ).toBe(1)
      expect(sql).not.toContain('QueryStart')
      expect(c.description).toContain('THIS REPLICA ONLY')
    }
  })

  test('detail configs filter on the user param', () => {
    for (const c of userUsageConfigs) {
      expect(sqlsOf(c)[0]).toContain('user = {user:String}')
      expect(c.defaultParams?.user).toBe('')
    }
  })

  test('user link is URL-encoded server-side (names may contain & or spaces)', () => {
    expect(sqlsOf(usageByUserConfig)[0]).toContain(
      'encodeURLComponent(user) AS user_param'
    )
    expect(usageByUserConfig.columnFormats?.user).toEqual([
      ColumnFormat.Link,
      { href: '/usage/user?user=[user_param]&host=[ctx.hostId]' },
    ])
  })

  test('query shapes return only truncated normalized text, never the raw query', () => {
    const [sql] = sqlsOf(userUsageShapesConfig)
    expect(sql).toContain(
      'substring(normalizeQuery(any(query)), 1, 300) AS sample'
    )
    expect(sql).not.toMatch(/SELECT\s+query\b|,\s*query\s*[,\n]/)
  })

  test('no lambda alias in WITH (#4084), no writes', () => {
    for (const c of all) {
      const [sql] = sqlsOf(c)
      expect(sql).not.toMatch(/\bWITH\b/)
      expect(sql).not.toMatch(/\b(DROP|ALTER|INSERT INTO|KILL)\b/)
    }
  })
})
describe('part_log window queries bound rows before the window function', () => {
  const cases: [QueryConfig, number][] = [
    [partLogConfig, 1000],
    [ttlStorageMovesConfig, 500],
  ]
  for (const [config, limit] of cases) {
    test(`${config.name}: time filter + LIMIT live in the inner subquery`, () => {
      const sql = sqlsOf(config)[0]
      const inner = sql.slice(sql.indexOf('FROM ('), sql.lastIndexOf(')'))
      expect(inner).toContain('FROM system.part_log')
      expect(inner).toMatch(
        /event_time > now\(\) - INTERVAL \{last_hours:UInt64\} HOUR/
      )
      expect(inner).toMatch(/event_date >= toDate\(/)
      expect(inner).toContain(`LIMIT ${limit}`)
      // The window function is computed only in the outer query.
      expect(inner).not.toContain('OVER ()')
      expect(sql.slice(0, sql.indexOf('FROM ('))).toContain('OVER ()')
      expect(config.defaultParams?.last_hours).toBeDefined()
    })
  }
})

describe('declarative twins carry the same bounds', () => {
  for (const config of [
    topUsageColumnsConfig,
    topUsageTablesConfig,
    mergePerformanceConfig,
    queryDetailConfig,
    partLogConfig,
  ]) {
    test(`${config.name}: twin SQL and defaultParams match the TS config`, () => {
      const twin = DECLARATIVE_CATALOG[config.name]
      expect(twin).toBeDefined()
      expect(sqlsOf(twin as { sql: QueryConfig['sql'] })).toEqual(
        sqlsOf(config)
      )
      expect(twin.defaultParams).toEqual(config.defaultParams)
    })
  }
})

test('explorer query-log lookup is bounded by event_date', () => {
  const src = readFileSync(
    join(
      fileURLToPath(new URL('.', import.meta.url)),
      '../../../routes/api/v1/explorer/query-log.ts'
    ),
    'utf8'
  )
  const sql = src.match(/const QUERY_LOG_SQL = `([\s\S]*?)`/)?.[1] ?? ''
  expect(sql).toMatch(DAYS_BOUND)
  expect(src).toContain(
    'query_params: { queryId, days: QUERY_LOG_LOOKBACK_DAYS }'
  )
})
