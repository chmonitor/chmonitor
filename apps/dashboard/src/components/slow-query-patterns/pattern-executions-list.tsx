/**
 * Compact execution list shared by the pattern detail flyout's "Recent" and
 * "Notable runs" tabs (`pattern-detail-sheet.tsx`). Rows come from
 * `GET /api/v1/insights/query-patterns/:hash` (#2266,
 * `lib/api/insights/query-patterns.ts`'s `buildPatternExecutionsConfig`) —
 * reused as-is rather than duplicating a second "executions for one pattern"
 * query.
 *
 * Deliberately a plain shadcn `Table`, not the full `DataTable` machinery —
 * this list lives inside a `Sheet` alongside stat cards and tabs; the
 * pagination/column-visibility/filter-bar chrome `DataTable` brings would be
 * noise here, not a feature.
 */
import { AlertTriangleIcon, ExternalLinkIcon } from 'lucide-react'

import { RelatedTimeFormat } from '@/components/data-table/cells/related-time-format'
import { AppLink as Link } from '@/components/ui/app-link'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatReadableQuantity } from '@/lib/format-readable'
import { formatDuration } from '@/lib/utils'

/** Shape of one row in `/api/v1/insights/query-patterns/:hash`'s
 * `data.executions[]` — see `buildPatternExecutionsConfig` in
 * `lib/api/insights/query-patterns.ts`. */
export interface PatternExecutionRow {
  query_id: string
  event_time: string
  user: string
  query_kind: string
  database: string
  query_duration_ms: number | string
  memory_usage: number | string
  readable_memory_usage: string
  read_rows: number | string
  read_bytes: number | string
  readable_read_bytes: string
  result_rows: number | string
  written_bytes: number | string
  exception_code: number | string
  exception: string
  query: string
}

export function PatternExecutionsList({
  rows,
  hostId,
  emptyMessage,
}: {
  rows: PatternExecutionRow[]
  hostId: number
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return <EmptyState variant="no-data" description={emptyMessage} compact />
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Rows</TableHead>
          <TableHead>Memory</TableHead>
          <TableHead>User</TableHead>
          <TableHead>Database</TableHead>
          <TableHead className="w-8" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const hasError = Number(row.exception_code || 0) !== 0
          return (
            <TableRow
              key={row.query_id}
              className={hasError ? 'bg-red-50 dark:bg-red-950/20' : undefined}
            >
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                <RelatedTimeFormat value={row.event_time} />
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums">
                {formatDuration(Number(row.query_duration_ms || 0))}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs tabular-nums">
                {formatReadableQuantity(Number(row.result_rows || 0))}
                <span className="text-muted-foreground">
                  {' '}
                  / {formatReadableQuantity(Number(row.read_rows || 0))} read
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs tabular-nums">
                {row.readable_memory_usage}
              </TableCell>
              <TableCell className="max-w-24 truncate text-xs" title={row.user}>
                <Badge variant="secondary" className="font-normal">
                  {row.user}
                </Badge>
              </TableCell>
              <TableCell
                className="max-w-24 truncate text-xs text-muted-foreground"
                title={row.database}
              >
                {row.database}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {hasError && (
                    <AlertTriangleIcon
                      className="size-3.5 shrink-0 text-destructive"
                      aria-label={`Exception code ${row.exception_code}: ${row.exception}`}
                    />
                  )}
                  <Link
                    href={`/query?query_id=${encodeURIComponent(row.query_id)}&host=${hostId}`}
                    className="text-muted-foreground hover:text-foreground"
                    title="Open query detail"
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
