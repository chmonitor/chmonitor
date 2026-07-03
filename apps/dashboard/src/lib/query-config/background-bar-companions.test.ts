/**
 * Regression test for issue #2139.
 *
 * Every column rendered with `ColumnFormat.BackgroundBar` must have a matching
 * `pct_<col>` companion column in the config's SQL, otherwise the bar never
 * renders and BackgroundBarFormat silently falls back to a plain value.
 *
 * The renderer (components/data-table/cells/background-bar-format.tsx) derives
 * the companion name by stripping a leading `readable_` from the column key and
 * prefixing `pct_`:
 *
 *   columnName = 'readable_total_rows' -> colName = 'total_rows' -> 'pct_total_rows'
 *   columnName = 'compr_rate'          -> colName = 'compr_rate' -> 'pct_compr_rate'
 *
 * This test asserts that contract for the configs fixed in #2139. A broader
 * "every BackgroundBar column across all query configs has a pct_ companion"
 * invariant would be valuable but is intentionally scoped here to the audited
 * configs so it cannot fail on unrelated, unaudited configs.
 */

import type { QueryConfig } from '@/types/query-config'

import { dictionariesConfig } from './more/dictionaries'
import { parallelizationConfig } from './queries/parallelization'
import { profilerConfig } from './queries/profiler'
import { threadAnalysisConfig } from './queries/thread-analysis'
import {
  databaseTableColumnsConfig,
  tablesListConfig,
} from './system/database-table'
import { queryMetricLogConfig } from './system/query-metric-log'
import {
  clustersReplicasStatusConfig,
  replicaTablesConfig,
} from './system/replicas-status'
import { getAllSqlStrings } from './types'
import { describe, expect, test } from 'bun:test'
import { ColumnFormat } from '@/types/column-format'

// Normalize a columnFormats value (which may be `ColumnFormat` or
// `[ColumnFormat, options]`) to its ColumnFormat.
function formatOf(value: unknown): ColumnFormat | undefined {
  if (Array.isArray(value)) return value[0] as ColumnFormat
  return value as ColumnFormat
}

// The companion column name the renderer looks up for a given BackgroundBar key.
function companionFor(columnName: string): string {
  return `pct_${columnName.replace(/^readable_/, '')}`
}

function backgroundBarColumns(config: QueryConfig): string[] {
  const formats = config.columnFormats ?? {}
  return Object.entries(formats)
    .filter(([, v]) => formatOf(v) === ColumnFormat.BackgroundBar)
    .map(([key]) => key)
}

const CONFIGS: QueryConfig[] = [
  parallelizationConfig,
  threadAnalysisConfig,
  profilerConfig,
  queryMetricLogConfig,
  databaseTableColumnsConfig,
  tablesListConfig,
  clustersReplicasStatusConfig,
  replicaTablesConfig,
  dictionariesConfig,
]

describe('BackgroundBar columns have pct_ companions (#2139)', () => {
  for (const config of CONFIGS) {
    const barColumns = backgroundBarColumns(config)
    const allSql = getAllSqlStrings(config.sql).join('\n')

    test(`'${config.name}' has at least one BackgroundBar column`, () => {
      expect(barColumns.length).toBeGreaterThan(0)
    })

    for (const col of barColumns) {
      const companion = companionFor(col)
      test(`'${config.name}': ${col} has SQL companion ${companion}`, () => {
        expect(allSql).toContain(companion)
      })
    }
  }
})
