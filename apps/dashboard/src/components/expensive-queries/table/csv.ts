import type { DerivedQuery } from './types'

import { exportCsv } from '@/components/query-tables/export-csv'

const CSV_HEADERS = [
  'Rank',
  'Runs',
  'Total time (s)',
  'User CPU (s)',
  'System CPU (s)',
  'Memory (q97)',
  'Rows read',
  'Rows written',
  'Result rows',
  'Query',
] as const

export function downloadExpensiveCsv(rows: DerivedQuery[]) {
  exportCsv(
    CSV_HEADERS,
    rows,
    (d) => [
      d.rank,
      d.cnt,
      d.queriesDuration.toFixed(1),
      d.userTime.toFixed(1),
      d.systemTime.toFixed(1),
      d.readableMemory,
      d.readRows,
      d.writtenRows,
      d.resultRows,
      d.query,
    ],
    'expensive-queries'
  )
}
