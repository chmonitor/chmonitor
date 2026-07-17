import { useQuery } from '@tanstack/react-query'

import { useExplorerState } from '../hooks/use-explorer-state'
import { useTreeKeyboardNav } from '../hooks/use-tree-keyboard-nav'
import { useTreeState } from '../hooks/use-tree-state'
import { DatabaseNode } from './database-node'
import { TreeSearch } from './tree-search'
import { TreeSkeleton } from './tree-skeleton'
import { useState } from 'react'
import { SidebarMenu } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

interface Database {
  name: string
}

interface ApiResponse<T> {
  data: T
  metadata?: Record<string, unknown>
}

const fetcher = async (url: string): Promise<ApiResponse<Database[]>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

export function DatabaseTree() {
  const hostId = useHostId()
  const [searchFilter, setSearchFilter] = useState('')
  const { database, table, setDatabase, setDatabaseAndTable } =
    useExplorerState()
  const { isDatabaseExpanded, isTableExpanded, toggleDatabase, toggleTable } =
    useTreeState(database, table)
  const { handleKeyDown, handleFocus } = useTreeKeyboardNav()

  const queryKey = `/api/v1/explorer/databases?hostId=${hostId}`
  const {
    data: response,
    error,
    isLoading,
  } = useQuery<ApiResponse<Database[]>>({
    queryKey: [queryKey],
    queryFn: () => fetcher(queryKey),
    // Schema shape changes rarely — don't refetch the database list on every remount.
    staleTime: 5 * 60_000,
  })

  const databases = response?.data

  const handleSelectDatabase = (db: string) => {
    setDatabase(db)
    // Also expand the database if not already expanded
    if (!isDatabaseExpanded(db)) {
      toggleDatabase(db)
    }
  }

  const handleSelectTable = (db: string, tbl: string, engine: string) => {
    setDatabaseAndTable(db, tbl, engine)
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-destructive">
        Failed to load databases: {error.message}
      </div>
    )
  }

  if (isLoading) {
    return <TreeSkeleton />
  }

  if (!databases || databases.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No databases found
      </div>
    )
  }

  // Fallback roving-tabindex anchor: when nothing is selected yet, the first
  // database is the tree's single tabbable entry point.
  const hasSelection = Boolean(database)

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-2">
        <TreeSearch value={searchFilter} onChange={setSearchFilter} />
        <SidebarMenu
          role="tree"
          aria-label="Database explorer"
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
        >
          {databases.map((db, index) => (
            <DatabaseNode
              key={db.name}
              database={db.name}
              isExpanded={isDatabaseExpanded(db.name)}
              isTableExpanded={isTableExpanded}
              selectedTable={table}
              selectedDatabase={database}
              level={0}
              posInSet={index + 1}
              setSize={databases.length}
              isDefaultTabbable={!hasSelection && index === 0}
              searchFilter={searchFilter}
              onToggleDatabase={toggleDatabase}
              onToggleTable={toggleTable}
              onSelectDatabase={handleSelectDatabase}
              onSelectTable={handleSelectTable}
            />
          ))}
        </SidebarMenu>
      </div>
    </TooltipProvider>
  )
}
