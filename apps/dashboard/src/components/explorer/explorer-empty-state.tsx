import type { LucideIcon } from 'lucide-react'
import {
  DatabaseIcon,
  DatabaseZapIcon,
  HardDriveIcon,
  Loader2,
  RefreshCwIcon,
  ServerIcon,
  SquareTerminal,
  TableIcon,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useExplorerState } from './hooks/use-explorer-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { activateOnEnterOrSpace } from '@/lib/a11y'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface Database {
  name: string
  engine: string
}

interface DatabaseCount {
  name: string
  item_count: number | string
}

// Schema shape changes rarely; skip refetching the database list on every
// remount of the empty-state within this window.
const SCHEMA_STALE_TIME = 5 * 60_000

function getDatabaseIcon(engine: string): {
  icon: LucideIcon
  color: string
  bg: string
} {
  switch (engine) {
    case 'PostgreSQL':
    case 'MaterializedPostgreSQL':
      return {
        icon: ServerIcon,
        color: 'text-blue-600 dark:text-blue-400',
        bg: 'bg-blue-500/10 group-hover:bg-blue-500/20',
      }
    case 'MySQL':
    case 'MaterializedMySQL':
      return {
        icon: DatabaseZapIcon,
        color: 'text-orange-600 dark:text-orange-400',
        bg: 'bg-orange-500/10 group-hover:bg-orange-500/20',
      }
    case 'SQLite':
      return {
        icon: HardDriveIcon,
        color: 'text-sky-600 dark:text-sky-400',
        bg: 'bg-sky-500/10 group-hover:bg-sky-500/20',
      }
    case 'Replicated':
      return {
        icon: RefreshCwIcon,
        color: 'text-green-600 dark:text-green-400',
        bg: 'bg-green-500/10 group-hover:bg-green-500/20',
      }
    case 'Lazy':
      return {
        icon: DatabaseIcon,
        color: 'text-yellow-600 dark:text-yellow-400',
        bg: 'bg-yellow-500/10 group-hover:bg-yellow-500/20',
      }
    // Atomic is the default ClickHouse database engine
    default:
      return {
        icon: DatabaseIcon,
        color: 'text-primary',
        bg: 'bg-primary/10 group-hover:bg-primary/20',
      }
  }
}

interface ApiResponse<T> {
  data: T
  metadata?: Record<string, unknown>
}

const fetcher = async <T,>(url: string): Promise<ApiResponse<T>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch databases: ${res.statusText}`)
  }
  return res.json() as Promise<ApiResponse<T>>
}

export function ExplorerEmptyState() {
  const hostId = useHostId()
  const { setDatabase, setTab } = useExplorerState()
  const databasesUrl = `/api/v1/explorer/databases?hostId=${hostId}`
  const {
    data: response,
    error,
    isLoading,
  } = useQuery<ApiResponse<Database[]>>({
    queryKey: [databasesUrl],
    queryFn: () => fetcher<Database[]>(databasesUrl),
    staleTime: SCHEMA_STALE_TIME,
  })

  // Table counts stream in separately so the database cards can paint on names
  // immediately instead of waiting on a cluster-wide system.tables enumeration.
  const countsUrl = `/api/v1/tables/explorer-database-counts?hostId=${hostId}`
  const { data: countsResponse, isLoading: countsLoading } = useQuery<
    ApiResponse<DatabaseCount[]>
  >({
    queryKey: [countsUrl],
    queryFn: () => fetcher<DatabaseCount[]>(countsUrl),
    staleTime: SCHEMA_STALE_TIME,
  })

  const databases = response?.data

  const countByName = new Map<string, number>(
    (countsResponse?.data ?? []).map((row) => [
      row.name,
      Number(row.item_count),
    ])
  )

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      {/* Welcome Header */}
      <div className="flex flex-col items-center justify-center gap-4 text-center">
        <DatabaseIcon className="size-16 text-muted-foreground" />
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">Welcome to Data Explorer</h3>
          <p className="text-sm text-muted-foreground max-w-md">
            Select a database and table from the sidebar to view its data,
            structure, DDL, indexes, and dependencies.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTab('query')}
          className="gap-1.5"
        >
          <SquareTerminal className="size-4" />
          Query Editor
        </Button>
      </div>

      {/* Database List */}
      <div className="flex flex-col gap-4">
        <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <TableIcon className="size-4" />
          Available Databases
          {isLoading && <Loader2 className="size-3 animate-spin" />}
        </h4>

        {error && (
          <div className="text-sm text-destructive">
            Failed to load databases: {error.message}
          </div>
        )}

        {isLoading && !databases && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        )}

        {databases && databases.length === 0 && (
          <div className="text-sm text-muted-foreground">
            No databases found
          </div>
        )}

        {databases && databases.length > 0 && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {databases.map((db) => {
              const { icon: Icon, color, bg } = getDatabaseIcon(db.engine)
              const count = countByName.get(db.name)
              return (
                <Card
                  key={db.name}
                  role="button"
                  tabIndex={0}
                  className="group cursor-pointer p-4 transition-[border-color,background-color] hover:border-primary/50 hover:bg-muted/50"
                  onClick={() => setDatabase(db.name)}
                  onKeyDown={activateOnEnterOrSpace(() => setDatabase(db.name))}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex size-9 items-center justify-center rounded-md transition-colors',
                        bg
                      )}
                    >
                      <Icon className={cn('size-4', color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{db.name}</p>
                      {count === undefined && countsLoading ? (
                        <Skeleton className="mt-1 h-3 w-12" />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {count ?? 0} {count === 1 ? 'item' : 'items'}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
