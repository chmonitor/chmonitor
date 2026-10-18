import { GripVertical } from 'lucide-react'
import {
  flexRender,
  type Header,
  type HeaderGroup,
} from '@tanstack/react-table'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ColumnHeaderDropdown } from '@/components/data-table/buttons/column-header-dropdown'
import { Button } from '@/components/ui/button'
import { TableHead, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

export const COMMON_COLUMN_DESCRIPTIONS: Record<string, string> = {
  query_id: 'The unique ID associated with the query execution.',
  query: 'The SQL query string that was executed.',
  database: 'The database name targeted by this operation.',
  table: 'The table name targeted by this operation.',
  event_time: 'The date and time when the event occurred.',
  event_date: 'The date when the event occurred.',
  query_duration_ms: 'Total execution time of the query in milliseconds.',
  read_rows: 'Total number of rows read from all shards and replicas.',
  read_bytes: 'Total number of bytes read from disk/cache.',
  written_rows: 'Total number of rows written to disk.',
  written_bytes: 'Total number of bytes written to disk.',
  result_rows: 'Number of rows returned to the client in the result set.',
  result_bytes: 'Number of bytes returned to the client in the result set.',
  memory_usage: 'Peak memory consumed by this query during execution.',
  user: 'The user account that ran the query.',
  client_hostname:
    'The hostname of the client machine that initiated the query.',
  client_name: 'The name of the client application or library used.',
  exception: 'Detailed error/exception message if the query failed.',
  exception_code: 'Numeric error code returned by ClickHouse.',
  threads: 'Number of CPU threads used for parallel query execution.',
  active: 'Whether the query or process is currently running.',
  host: 'The hostname or IP address of the database node.',
  rows: 'Number of rows in the table or part.',
  bytes: 'Disk space consumed by the table or part.',
  bytes_on_disk: 'Actual disk space used after compression.',
  parts: 'Number of active data parts inside the table.',
  active_parts: 'Number of active data parts.',
  engine: 'The storage engine used by this table (e.g. MergeTree).',
  partition: 'The partition key value for this data part.',
  partition_id: 'The unique ID of the partition.',
}

export interface TableHeaderRowProps {
  headers: Header<any, unknown>[]
  enableResize?: boolean
  onAutoFit?: (columnId: string) => void
  enableColumnReordering?: boolean
  compact?: boolean
}

interface ColumnResizerProps {
  header: Header<any, unknown>
  onAutoFit?: (columnId: string) => void
}

function ColumnResizer({ header, onAutoFit }: ColumnResizerProps) {
  const handleDoubleClick = () => {
    if (onAutoFit) {
      onAutoFit(header.column.id)
    } else {
      header.column.resetSize()
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={header.column.getSize()}
      // PointerSensor (dnd-kit) listens for pointerdown to start a column
      // drag; stop it here so resize wins. Also block the synthetic click so
      // the header sort handler doesn't fire on mouseup.
      onPointerDown={(e) => {
        e.stopPropagation()
        header.getResizeHandler()(e)
      }}
      onTouchStart={(e) => {
        e.stopPropagation()
        header.getResizeHandler()(e)
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation()
        handleDoubleClick()
      }}
      className={cn(
        'absolute right-0 top-0 z-20 h-full w-2 -mr-1 cursor-col-resize select-none touch-none',
        'after:absolute after:right-1 after:top-0 after:h-full after:w-px',
        'after:bg-border/60 hover:after:bg-primary active:after:bg-primary',
        'after:transition-colors',
        header.column.getIsResizing() && 'after:bg-primary'
      )}
      title={
        onAutoFit
          ? 'Drag to resize, double-click to auto-fit'
          : 'Drag to resize, double-click to reset'
      }
    />
  )
}

interface DraggableTableHeaderProps {
  header: Header<any, unknown>
  enableResize?: boolean
  onAutoFit?: (columnId: string) => void
  isSelectColumn?: boolean
  compact?: boolean
}

function DraggableTableHeader({
  header,
  enableResize,
  onAutoFit,
  isSelectColumn,
  compact,
}: DraggableTableHeaderProps) {
  const { attributes, isDragging, listeners, setNodeRef, transform } =
    useSortable({
      id: header.column.id,
    })

  const canResize = enableResize && header.column.getCanResize()
  const canSort = header.column.getCanSort()

  const style = {
    transform: CSS.Transform.toString(transform),
    width: header.column.getSize(),
    minWidth: header.column.columnDef.minSize ?? 50,
    maxWidth: header.column.columnDef.maxSize ?? undefined,
  }

  const headerPy = compact ? 'py-0.5' : 'py-2'
  const headerPx = isSelectColumn ? 'px-2' : compact ? 'px-1' : 'px-4'

  return (
    <TableHead
      ref={setNodeRef}
      key={header.id}
      scope="col"
      className={cn(
        'relative font-semibold text-foreground/90 transition-colors',
        headerPy,
        headerPx,
        isDragging && 'opacity-50'
      )}
      style={style}
      colSpan={header.colSpan}
    >
      <div className="group relative flex min-w-0 items-center pr-1.5">
        <Button
          {...attributes}
          {...listeners}
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            // `pointer-coarse:size-9` grows this icon-only grip to 36px for a
            // finger. The sibling label wrapper carries the matching
            // `pointer-coarse:pl-10` gutter, so the bigger handle never lands on
            // top of the column name.
            'absolute left-0 size-6 shrink-0 cursor-grab text-muted-foreground opacity-40 sm:inline-flex',
            'pointer-coarse:size-9',
            // Hover does not exist on touch and Tailwind v4 wraps a bare `hover:`
            // in `@media (hover: hover)`, so a resting `opacity-0` here leaves
            // the grip present, focusable, and invisible on every coarse
            // pointer. Rest visible, hide only where a hover does (the contract
            // components/cards/chart-action-classes.ts already ships).
            'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-40 pointer-fine:group-focus-within:opacity-40',
            // `!` because `pointer-fine:group-hover:opacity-40` shares this
            // selector's specificity and is emitted later in the sheet.
            'hover:!opacity-100 focus-visible:!opacity-100',
            'active:cursor-grabbing',
            'transition',
            'disabled:cursor-default disabled:opacity-50'
          )}
          aria-label={`Drag to reorder ${header.column.id} column`}
          tabIndex={0}
          style={{ touchAction: 'none' }}
          onClick={(e) => e.stopPropagation()} // Prevent drag from triggering sort
        >
          <GripVertical data-icon className="size-3" />
        </Button>
        <div className="min-w-0 flex-1 pl-7 pointer-coarse:pl-10">
          <div className="group flex min-w-0 items-center gap-1.5 justify-between">
            <span className="min-w-0 flex-1 truncate">
              {header.isPlaceholder
                ? null
                : flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {canSort && <ColumnHeaderDropdown header={header} />}
            </div>
          </div>
        </div>
      </div>
      {canResize && <ColumnResizer header={header} onAutoFit={onAutoFit} />}
    </TableHead>
  )
}

export const TableHeaderRow = function TableHeaderRow({
  headers,
  enableResize = true,
  onAutoFit,
  enableColumnReordering = false,
  compact = false,
}: TableHeaderRowProps) {
  const headerPx = compact ? 'px-1' : 'px-4'
  const headerPy = compact ? 'py-0.5' : 'py-2'

  return (
    <TableRow className="border-b border-border/70 hover:bg-transparent">
      {headers.map((header) => {
        const canResize = enableResize && header.column.getCanResize()
        const isSelectColumn = header.column.id === 'select'
        const isExpandColumn = header.column.id === '__expand'
        const isUtilityColumn = isSelectColumn || isExpandColumn
        const canSort = header.column.getCanSort()

        // Utility columns (selection checkbox, expand chevron) are pinned
        // and never draggable.
        if (isUtilityColumn) {
          return (
            <TableHead
              key={header.id}
              scope="col"
              className={cn(
                'relative',
                headerPy,
                isExpandColumn ? 'px-1' : 'px-2'
              )}
              style={{
                width: header.column.getSize(),
                minWidth: header.column.columnDef.minSize ?? 50,
                maxWidth: header.column.columnDef.maxSize ?? undefined,
              }}
            >
              {flexRender(header.column.columnDef.header, header.getContext())}
            </TableHead>
          )
        }

        if (enableColumnReordering) {
          return (
            <DraggableTableHeader
              key={header.id}
              header={header}
              enableResize={enableResize}
              onAutoFit={onAutoFit}
              isSelectColumn={isSelectColumn}
              compact={compact}
            />
          )
        }

        return (
          <TableHead
            key={header.id}
            scope="col"
            className={cn(
              'relative font-semibold text-foreground/90 transition-colors',
              headerPy,
              isSelectColumn ? 'px-2' : headerPx,
              canSort && 'cursor-pointer hover:text-foreground'
            )}
            style={{
              minWidth: header.column.columnDef.minSize ?? 50,
              maxWidth: header.column.columnDef.maxSize ?? undefined,
              width: header.column.getSize(),
            }}
          >
            <div className="group flex min-w-0 items-center pr-1.5">
              <div className="min-w-0 flex-1">
                <div className="group flex min-w-0 items-center gap-1.5 justify-between">
                  <span className="min-w-0 flex-1 truncate">
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    {canSort && <ColumnHeaderDropdown header={header} />}
                  </div>
                </div>
              </div>
            </div>
            {canResize && (
              <ColumnResizer header={header} onAutoFit={onAutoFit} />
            )}
          </TableHead>
        )
      })}
    </TableRow>
  )
}

export interface TableHeaderProps<TData = unknown> {
  headerGroups: HeaderGroup<TData>[]
  onAutoFit?: (columnId: string) => void
  enableColumnReordering?: boolean
  compact?: boolean
}

export const TableHeader = function TableHeader<TData = unknown>({
  headerGroups,
  onAutoFit,
  enableColumnReordering = false,
  compact = false,
}: TableHeaderProps<TData>) {
  return (
    <>
      {headerGroups.map((headerGroup) => (
        <TableHeaderRow
          key={headerGroup.id}
          headers={headerGroup.headers}
          onAutoFit={onAutoFit}
          enableColumnReordering={enableColumnReordering}
          compact={compact}
        />
      ))}
    </>
  )
}
