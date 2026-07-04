/**
 * Compact execution list shared by the pattern detail flyout's "Recent" and
 * "Notable runs" tabs (`pattern-detail-sheet.tsx`). Rows come from
 * `query-pattern-drilldown.ts`, grouped client-side by `reason`.
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
import { formatDuration } from '@/lib/utils'

export interface PatternExecutionRow {
  reason: string
  query_id: string
  event_time: string
  query_duration: number | string
  readable_read_rows: string
  readable_result_rows: string
  readable_memory_usage: string
  exception_code: number | string
  user: string
  database: string
  client_name: string
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
                {formatDuration(Number(row.query_duration || 0) * 1000)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-xs tabular-nums">
                {row.readable_result_rows}
                <span className="text-muted-foreground">
                  {' '}
                  / {row.readable_read_rows} read
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
                      aria-label={`Exception code ${row.exception_code}`}
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
