import type { DerivedQuery } from './types'

import { exportCsv } from '@/components/query-tables/export-csv'
import { formatReadableSize } from '@/lib/format-readable'

const CSV_HEADERS = [
  'Query ID',
  'Type',
  'User',
  'Database',
  'Interface',
  'Progress %',
  'Memory',
  'Data read',
  'CPU %',
  'Threads',
  'Duration (s)',
  'Query',
] as const

export function downloadRunningCsv(rows: DerivedQuery[]) {
  exportCsv(
    CSV_HEADERS,
    rows,
    (d) => [
      d.id,
      d.kind,
      d.user,
      d.db,
      d.iface ?? '',
      d.pct ?? '',
      d.readableMemory,
      formatReadableSize(d.readBytes),
      Math.round(d.cpuPct),
      d.threads,
      d.elapsed.toFixed(1),
      d.query,
    ],
    'running-queries'
  )
}
