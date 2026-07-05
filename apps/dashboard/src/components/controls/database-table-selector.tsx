import { Database, Table2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ApiResponse } from '@/lib/api/types'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface DatabaseItem {
  name: string
}

interface TableItem {
  name: string
  total_rows?: number
}

const fetcher = async <T,>(url: string): Promise<ApiResponse<T>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

interface DatabaseTableSelectorProps {
  className?: string
  showLabels?: boolean
}

/**
 * Database and table selector component.
 * Fetches databases and tables from the API and updates URL query parameters.
 */
export function DatabaseTableSelector({
  className,
  showLabels = true,
}: DatabaseTableSelectorProps) {
  const hostId = useHostId()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const database = searchParams.get('database')
  const table = searchParams.get('table')

  // Fetch databases
  const { data: databasesResponse, isLoading: isLoadingDatabases } = useQuery<
    ApiResponse<DatabaseItem[]>
  >({
    queryKey: [`/api/v1/explorer/databases?hostId=${hostId}`],
    queryFn: () => fetcher(`/api/v1/explorer/databases?hostId=${hostId}`),
  })

  // Fetch tables (only when database is selected)
  const tablesKey = database
    ? `/api/v1/explorer/tables?hostId=${hostId}&database=${encodeURIComponent(database)}`
    : null
  const { data: tablesResponse, isLoading: isLoadingTables } = useQuery<
    ApiResponse<TableItem[]>
  >({
    queryKey: [tablesKey],
    queryFn: () => fetcher(tablesKey!),
    enabled: Boolean(tablesKey),
  })

  const databases = databasesResponse?.data ?? []
  const tables = tablesResponse?.data ?? []

  const updateParams = (updates: {
    database?: string | null
    table?: string | null
  }) => {
    const params = new URLSearchParams(searchParams.toString())

    if (updates.database !== undefined) {
      if (updates.database === null) {
        params.delete('database')
        params.delete('table')
      } else {
        params.set('database', updates.database)
      }
    }

    if (updates.table !== undefined) {
      if (updates.table === null) {
        params.delete('table')
      } else {
        params.set('table', updates.table)
      }
    }

    router.push(`${pathname}?${params.toString()}`)
  }

  const handleDatabaseChange = (value: string) => {
    updateParams({ database: value, table: null })
  }

  const handleTableChange = (value: string) => {
    updateParams({ table: value })
  }

  return (
    <div className={cn('flex items-center gap-3', className)}>
      {/* Database Selector */}
      <div className="flex items-center gap-2">
        {showLabels && (
          <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Database className="size-4" />
            <span>Database</span>
          </label>
        )}
        {isLoadingDatabases ? (
          <Skeleton className="h-9 w-[180px]" />
        ) : (
          <Select
            value={database ?? ''}
            onValueChange={(value) => {
              if (value != null) handleDatabaseChange(value)
            }}
          >
            <SelectTrigger
              className="w-[180px]"
              data-testid="database-selector"
            >
              <SelectValue placeholder="Select database..." />
            </SelectTrigger>
            <SelectContent data-testid="database-options">
              {databases.map((db) => (
                <SelectItem key={db.name} value={db.name}>
                  {db.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Table Selector */}
      <div className="flex items-center gap-2">
        {showLabels && (
          <label className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Table2 className="size-4" />
            <span>Table</span>
          </label>
        )}
        {isLoadingTables && database ? (
          <Skeleton className="h-9 w-[180px]" />
        ) : (
          <Select
            value={table ?? ''}
            onValueChange={(value) => {
              if (value != null) handleTableChange(value)
            }}
            disabled={!database}
          >
            <SelectTrigger className="w-[180px]" data-testid="table-selector">
              <SelectValue
                placeholder={
                  database ? 'Select table...' : 'Select database first'
                }
              />
            </SelectTrigger>
            <SelectContent data-testid="table-options">
              {tables.map((tbl) => (
                <SelectItem key={tbl.name} value={tbl.name}>
                  <span className="flex items-center justify-between gap-2">
                    <span>{tbl.name}</span>
                    {tbl.total_rows != null && (
                      <span className="text-muted-foreground text-xs">
                        {tbl.total_rows.toLocaleString()} rows
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  )
}
