/**
 * Regression test for issue #2139 (widened repo-wide for #2497).
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
 * Originally scoped to 9 hand-audited configs (#2139); widened here to iterate
 * every config in the central registry (`lib/query-config/index.ts`) so a new
 * BackgroundBar column missing its companion is caught at PR time instead of
 * silently rendering a plain number in production (#2497).
 */

import type { QueryConfig } from '@/types/query-config'

import { queries } from './index'
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

const configsWithBarColumns = queries.filter(
  (config) => backgroundBarColumns(config).length > 0
)

describe('BackgroundBar columns have pct_ companions (#2139, #2497)', () => {
  test('corpus is non-empty (guards against an empty/mis-imported registry)', () => {
    expect(configsWithBarColumns.length).toBeGreaterThan(0)
  })

  for (const config of configsWithBarColumns) {
    const allSql = getAllSqlStrings(config.sql).join('\n')

    for (const col of backgroundBarColumns(config)) {
      const companion = companionFor(col)
      test(`'${config.name}': ${col} has SQL companion ${companion}`, () => {
        expect(allSql).toContain(companion)
      })
    }
  }
})
