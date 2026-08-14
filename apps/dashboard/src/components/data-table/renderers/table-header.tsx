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

/**
 * Props for TableHeaderRow component
 */
export interface TableHeaderRowProps {
  headers: Header<any, unknown>[]
  /** Whether column resizing is enabled */
  enableResize?: boolean
  /** Callback when double-clicking column resizer to auto-fit */
  onAutoFit?: (columnId: string) => void
  /** Enable column reordering with drag-and-drop */
  enableColumnReordering?: boolean
  /** Compact mode — reduces header padding to match dense body cells */
  compact?: boolean
}

/**
 * Props for ColumnResizer component
 */
interface ColumnResizerProps {
  header: Header<any, unknown>
  /** Callback when double-clicking to auto-fit column width */
  onAutoFit?: (columnId: string) => void
}

/**
 * ColumnResizer - Drag handle for column resizing
 *
 * Double-click to auto-fit column width to content.
 * Drag to manually resize.
 */
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

/**
 * Props for DraggableTableHeader component
 */
interface DraggableTableHeaderProps {
  header: Header<any, unknown>
  enableResize?: boolean
  onAutoFit?: (columnId: string) => void
  isSelectColumn?: boolean
  compact?: boolean
}

/**
 * DraggableTableHeader - Column header with drag-and-drop support
 *
 * Integrates with @dnd-kit for column reordering while maintaining
 * all existing functionality (sorting, resizing, etc.).
 */
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
    // Apply CSS transform during drag for visual feedback
    // After drag ends, TanStack Table's columnOrder state takes over
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
        {/* Drag handle for column reordering - hidden by default, shown on hover */}
        <Button
          {...attributes}
          {...listeners}
          type="button"
          variant="ghost"
          size="icon-sm"
          className={cn(
            'absolute left-0 size-6 shrink-0 cursor-grab text-muted-foreground opacity-0 sm:inline-flex',
            'active:cursor-grabbing',
            'group-hover:opacity-40 group-focus-within:opacity-40 hover:opacity-100 focus:opacity-100 focus-visible:opacity-100',
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
        <div className="min-w-0 flex-1 pl-7">
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
              {/* Dropdown menu for sort/copy actions - shown on hover */}
              {canSort && <ColumnHeaderDropdown header={header} />}
            </div>
          </div>
        </div>
      </div>
      {canResize && <ColumnResizer header={header} onAutoFit={onAutoFit} />}
    </TableHead>
  )
}

/**
 * TableHeaderRow - Renders a single header row with sortable columns
 *
 * Handles:
 * - Column header rendering with flexRender for custom content
 * - Placeholder cells for expandable rows
 * - Consistent styling with hover effects
 * - Column resizing with drag handles and auto-fit on double-click
 * - Column reordering with drag-and-drop (when enabled)
 *
 * Performance: Memoized to prevent unnecessary re-renders
 */
export const TableHeaderRow = function TableHeaderRow({
  headers,
  enableResize = true,
  onAutoFit,
  enableColumnReordering = false,
  compact = false,
}: TableHeaderRowProps) {
  // Header padding matches body cell density
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

        // If column reordering is enabled, use DraggableTableHeader
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

        // Standard header without drag-and-drop, but with sort dropdown and click-to-sort

        return (
          <TableHead
            key={header.id}
            scope="col"
            className={cn(
              'relative font-semibold text-foreground/90 transition-colors',
              headerPy,
              isSelectColumn ? 'px-2' : headerPx,
              // Show pointer cursor for sortable columns
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
                    {/* Dropdown menu for sort/copy actions - shown on hover */}
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

/**
 * Props for TableHeader component
 */
export interface TableHeaderProps<TData = unknown> {
  headerGroups: HeaderGroup<TData>[]
  /** Callback when double-clicking column resizer to auto-fit */
  onAutoFit?: (columnId: string) => void
  /** Enable column reordering with drag-and-drop */
  enableColumnReordering?: boolean
  /** Compact mode — reduces header padding to match dense body cells */
  compact?: boolean
}

/**
 * TableHeader - Renders the complete table header section
 *
 * @param headerGroups - Array of header groups from TanStack Table
 * @param onAutoFit - Callback for auto-fitting column width
 * @param enableColumnReordering - Enable drag-and-drop column reordering
 *
 * Renders all header groups (typically one) with TableHeaderRow components.
 * Performance: Memoized to prevent unnecessary re-renders
 */
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
