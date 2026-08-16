'use client'

import { Maximize2Icon } from 'lucide-react'

import type { QueryConfig } from '@/types/query-config'

import { createResultQueryConfig } from './output-shape'
import { DataTable } from '@/components/data-table/data-table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// Stable empty context object — avoids new reference on every render which
// would defeat column-def memoization inside DataTable.
const EMPTY_TABLE_CONTEXT: Record<string, string> = {}

export function ResultTable({
  rows,
  maxRows = 100,
}: {
  readonly rows: readonly unknown[]
  readonly maxRows?: number
}) {
  const displayRows = rows.slice(0, maxRows) as Record<string, unknown>[]

  const columns = (() => {
    if (displayRows.length === 0) return []
    return Object.keys(displayRows[0])
  })()

  const queryConfig = createResultQueryConfig(columns)

  if (columns.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No columns to display
      </div>
    )
  }

  const footnote =
    rows.length > maxRows ? `Showing ${maxRows} of ${rows.length} rows` : ' '

  return (
    <DataTable
      data={displayRows}
      queryConfig={queryConfig}
      context={EMPTY_TABLE_CONTEXT}
      defaultPageSize={Math.min(displayRows.length, 25)}
      showSQL={false}
      enableColumnFilters={false}
      enableColumnReordering={false}
      compact
      footnote={footnote}
      // Compact tables render no outer chrome of their own — bound the whole
      // card so it reads as one contained result, not a floating grid whose
      // scrollbar fights the page (the row count already lives in the
      // compact footer; the inner body scrolls within its own max-height).
      className="rounded-md border border-border/60"
    />
  )
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h]
          const str = val === null || val === undefined ? '' : String(val)
          return str.includes(',') || str.includes('"') || str.includes('\n')
            ? `"${str.replace(/"/g, '""')}"`
            : str
        })
        .join(',')
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function ExpandTableButton({
  rows,
  queryConfig,
}: {
  readonly rows: Record<string, unknown>[]
  readonly queryConfig: QueryConfig<string[]>
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          <button
            type="button"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
            aria-label="Expand table"
            title="Expand table"
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <Maximize2Icon className="size-3" />
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-[95vw] flex-col">
        <DialogHeader>
          <DialogTitle>Query Results ({rows.length} rows)</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          <DataTable
            data={rows}
            queryConfig={queryConfig}
            context={EMPTY_TABLE_CONTEXT}
            defaultPageSize={50}
            showSQL={false}
            enableColumnFilters={true}
            enableColumnReordering={false}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
