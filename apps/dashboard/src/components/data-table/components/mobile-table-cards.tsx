import {
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  RotateCcw,
  SearchX,
  SortAsc,
  SortDesc,
} from 'lucide-react'
import {
  type Cell,
  type Column,
  flexRender,
  type Row,
  type RowData,
  type Table,
} from '@tanstack/react-table'
import type { VirtualItem } from '@tanstack/react-virtual'

import type { Icon } from '@chm/types/icon'
import type { UseVirtualRowsResult } from '@/components/data-table/hooks/use-virtual-rows'
import type {
  CardConfig,
  ExpandableConfig,
  ExpandedRenderer,
  RowClassNameFn,
} from '@/types/query-config'

import { Fragment } from 'react'
import {
  EXPAND_COLUMN_ID,
  normalizeColumnName,
} from '@/components/data-table/column-defs'
import { useTableDensityContext } from '@/components/data-table/context/table-density-context'
import { DefaultExpandedRow } from '@/components/data-table/row-expand/default-renderer'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { cn } from '@/lib/utils'

const UTILITY_COLUMNS = new Set(['select', 'action', EXPAND_COLUMN_ID])
const PRIMARY_COLUMN_PRIORITY = [
  'query',
  'query_detail',
  'query_id',
  'database',
  'table',
  'name',
]
// Primary columns that carry SQL — rendered as a highlighted monospace block
// (the "hero") at the top of the card so it reads first.
const SQL_PRIMARY_COLUMNS = new Set(['query', 'query_detail'])

// Heroes whose content is long-form (SQL, stack traces, exception / error
// messages, mutation commands) read far better as one wide, readable column
// than squeezed into a grid cell — so the multi-column card grid keeps these
// single-column and only grids short, scannable entity heroes.

function formatColumnLabel(columnId: string) {
  return columnId.replaceAll('_', ' ')
}

function getColumnLabel<TData extends RowData>(column: Column<TData, unknown>) {
  return typeof column.columnDef.header === 'string'
    ? column.columnDef.header
    : formatColumnLabel(column.id)
}

/**
 * Resolve a config-declared column name (e.g. `readable_memory_usage`) to the
 * matching table cell. Column ids and config names can differ by case and the
 * `readable_` prefix, so we try an exact id match first, then a normalized
 * match — this keeps `card` configs robust regardless of which form the column
 * def settled on.
 */
function matchCell<TData extends RowData>(
  cells: Cell<TData, unknown>[],
  name: string
): Cell<TData, unknown> | undefined {
  const normalized = normalizeColumnName(name)
  return (
    cells.find((cell) => cell.column.id === name) ??
    cells.find((cell) => cell.column.id === normalized) ??
    cells.find((cell) => normalizeColumnName(cell.column.id) === normalized)
  )
}

function pickPrimaryCell<TData extends RowData>(cells: Cell<TData, unknown>[]) {
  return (
    PRIMARY_COLUMN_PRIORITY.map((columnId) =>
      cells.find((cell) => cell.column.id === columnId)
    ).find(Boolean) ??
    cells.find((cell) => !UTILITY_COLUMNS.has(cell.column.id)) ??
    cells[0]
  )
}

