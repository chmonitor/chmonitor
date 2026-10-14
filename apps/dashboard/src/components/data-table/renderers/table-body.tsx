import { SearchX } from 'lucide-react'
import {
  type Cell,
  type ColumnDef,
  type ColumnMeta,
  flexRender,
  type Row,
  type RowData,
  type Table,
} from '@tanstack/react-table'

import type { ExpandableConfig, RowClassNameFn } from '@/types/query-config'

import { Fragment, memo, type ReactNode } from 'react'
import { useTableDensityContext } from '@/components/data-table/context/table-density-context'
import { ExpandedRow } from '@/components/data-table/row-expand/expanded-row'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { TableCell, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

/**
 * Heuristic: don't trigger a row's click behavior (expand, or `onRowClick`)
 * when the user clicks an interactive element inside a row (button, link,
 * input, etc.) or any subtree marked with `data-no-expand`.
 */
function isRowClickTarget(target: EventTarget | null): boolean {
  // Use Element so SVG descendants (icons) inside cells still toggle the row.
  if (!(target instanceof Element)) return false
  return !target.closest(
    'button, a, input, label, select, textarea, summary, [contenteditable], [role="button"], [role="link"], [role="menuitem"], [role="combobox"], [role="checkbox"], [data-no-expand]'
  )
}

const VIRTUALIZED_CELL_CLASS = 'text-sm whitespace-nowrap tabular-nums'
const STANDARD_CELL_CLASS = 'text-sm align-middle break-words tabular-nums'
const DEFAULT_COLUMN_SIZE = 110

function getCellWidth<TData extends RowData>(cell: Cell<TData, unknown>) {
  return (
    cell.column.getSize?.() ?? cell.column.columnDef.size ?? DEFAULT_COLUMN_SIZE
  )
}

export interface VirtualItem {
  end: number
  index: number
  size: number
  start: number
}

export interface VirtualizedTableRowProps<TData extends RowData> {
  row: Row<TData>
  virtualRow: VirtualItem
  rowClassName?: RowClassNameFn
  /** When set, row clicks (outside interactive elements) toggle expansion. */
  expandable?: true | ExpandableConfig
  /**
   * When set (and `expandable` is not), row clicks (outside interactive
   * elements) call this with the row's data instead of toggling expansion.
   */
  onRowClick?: (row: TData) => void
}

export const VirtualizedTableRow = memo(function VirtualizedTableRow<
  TData extends RowData,
>({
  row,
  virtualRow,
  rowClassName,
  expandable,
  onRowClick,
}: VirtualizedTableRowProps<TData>) {
  const { cellClassName } = useTableDensityContext()
  const customClass = rowClassName?.(row.original as Record<string, unknown>)
  const canExpand = Boolean(expandable) && row.getCanExpand()
  const isExpanded = canExpand && row.getIsExpanded()
  const isClickable = canExpand || Boolean(onRowClick)
  return (
    <TableRow
      key={row.id}
      data-state={row.getIsSelected() ? 'selected' : undefined}
      data-index={virtualRow.index}
      data-expanded={isExpanded || undefined}
      onClick={
        canExpand
          ? (e) => {
              if (isRowClickTarget(e.target)) row.toggleExpanded()
            }
          : onRowClick
            ? (e) => {
                if (isRowClickTarget(e.target)) onRowClick(row.original)
              }
            : undefined
      }
      className={cn(
        'border-b border-border/50 transition-colors hover:bg-accent/50',
        virtualRow.index % 2 === 1 && 'odd:bg-muted/30',
        row.getIsSelected() && 'border-l-2 border-l-primary',
        isClickable && 'cursor-pointer',
        isExpanded && 'bg-accent/30 hover:bg-accent/30',
        customClass
      )}
      style={{
        height: `${virtualRow.size}px`,
      }}
    >
      {row.getVisibleCells().map((cell: Cell<TData, unknown>) => {
        return (
          <TableCell
            key={cell.id}
            className={cn(VIRTUALIZED_CELL_CLASS, cellClassName)}
            style={{
              width: getCellWidth(cell),
              minWidth: cell.column.columnDef.minSize ?? 50,
              maxWidth: cell.column.columnDef.maxSize ?? undefined,
            }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        )
      })}
    </TableRow>
  )
}) as <TData extends RowData>(
  props: VirtualizedTableRowProps<TData>
) => React.JSX.Element

export interface StandardTableRowProps<TData extends RowData> {
  row: Row<TData>
  index: number
  rowClassName?: RowClassNameFn
  /** When set, row clicks (outside interactive elements) toggle expansion. */
  expandable?: true | ExpandableConfig
  /**
   * When set (and `expandable` is not), row clicks (outside interactive
   * elements) call this with the row's data instead of toggling expansion.
   */
  onRowClick?: (row: TData) => void
}

export const StandardTableRow = memo(function StandardTableRow<
  TData extends RowData,
>({
  row,
  index,
  rowClassName,
  expandable,
  onRowClick,
}: StandardTableRowProps<TData>) {
  const { cellClassName } = useTableDensityContext()
  const customClass = rowClassName?.(row.original as Record<string, unknown>)
  const canExpand = Boolean(expandable) && row.getCanExpand()
  const isExpanded = canExpand && row.getIsExpanded()
  const isClickable = canExpand || Boolean(onRowClick)
  return (
    <TableRow
      key={row.id}
      data-state={row.getIsSelected() ? 'selected' : undefined}
      data-expanded={isExpanded || undefined}
      onClick={
        canExpand
          ? (e) => {
              if (isRowClickTarget(e.target)) row.toggleExpanded()
            }
          : onRowClick
            ? (e) => {
                if (isRowClickTarget(e.target)) onRowClick(row.original)
              }
            : undefined
      }
      className={cn(
        'border-b border-border/50 transition-colors hover:bg-accent/50',
        index % 2 === 1 && 'odd:bg-muted/30',
        row.getIsSelected() && 'border-l-2 border-l-primary',
        isClickable && 'cursor-pointer',
        isExpanded && 'bg-accent/30 hover:bg-accent/30',
        customClass
      )}
    >
      {row.getVisibleCells().map((cell: Cell<TData, unknown>) => {
        return (
          <TableCell
            key={cell.id}
            className={cn(STANDARD_CELL_CLASS, cellClassName)}
            style={{
              width: getCellWidth(cell),
              minWidth: cell.column.columnDef.minSize ?? 50,
              maxWidth: cell.column.columnDef.maxSize ?? undefined,
            }}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </TableCell>
        )
      })}
    </TableRow>
  )
}) as <TData extends RowData>(
  props: StandardTableRowProps<TData>
) => React.JSX.Element

export interface Virtualizer {
  getVirtualItems(): VirtualItem[]
  getTotalSize(): number
}

export interface TableBodyRowsProps<TData extends RowData> {
  table: Table<TData>
  isVirtualized: boolean
  virtualizer: Virtualizer | null
  rowClassName?: RowClassNameFn
  expandable?: true | ExpandableConfig
  /** See {@link StandardTableRowProps.onRowClick}. */
  onRowClick?: (row: TData) => void
  /**
   * Signature of the table state that affects row output (sorting, pagination,
   * expansion, sizing, order, visibility, selection). The `table` instance has
   * a stable identity, so memo would otherwise never re-render when that state
   * changes; this prop changes whenever the rendered rows must update.
   */
  renderKey?: string
}

export const TableBodyRows = memo(function TableBodyRows<
  TData extends RowData,
>({
  table,
  isVirtualized,
  virtualizer,
  rowClassName,
  expandable,
  onRowClick,
}: TableBodyRowsProps<TData>) {
  const rows = table.getRowModel().rows
  const colSpan = Math.max(table.getVisibleLeafColumns().length, 1)

  if (isVirtualized && virtualizer) {
    const virtualRows = virtualizer.getVirtualItems()
    const firstVirtualRow = virtualRows[0]
    const lastVirtualRow = virtualRows.at(-1)
    const paddingTop = firstVirtualRow?.start ?? 0
    const paddingBottom = lastVirtualRow
      ? Math.max(virtualizer.getTotalSize() - lastVirtualRow.end, 0)
      : 0

    return (
      <>
        {paddingTop > 0 && (
          <TableRow
            aria-hidden="true"
            data-virtual-spacer="top"
            className="border-0 hover:bg-transparent"
          >
            <TableCell
              colSpan={colSpan}
              className="border-0 p-0"
              style={{ height: `${paddingTop}px` }}
            />
          </TableRow>
        )}
        {virtualRows.map((virtualRow: VirtualItem) => {
          const row = rows[virtualRow.index]
          if (!row) return null

          return (
            <Fragment key={row.id}>
              <VirtualizedTableRow<TData>
                row={row}
                virtualRow={virtualRow}
                rowClassName={rowClassName}
                expandable={expandable}
                onRowClick={onRowClick}
              />
              {expandable && row.getIsExpanded() && (
                <ExpandedRow<TData>
                  row={row}
                  colSpan={colSpan}
                  config={expandable}
                />
              )}
            </Fragment>
          )
        })}
        {paddingBottom > 0 && (
          <TableRow
            aria-hidden="true"
            data-virtual-spacer="bottom"
            className="border-0 hover:bg-transparent"
          >
            <TableCell
              colSpan={colSpan}
              className="border-0 p-0"
              style={{ height: `${paddingBottom}px` }}
            />
          </TableRow>
        )}
      </>
    )
  }

  return (
    <>
      {rows.map((row: Row<TData>, index: number) => (
        <Fragment key={row.id}>
          <StandardTableRow<TData>
            row={row}
            index={index}
            rowClassName={rowClassName}
            expandable={expandable}
            onRowClick={onRowClick}
          />
          {expandable && row.getIsExpanded() && (
            <ExpandedRow<TData>
              row={row}
              colSpan={colSpan}
              config={expandable}
            />
          )}
        </Fragment>
      ))}
    </>
  )
}) as <TData extends RowData>(
  props: TableBodyRowsProps<TData>
) => React.JSX.Element

export type ColumnMetaType = ColumnMeta<unknown, unknown>

export interface TableBodyEmptyStateProps<
  TData extends RowData,
  TValue extends ReactNode,
> {
  columnDefs: ColumnDef<TData, TValue>[]
  title: string
  activeFilterCount: number
}

export const TableBodyEmptyState = memo(function TableBodyEmptyState<
  TData extends RowData,
  TValue extends ReactNode,
>({
  columnDefs,
  title,
  activeFilterCount,
}: TableBodyEmptyStateProps<TData, TValue>) {
  return (
    <TableRow>
      <TableCell colSpan={columnDefs.length} className="h-64 p-4">
        <Empty className="h-full min-h-48 border-0 p-4 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX className="size-5" />
            </EmptyMedia>
            <EmptyTitle>No results</EmptyTitle>
            <EmptyDescription>
              {activeFilterCount > 0
                ? `No ${title?.toLowerCase() || 'data'} match your filters. Try clearing filters or adjusting your search.`
                : `No ${title?.toLowerCase() || 'data'} found. Try adjusting your query or check back later.`}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </TableCell>
    </TableRow>
  )
}) as <TData extends RowData, TValue extends ReactNode>(
  props: TableBodyEmptyStateProps<TData, TValue>
) => React.JSX.Element

export interface TableBodyProps<
  TData extends RowData,
  TValue extends ReactNode,
> {
  table: Table<TData>
  columnDefs: ColumnDef<TData, TValue>[]
  isVirtualized: boolean
  virtualizer: Virtualizer | null
  title: string
  activeFilterCount: number
  rowClassName?: RowClassNameFn
  expandable?: true | ExpandableConfig
  /** See {@link StandardTableRowProps.onRowClick}. */
  onRowClick?: (row: TData) => void
  /** See {@link TableBodyRowsProps.renderKey}. Forwarded to the row renderer. */
  renderKey?: string
}

export const TableBody = memo(function TableBody<
  TData extends RowData,
  TValue extends ReactNode,
>({
  table,
  columnDefs,
  isVirtualized,
  virtualizer,
  title,
  activeFilterCount,
  rowClassName,
  expandable,
  onRowClick,
  renderKey,
}: TableBodyProps<TData, TValue>) {
  const rows = table.getRowModel().rows

  return (
    <>
      {rows?.length ? (
        <TableBodyRows
          table={table}
          isVirtualized={isVirtualized}
          virtualizer={virtualizer}
          rowClassName={rowClassName}
          expandable={expandable}
          onRowClick={onRowClick}
          renderKey={renderKey}
        />
      ) : (
        <TableBodyEmptyState
          columnDefs={columnDefs}
          title={title}
          activeFilterCount={activeFilterCount}
        />
      )}
    </>
  )
}) as <TData extends RowData, TValue extends ReactNode>(
  props: TableBodyProps<TData, TValue>
) => React.JSX.Element
