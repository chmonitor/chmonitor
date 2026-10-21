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
import { topUsageColumnsConfig } from '../more/top-usage-columns'
import { topUsageTablesConfig } from '../more/top-usage-tables'
import { unusedTablesConfig } from '../more/unused-tables'
import { queryChildrenConfig } from '../queries/query-children'
import { queryDetailConfig } from '../queries/query-detail'
import { partLogConfig } from '../system/part-log'
import { ttlStorageMovesConfig } from '../system/storage-economics'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sqlsOf = (c: { sql: QueryConfig['sql'] }): string[] =>
  typeof c.sql === 'string' ? [c.sql] : c.sql.map((v) => v.sql)

const DAYS_BOUND = /event_date >= today\(\) - \{days:UInt16\}/

const daysBounded: [QueryConfig, string][] = [
  [topUsageColumnsConfig, '7'],
  [topUsageTablesConfig, '7'],
  [unusedTablesConfig, '30'],
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
