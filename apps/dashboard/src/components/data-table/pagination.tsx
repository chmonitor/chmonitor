import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleArrowLeftIcon,
  DoubleArrowRightIcon,
} from '@radix-ui/react-icons'
import type { RowData, Table } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatNumber } from '@/lib/format-number'
import { cn } from '@/lib/utils'

interface DataTablePaginationProps<TData extends RowData = RowData> {
  table: Table<TData>
}

const pageSizeOptions = [10, 25, 50, 100, 200, 500, 1000]

/**
 * Memoized pagination info displaying row range (desktop) or page number (mobile).
 * Uses cached Intl.NumberFormat from @/lib/format-number.
 */
function PaginationInfo<TData extends RowData = RowData>({
  table,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.getState().pagination
  const totalRows = table.getPrePaginationRowModel().rows.length
  const pageCount = table.getPageCount()

  const info = (() => {
    const from = pageIndex * pageSize + 1
    const to = Math.min((pageIndex + 1) * pageSize, totalRows)
    return {
      range: `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(totalRows)} rows`,
      page: `${pageIndex + 1}/${pageCount}`,
    }
  })()

  return (
    <div className="flex w-[100px] items-center justify-center text-sm font-medium">
      <span className="hidden sm:inline">{info.range}</span>
      <span className="sm:hidden">{info.page}</span>
    </div>
  )
}

export function DataTablePagination<TData extends RowData = RowData>({
  table,
}: DataTablePaginationProps<TData>) {
  // Memoized pagination handlers to prevent recreation on every render
  const handleFirstPage = () => {
    table.setPageIndex(0)
  }

  const handlePreviousPage = () => {
    table.previousPage()
  }

  const handleNextPage = () => {
    table.nextPage()
  }

  const handleLastPage = () => {
    table.setPageIndex(table.getPageCount() - 1)
  }

  const handlePageSizeChange = (value: string) => {
    table.setPageSize(Number(value))
  }

  if (table.getRowModel().rows.length === 0) return null

  return (
    <div
      aria-label="Pagination"
      className={cn(
        'w-full flex-col items-center gap-3 sm:w-auto sm:flex-row sm:gap-6 lg:gap-8',
        table.getCanPreviousPage() || table.getCanNextPage() ? 'flex' : 'hidden'
      )}
    >
      <div className="flex items-center gap-2">
        <p className="hidden sm:block text-sm font-medium">Rows per page</p>
        <Select
          value={`${table.getState().pagination.pageSize}`}
          onValueChange={handlePageSizeChange}
        >
          <SelectTrigger
            aria-label="Rows per page"
            className="h-10 sm:h-8 w-16 sm:w-[70px]"
          >
            <SelectValue placeholder={table.getState().pagination.pageSize} />
          </SelectTrigger>
          <SelectContent side="top">
            {pageSizeOptions.map((pageSize) => (
              <SelectItem key={pageSize} value={`${pageSize}`}>
                {pageSize}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <PaginationInfo table={table} />
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="hidden size-10 sm:size-8 p-0 lg:flex"
          onClick={handleFirstPage}
          disabled={!table.getCanPreviousPage()}
          aria-label="Go to first page"
        >
          <span className="sr-only">Go to first page</span>
          <DoubleArrowLeftIcon className="size-4" />
        </Button>
        <Button
          variant="outline"
          className="size-10 sm:size-8 p-0"
          onClick={handlePreviousPage}
          disabled={!table.getCanPreviousPage()}
          aria-label="Go to previous page"
        >
          <span className="sr-only">Go to previous page</span>
          <ChevronLeftIcon className="size-4" />
        </Button>
        <Button
          variant="outline"
          className="size-10 sm:size-8 p-0"
          onClick={handleNextPage}
          disabled={!table.getCanNextPage()}
          aria-label="Go to next page"
        >
          <span className="sr-only">Go to next page</span>
          <ChevronRightIcon className="size-4" />
        </Button>
        <Button
          variant="outline"
          className="hidden size-10 sm:size-8 p-0 lg:flex"
          onClick={handleLastPage}
          disabled={!table.getCanNextPage()}
          aria-label="Go to last page"
        >
          <span className="sr-only">Go to last page</span>
          <DoubleArrowRightIcon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
