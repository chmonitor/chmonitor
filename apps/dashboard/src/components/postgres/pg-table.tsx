/**
 * Declarative table for a `PgQueryConfig` (issue #2450). Renders the config's
 * `PgColumn[]` with per-column formatting and optional inline share bars (the
 * Postgres analog of the ClickHouse BackgroundBar `pct_*` convention), with
 * client-side pagination for the capped result sets. Clicking a row invokes
 * `onRowClick` (used to open the detail flyout).
 */

import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table'

import type { PgColumn, PgQueryConfig } from '@/types/pg-query-config'

import { formatPgValue } from './pg-format'
import { useMemo } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { activateOnEnterOrSpace } from '@/lib/a11y'
import { cn } from '@/lib/utils'

type Row = Record<string, unknown>
const columnHelper = createColumnHelper<Row>()
const PAGE_SIZE = 50
const CODE_MAX = 160

/** A single formatted cell, with an optional share bar behind the value. */
function PgCell({ column, row }: { column: PgColumn; row: Row }) {
  const display = formatPgValue(row[column.key], column.format)
  const pct =
    column.barPctKey != null ? Number(row[column.barPctKey] ?? 0) : null

  if (column.format === 'code') {
    const str = String(row[column.key] ?? '')
    const truncated = str.length > CODE_MAX ? `${str.slice(0, CODE_MAX)}…` : str
    return (
      <span
        className="block max-w-[38rem] truncate font-mono text-xs text-foreground/90"
        title={str}
      >
        {truncated || '—'}
      </span>
    )
  }

  const alignRight = column.align === 'right'
  return (
    <div className={cn('relative', alignRight ? 'text-right' : 'text-left')}>
      {pct != null && Number.isFinite(pct) && pct > 0 ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-sm bg-primary/10"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      ) : null}
      <span
        className={cn('relative', column.format ? 'tabular-nums' : undefined)}
      >
        {display}
      </span>
    </div>
  )
}

export interface PgTableProps {
  config: PgQueryConfig
  rows: Row[]
  onRowClick?: (row: Row) => void
}

export function PgTable({ config, rows, onRowClick }: PgTableProps) {
  const columns = useMemo(
    () =>
      config.columns.map((col) =>
        columnHelper.accessor((r) => r[col.key], {
          id: col.key,
          header: col.label,
          cell: (info) => <PgCell column={col} row={info.row.original} />,
        })
      ),
    [config.columns]
  )

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: PAGE_SIZE } },
  })

  const pageCount = table.getPageCount()
  const pageIndex = table.getState().pagination.pageIndex
  const clickable = Boolean(onRowClick && config.rowClickable)

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <Table style={{ width: '100%' }}>
          <TableHeader className="sticky top-0 z-10 bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const col = config.columns.find((c) => c.key === header.id)
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        'select-none whitespace-nowrap text-xs font-medium',
                        col?.align === 'right' && 'text-right'
                      )}
                      title={col?.help}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  'align-top',
                  clickable && 'cursor-pointer hover:bg-muted/50'
                )}
                {...(clickable
                  ? {
                      role: 'button',
                      tabIndex: 0,
                      onClick: () => onRowClick?.(row.original),
                      onKeyDown: activateOnEnterOrSpace(() =>
                        onRowClick?.(row.original)
                      ),
                    }
                  : {})}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="py-2 text-[13px]">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
          <span>
            Page {pageIndex + 1} of {pageCount} · {rows.length} rows
          </span>
          <button
            type="button"
            className="rounded border px-2 py-1 hover:bg-muted disabled:opacity-40"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded border px-2 py-1 hover:bg-muted disabled:opacity-40"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
