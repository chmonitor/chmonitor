import { AlertCircle, Loader2, RefreshCw, ShieldAlert } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'

import type { ApiError, ApiResponse } from '@/lib/api/types'

import { useExplorerState } from '../hooks/use-explorer-state'
import { useMemo, useState } from 'react'
import { TableSkeleton } from '@/components/skeletons'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { activateOnEnterOrSpace } from '@/lib/a11y'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

const MAX_CELL_LENGTH = 100

/**
 * Expandable cell component for long text content
 * Shows truncated text inline with click-to-expand functionality
 */
const ExpandableCell = function ExpandableCell({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false)
  const stringValue = String(value ?? '')
  const isLong = stringValue.length > MAX_CELL_LENGTH

  const toggleExpand = () => {
    setExpanded((prev) => !prev)
  }

  if (!isLong) {
    return <span className="block truncate">{stringValue}</span>
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={toggleExpand}
      onKeyDown={activateOnEnterOrSpace(toggleExpand)}
      className={cn(
        'block cursor-pointer transition-colors',
        expanded ? 'whitespace-pre-wrap break-words' : 'truncate',
        !expanded && 'hover:text-primary'
      )}
      title={expanded ? 'Click to collapse' : 'Click to expand'}
      aria-expanded={expanded}
    >
      {expanded ? stringValue : `${stringValue.slice(0, MAX_CELL_LENGTH)}…`}
    </span>
  )
}

/** Custom error class to carry API error details */
class DataTabError extends Error {
  type: string
  details?: Record<string, unknown>

  constructor(apiError: ApiError) {
    super(apiError.message)
    this.name = 'DataTabError'
    this.type = apiError.type
    this.details = apiError.details as Record<string, unknown> | undefined
  }
}

const PAGE_SIZE_OPTIONS = [100, 500, 1000] as const

const fetcher = async (
  url: string
): Promise<ApiResponse<Record<string, unknown>[]>> => {
  const res = await apiFetch(url)
  const json = (await res.json()) as ApiResponse<Record<string, unknown>[]>

  if (!json.success && json.error) {
    throw new DataTabError(json.error)
  }

  return json
}

type RowData = Record<string, unknown>
const columnHelper = createColumnHelper<RowData>()

export function DataTab() {
  const hostId = useHostId()
  const { database, table: tableName } = useExplorerState()
  const [limit, setLimit] = useState<number>(100)
  const [offset, setOffset] = useState<number>(0)
  const queryClient = useQueryClient()

  const queryKey = [
    database && tableName
      ? `/api/v1/explorer/preview?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(tableName)}&limit=${limit}&offset=${offset}`
      : null,
  ]

  const {
    data: response,
    error,
    isLoading,
    isFetching,
  } = useQuery<ApiResponse<RowData[]>>({
    queryKey,
    queryFn: () =>
      fetcher(
        `/api/v1/explorer/preview?hostId=${hostId}&database=${encodeURIComponent(database!)}&table=${encodeURIComponent(tableName!)}&limit=${limit}&offset=${offset}`
      ),
    enabled: Boolean(database && tableName),
    placeholderData: (prev) => prev,
  })

  const mutate = () => queryClient.invalidateQueries({ queryKey })

  const rows = response?.data || []

  // Generate columns dynamically from data.
  // Keyed on the column-name signature so the array is only rebuilt when the
  // schema changes, not on every data refetch (which would remount all cells).
  const _columnSchema = Object.keys(rows[0] ?? {}).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the column-name signature so columns only rebuild on schema changes, not every refetch
  const columns = useMemo(() => {
    if (rows.length === 0) return []
    return Object.keys(rows[0]).map((key) =>
      columnHelper.accessor(key, {
        header: key,
        cell: (info) => <ExpandableCell value={info.getValue()} />,
        size: 200,
        minSize: 80,
        maxSize: 500,
      })
    )
  }, [_columnSchema])

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
    defaultColumn: {
      size: 200,
      minSize: 80,
      maxSize: 500,
    },
  })

  if (!database || !tableName) {
    return null
  }

  if (isLoading && !response) {
    return <TableSkeleton />
  }

  if (error) {
    const isPermissionError =
      error instanceof DataTabError && error.type === 'permission_error'
    const Icon = isPermissionError ? ShieldAlert : AlertCircle

    return (
      <Alert
        variant="destructive"
        className={cn(
          isPermissionError && 'border-amber-500/50 bg-amber-500/10'
        )}
      >
        <Icon className="size-4" />
        <AlertTitle>
          {isPermissionError ? 'Permission Denied' : 'Failed to load data'}
        </AlertTitle>
        <AlertDescription className="mt-2 space-y-2">
          <p className="text-sm">
            {isPermissionError
              ? `You don't have permission to access this table. This may be a linked external database (PostgreSQL, MySQL, etc.) with restricted access.`
              : error.message}
          </p>
          {!isPermissionError && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => mutate()}
              className="mt-2"
            >
              <RefreshCw className="mr-1.5 size-3" />
              Retry
            </Button>
          )}
        </AlertDescription>
      </Alert>
    )
  }

  if (rows.length === 0 && !isFetching) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No data available for {database}.{tableName}
      </div>
    )
  }

  const currentPage = Math.floor(offset / limit) + 1
  const hasNextPage = rows.length === limit
  const isPaginating = isFetching && !!response

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page:</span>
          <Select
            value={String(limit)}
            onValueChange={(v) => {
              setLimit(Number(v))
              setOffset(0)
            }}
            disabled={isPaginating}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {isPaginating && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          <span className="text-sm text-muted-foreground">
            Page {currentPage}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={offset === 0 || isPaginating}
            onClick={() => setOffset(Math.max(0, offset - limit))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasNextPage || isPaginating}
            onClick={() => setOffset(offset + limit)}
          >
            Next
          </Button>
        </div>
      </div>

      <div
        className={cn(
          'overflow-x-auto rounded-md border transition-opacity',
          isPaginating && 'opacity-60'
        )}
      >
        <Table
          style={{
            minWidth: table.getCenterTotalSize(),
            width: '100%',
          }}
        >
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className="relative select-none"
                    style={{
                      minWidth: header.getSize(),
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    {/* Column resize handle */}
                    <div
                      role="presentation"
                      onDoubleClick={() => header.column.resetSize()}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className={cn(
                        'absolute right-0 top-0 h-full w-1 cursor-col-resize select-none touch-none',
                        'bg-transparent hover:bg-primary/50',
                        header.column.getIsResizing() && 'bg-primary'
                      )}
                    />
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} className="hover:bg-muted/50">
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    style={{
                      minWidth: cell.column.getSize(),
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
