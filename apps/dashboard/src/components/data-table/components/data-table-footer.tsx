import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons'
import type { RowData, Table } from '@tanstack/react-table'

import { memo } from 'react'
import { Footnote, type FootnoteProps } from '@/components/data-table/footnote'
import { DataTablePagination } from '@/components/data-table/pagination'
import { Button } from '@/components/ui/button'
import { formatNumber } from '@/lib/format-number'

export interface DataTableFooterProps<TData extends RowData> {
  /** TanStack Table instance */
  table: Table<TData>
  /** Custom footnote content */
  footnote?: FootnoteProps['footnote']
  /** Compact mode: minimal row count + prev/next only */
  compact?: boolean
}

export const DataTableFooter = memo(function DataTableFooter<
  TData extends RowData,
>({ table, footnote, compact = false }: DataTableFooterProps<TData>) {
  if (compact) {
    const totalRows = table.getPrePaginationRowModel().rows.length
    const canPrev = table.getCanPreviousPage()
    const canNext = table.getCanNextPage()
    const hasMultiplePages = canPrev || canNext

    return (
      <div className="flex shrink-0 items-center justify-between p-1 text-xs text-muted-foreground">
        <span>{formatNumber(totalRows)} rows</span>
        {hasMultiplePages && (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => table.previousPage()}
              disabled={!canPrev}
              aria-label="Previous page"
            >
              <ChevronLeftIcon className="size-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-6"
              onClick={() => table.nextPage()}
              disabled={!canNext}
              aria-label="Next page"
            >
              <ChevronRightIcon className="size-3" />
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 px-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-0">
      <Footnote table={table} footnote={footnote} />
      <DataTablePagination table={table} />
    </div>
  )
}) as <TData extends RowData>(
  props: DataTableFooterProps<TData>
) => React.JSX.Element