export function MobileSortMenu<TData extends RowData>({
  table,
}: {
  table: Table<TData>
}) {
  const sortableColumns = table
    .getVisibleLeafColumns()
    .filter((column) => column.getCanSort() && !UTILITY_COLUMNS.has(column.id))

  if (!sortableColumns.length) {
    return null
  }

  const activeSort = table.getState().sorting[0]
  const activeColumn = activeSort ? table.getColumn(activeSort.id) : null
  const activeLabel = activeColumn
    ? `${getColumnLabel(activeColumn)} ${activeSort.desc ? 'desc' : 'asc'}`
    : 'Sort'

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-full gap-2 text-xs"
            data-testid="mobile-table-sort"
          />
        }
      >
        <ArrowUpDown className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">{activeLabel}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="max-h-80 w-56 overflow-y-auto"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        </DropdownMenuGroup>
        {sortableColumns.map((column) => {
          const label = getColumnLabel(column)
          const isAsc =
            activeSort?.id === column.id && activeSort.desc === false
          const isDesc =
            activeSort?.id === column.id && activeSort.desc === true

          return (
            <Fragment key={column.id}>
              <DropdownMenuItem onClick={() => column.toggleSorting(false)}>
                <SortAsc className="mr-2 size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {label} ascending
                </span>
                {isAsc && <Check className="ml-2 size-3.5" />}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => column.toggleSorting(true)}>
                <SortDesc className="mr-2 size-3.5" />
                <span className="min-w-0 flex-1 truncate">
                  {label} descending
                </span>
                {isDesc && <Check className="ml-2 size-3.5" />}
              </DropdownMenuItem>
            </Fragment>
          )
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => table.resetSorting()}>
          <RotateCcw className="mr-2 size-3.5" />
          Reset sort
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface MobileTableCardProps<TData extends RowData> {
  row: Row<TData>
  rowClassName?: RowClassNameFn
  expandable?: true | ExpandableConfig
  /** Declarative card layout (hero / badges / metrics / hidden). */
  card?: CardConfig
  /** Leading icons for metric chips, keyed by column name. */
  columnIcons?: Record<string, Icon>
  /** In a multi-column card grid, an expanded card spans the full row. */
  gridLayout?: boolean
}

const MobileTableCard = function MobileTableCard<TData extends RowData>({
  row,
  rowClassName,
  expandable,
  card,
  columnIcons,
  gridLayout,
}: MobileTableCardProps<TData>) {
  const cells = row.getVisibleCells()
  const selectCell = cells.find((cell) => cell.column.id === 'select')
  const actionCell = cells.find((cell) => cell.column.id === 'action')

  // Hero column: declared `card.primary` wins, else the historical heuristic.
  const primaryCell = card?.primary
    ? matchCell(cells, card.primary)
    : pickPrimaryCell(cells)

  // Header badges: declared `card.badges`, else fall back to the single
  // `query_kind` badge the renderer has always surfaced.
  const badgeCells = (
    card?.badges
      ? card.badges.map((name) => matchCell(cells, name))
      : [cells.find((cell) => cell.column.id === 'query_kind')]
  )
    .filter((cell): cell is Cell<TData, unknown> => Boolean(cell))
    // A column lives in exactly one zone — the hero never repeats as a badge.
    .filter((cell) => cell.id !== primaryCell?.id)

  // Cells already shown as the hero or a header badge must not also appear in
  // the metric chip row.
  const placedIds = new Set(
    [primaryCell?.id, ...badgeCells.map((cell) => cell.id)].filter(
      (id): id is string => Boolean(id)
    )
  )

  // Metric chips: a compact icon+value row of the most glanceable live metrics.
  // Only populated when the config opts in via `card.metrics`.
  const metricEntries = (card?.metrics ?? [])
    .map((name) => ({ name, cell: matchCell(cells, name) }))
    .filter(
      (entry): entry is { name: string; cell: Cell<TData, unknown> } =>
        entry.cell != null && !placedIds.has(entry.cell.id)
    )

  const hiddenIds = new Set(
    (card?.hidden ?? [])
      .map((name) => matchCell(cells, name)?.id)
      .filter((id): id is string => Boolean(id))
  )

  // Cells already placed elsewhere (hero, header badges, metric row) must not
  // repeat as label/value detail rows.
  const usedIds = new Set(
    [
      primaryCell?.id,
      ...badgeCells.map((cell) => cell.id),
      ...metricEntries.map((entry) => entry.cell.id),
    ].filter((id): id is string => Boolean(id))
  )

  const detailCells = cells.filter(
    (cell) =>
      !usedIds.has(cell.id) &&
      !hiddenIds.has(cell.id) &&
      !UTILITY_COLUMNS.has(cell.column.id)
  )

  const isSqlPrimary =
    !!primaryCell && SQL_PRIMARY_COLUMNS.has(primaryCell.column.id)
  const customClass = rowClassName?.(row.original as Record<string, unknown>)
  const isExpandable = !!expandable && row.getCanExpand()
  const isExpanded = isExpandable && row.getIsExpanded()
  const ExpandIcon = isExpanded ? ChevronDown : ChevronRight
  const hasHeader =
    isExpandable || !!selectCell || badgeCells.length > 0 || !!actionCell

  // Density-aware spacing for cards
  const { density } = useTableDensityContext()
  const densitySpacing = {
    comfortable: {
      outer: 'p-3',
      headerMb: 'mb-2.5',
      sectionMt: 'mt-2.5',
      detailPy: 'py-2',
    },
    compact: {
      outer: 'p-2.5',
      headerMb: 'mb-2',
      sectionMt: 'mt-2',
      detailPy: 'py-1.5',
    },
    dense: {
      outer: 'p-2',
      headerMb: 'mb-1.5',
      sectionMt: 'mt-1.5',
      detailPy: 'py-1',
    },
  }[density]

  return (
    <article
      data-testid="mobile-table-card"
      data-expanded={isExpanded || undefined}
      className={cn(
        `rounded-lg border border-border/60 bg-card/40 ${densitySpacing.outer}`,
        // An expanded card needs the full row so its detail panel has room.
        isExpanded && gridLayout && 'col-span-full',
        customClass
      )}
    >
      {hasHeader && (
        <div
          className={`${densitySpacing.headerMb} flex min-w-0 items-start gap-2`}
        >
          {isExpandable && (
            <button
              type="button"
              onClick={() => row.toggleExpanded()}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse row' : 'Expand row'}
              className="-ml-1 relative inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-transform duration-100 before:absolute before:-inset-2 before:content-[''] hover:bg-muted/60 hover:text-foreground active:scale-[0.96]"
              data-testid="mobile-table-card-expand"
            >
              <ExpandIcon className="size-4" />
            </button>
          )}

          {selectCell && (
            <div className="-ml-1 shrink-0">
              {flexRender(
                selectCell.column.columnDef.cell,
                selectCell.getContext()
              )}
            </div>
          )}

          {badgeCells.length > 0 && (
            // Wrap badges in their own min-w-0 flex group so multiple badges
            // (or one long one like `ExceptionWhileProcessing`) wrap onto a new
            // line instead of collapsing and overflowing onto each other.
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {badgeCells.map((cell) => (
                <div key={cell.id} className="max-w-full [&_*]:max-w-full">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          )}

          {actionCell && (
            <div className="-mr-1 ml-auto shrink-0">
              {flexRender(
                actionCell.column.columnDef.cell,
                actionCell.getContext()
              )}
            </div>
          )}
        </div>
      )}

      {primaryCell && (
        <div
          data-testid="mobile-table-card-primary"
          className={cn(
            'min-w-0 rounded-md border border-border/50 p-2.5',
            isSqlPrimary ? 'bg-muted/60' : 'bg-muted/30'
          )}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-wider text-muted-foreground">
            {isSqlPrimary && <Code2 className="size-3 shrink-0" />}
            {formatColumnLabel(primaryCell.column.id)}
          </div>
          <div
            className={cn(
              'min-w-0 text-foreground',
              isSqlPrimary
                ? 'font-mono text-[0.8rem] leading-relaxed [&_button]:!h-auto [&_button]:!max-w-full [&_button]:items-start [&_code]:line-clamp-4 [&_code]:!whitespace-pre-wrap [&_code]:!break-words [&_code]:!text-foreground'
                : 'text-sm font-medium [&_*]:max-w-full [&_button]:justify-start [&_code]:whitespace-normal'
            )}
          >
            {flexRender(
              primaryCell.column.columnDef.cell,
              primaryCell.getContext()
            )}
          </div>
        </div>
      )}

      {metricEntries.length > 0 && (
        <div
          data-testid="mobile-table-card-metrics"
          className={`${densitySpacing.sectionMt} flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground`}
        >
          {metricEntries.map(({ name, cell }) => {
            const MetricIcon = columnIcons?.[name]
            return (
              <span
                key={cell.id}
                className="inline-flex min-w-0 items-center gap-1 tabular-nums"
                title={formatColumnLabel(cell.column.id)}
              >
                {MetricIcon && (
                  <MetricIcon className="size-3 shrink-0 opacity-70" />
                )}
                <span className="min-w-0 truncate [&_*]:max-w-full [&_code]:whitespace-normal">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </span>
              </span>
            )
          })}
        </div>
      )}

      {detailCells.length > 0 && (
        <dl className={`${densitySpacing.sectionMt} divide-y divide-border/50`}>
          {detailCells.map((cell) => (
            <div
              key={cell.id}
              className={`grid min-w-0 grid-cols-[7rem_minmax(0,1fr)] gap-2 ${densitySpacing.detailPy} first:pt-0 last:pb-0`}
            >
              <dt className="min-w-0 truncate text-xs text-muted-foreground">
                {formatColumnLabel(cell.column.id)}
              </dt>
              <dd className="min-w-0 text-right text-sm tabular-nums text-foreground [&_*]:max-w-full [&_code]:whitespace-normal">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {isExpanded && (
        <div className="mt-3 border-t border-border/50 pt-3 animate-in fade-in slide-in-from-top-1 duration-150">
          {expandable === true ? (
            <DefaultExpandedRow row={row.original as Record<string, unknown>} />
          ) : (
            (expandable.renderExpanded as ExpandedRenderer)(
              row.original as Record<string, unknown>,
              { row: row as unknown as Row<Record<string, unknown>> }
            )
          )}
        </div>
      )}
    </article>
  )
} as <TData extends RowData>(
  props: MobileTableCardProps<TData>
) => React.JSX.Element

export interface MobileTableCardsProps<TData extends RowData> {
  table: Table<TData>
  title: string
  activeFilterCount: number
  rowClassName?: RowClassNameFn
  isVirtualized?: boolean
  virtualizer?: UseVirtualRowsResult['virtualizer']
  expandable?: true | ExpandableConfig
  /** Declarative card layout (hero / badges / metrics / hidden). */
  card?: CardConfig
  /** Leading icons for metric chips, keyed by column name. */
  columnIcons?: Record<string, Icon>
  /** Active result view; an explicit 'cards' view enables the card grid. */
  view?: 'table' | 'cards' | 'auto'
}

export const MobileTableCards = function MobileTableCards<
  TData extends RowData,
>({
  table,
  title,
  activeFilterCount,
  rowClassName,
  isVirtualized = false,
  virtualizer,
  expandable,
  card,
  columnIcons,
  view,
}: MobileTableCardsProps<TData>) {
  const rows = table.getRowModel().rows

  // Multi-column card grid — active in both explicit 'cards' view and 'auto'
  // mode. The virtualized path always stacks (separate code branch).
  // Phones stack to a single column so each card is wide enough for its badges
  // and label/value rows; tablets get 2 cols at sm and desktop 3 at xl.
  const gridLayout = view === 'cards' || view === 'auto'

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-border/50 bg-card/30 p-4">
        <Empty className="min-h-48 border-0 p-4">
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
      </div>
    )
  }

  const virtualRows =
    isVirtualized && virtualizer ? virtualizer.getVirtualItems() : null

  return (
    <div aria-label={`${title || 'Data'} cards`}>
      {virtualRows ? (
        <div
          className="relative"
          style={{ height: `${virtualizer?.getTotalSize() ?? 0}px` }}
        >
          {virtualRows.map((virtualRow: VirtualItem) => {
            const row = rows[virtualRow.index]
            if (!row) return null

            return (
              <div
                key={row.id}
                data-index={virtualRow.index}
                ref={(node) => {
                  if (node) virtualizer?.measureElement(node)
                }}
                className="absolute left-0 top-0 w-full pb-3"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <MobileTableCard
                  row={row}
                  rowClassName={rowClassName}
                  expandable={expandable}
                  card={card}
                  columnIcons={columnIcons}
                />
              </div>
            )
          })}
        </div>
      ) : (
        <div
          className={
            gridLayout
              ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3'
              : 'flex flex-col gap-3'
          }
        >
          {rows.map((row) => (
            <MobileTableCard
              key={row.id}
              row={row}
              rowClassName={rowClassName}
              expandable={expandable}
              card={card}
              columnIcons={columnIcons}
              gridLayout={gridLayout}
            />
          ))}
        </div>
      )}
    </div>
  )
} as <TData extends RowData>(
  props: MobileTableCardsProps<TData>
) => React.JSX.Element
