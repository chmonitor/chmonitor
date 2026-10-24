/**
 * Offline twin of the live sweep in `test-queries-config` (not a required
 * check). The sweep builds every chart and table with no params; #4177 merged
 * a chart whose builder threw on that call and only the live job saw it
 * (fixed in #4179). This runs the same builds without a server, in the
 * required `unit-tests` job.
 */

import { describe, expect, test } from 'bun:test'
import { getAllSqlStrings } from '@chm/sql-builder'
import { getAvailableCharts, getChartQuery } from '@/lib/api/chart-registry'
import { findMissingQueryParams } from '@/lib/api/query-executor'
import { getAvailableTables, getTableQuery } from '@/lib/api/table-registry'
import { SWEEP_REAL_PARAMS } from './sweep-params'

function errorOf(fn: () => unknown): string | null {
  try {
    fn()
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

describe('registry builds with default params (as the live sweep calls them)', () => {
  test('every chart builds non-empty SQL with no params', () => {
    const failed: string[] = []
    for (const name of getAvailableCharts().sort()) {
      let def: ReturnType<typeof getChartQuery> = null
      const err = errorOf(() => {
        def = getChartQuery(name)
      })
      if (err) {
        failed.push(`${name}: threw ${err}`)
        continue
      }
      const built = def as ReturnType<typeof getChartQuery>
      if (!built) {
        failed.push(`${name}: built no query`)
        continue
      }
      const sqls =
        'queries' in built
          ? built.queries.map((q) => q.query)
          : [built.query, ...(built.sql ? getAllSqlStrings(built.sql) : [])]
      if (sqls.length === 0 || sqls.some((s) => !s?.trim())) {
        failed.push(`${name}: empty SQL`)
      }
    }
    expect(getAvailableCharts().length).toBeGreaterThan(0)
    expect(failed).toEqual([])
  })

  test('every table builds non-empty SQL with no params', () => {
    const failed: string[] = []
    for (const name of getAvailableTables()) {
      let def: ReturnType<typeof getTableQuery> = null
      const err = errorOf(() => {
        def = getTableQuery(name, { hostId: 0, searchParams: {} })
      })
      if (err) {
        failed.push(`${name}: threw ${err}`)
        continue
      }
      const built = def as ReturnType<typeof getTableQuery>
      const sqls = built ? getAllSqlStrings(built.queryConfig.sql) : []
      if (sqls.length === 0 || sqls.some((s) => !s?.trim())) {
        failed.push(`${name}: empty SQL`)
      }
    }
    expect(getAvailableTables().length).toBeGreaterThan(0)
    expect(failed).toEqual([])
  })

  // The sweep sends a chart's own `queryParams` and nothing else (multi-query
  // charts get none), so every placeholder must have a default.
  test('every chart {name:Type} placeholder has a default', () => {
    const failed: string[] = []
    for (const name of getAvailableCharts().sort()) {
      const def = getChartQuery(name)
      if (!def) continue
      const runs =
        'queries' in def
          ? def.queries.map((q) => ({ sql: q.query, params: {} }))
          : [def.query, ...(def.sql ? getAllSqlStrings(def.sql) : [])].map(
              (sql) => ({ sql, params: def.queryParams ?? {} })
            )
      for (const { sql, params } of runs) {
        const missing = findMissingQueryParams(sql, params)
        if (missing.length) failed.push(`${name}: ${missing.join(', ')}`)
      }
    }
    expect(failed).toEqual([])
  })

  // A table placeholder with no default answers 400 bare (#3918); the sweep
  // then retries with a real value, which it only has for SWEEP_REAL_PARAMS.
  test('every table placeholder without a default is one the sweep can fill', () => {
    const known = new Set<string>(SWEEP_REAL_PARAMS)
    const failed: string[] = []
    for (const name of getAvailableTables()) {
      const def = getTableQuery(name, { hostId: 0, searchParams: {} })
      if (!def) continue
      for (const sql of getAllSqlStrings(def.queryConfig.sql)) {
        const unknown = findMissingQueryParams(sql, def.queryParams).filter(
          (p) => !known.has(p)
        )
        if (unknown.length) failed.push(`${name}: ${unknown.join(', ')}`)
      }
    }
    expect(failed).toEqual([])
  })
})
