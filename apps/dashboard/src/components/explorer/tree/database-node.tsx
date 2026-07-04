import { DatabaseIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { TableNode } from './table-node'
import { TreeNode } from './tree-node'
import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

interface Table {
  name: string
  engine: string
  total_rows: number
}

interface ApiResponse<T> {
  data: T
  metadata?: Record<string, unknown>
}

interface DatabaseNodeProps {
  database: string
  isExpanded: boolean
  isTableExpanded: (key: string) => boolean
  selectedTable: string | null
  selectedDatabase: string | null
  level: number
  searchFilter: string
  onToggleDatabase: (database: string) => void
  onToggleTable: (key: string) => void
  onSelectDatabase: (database: string) => void
  onSelectTable: (database: string, table: string, engine: string) => void
}

const fetcher = async (url: string): Promise<ApiResponse<Table[]>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

export const DatabaseNode = function DatabaseNode({
  database,
  isExpanded,
  isTableExpanded,
  selectedTable,
  selectedDatabase,
  level,
  searchFilter,
  onToggleDatabase,
  onToggleTable,
  onSelectDatabase,
  onSelectTable,
}: DatabaseNodeProps) {
  const hostId = useHostId()
  const [shouldFetch, setShouldFetch] = useState(false)

  // Auto-trigger fetch when expanded (including from URL state)
  useEffect(() => {
    if (isExpanded && !shouldFetch) {
      setShouldFetch(true)
    }
  }, [isExpanded, shouldFetch])

  const url = `/api/v1/explorer/tables?hostId=${hostId}&database=${encodeURIComponent(database)}`

  const { data: response, isLoading } = useQuery<ApiResponse<Table[]>>({
    queryKey: [url],
    queryFn: () => fetcher(url),
    enabled: shouldFetch,
    // Table list per database changes rarely — cache across expand/collapse and remounts.
    staleTime: 5 * 60_000,
  })

  const tables = response?.data

  const filteredTables = (() => {
    if (!tables) return []
    if (!searchFilter) return tables

    const lowerFilter = searchFilter.toLowerCase()
    return tables.filter((table) =>
      table.name.toLowerCase().includes(lowerFilter)
    )
  })()

  const handleToggle = () => {
    if (!shouldFetch) {
      setShouldFetch(true)
    }
    onToggleDatabase(database)
  }

  const handleSelect = () => {
    onSelectDatabase(database)
  }

  const handleSelectTable = (tbl: string, engine: string) => {
    onSelectTable(database, tbl, engine)
  }

  const showLoadingSkeleton = isLoading && isExpanded && !tables

  // Only highlight if this database is selected and no table is selected
  const isHighlighted = selectedDatabase === database && !selectedTable

  return (
    <TreeNode
      label={database}
      icon={DatabaseIcon}
      isExpanded={isExpanded}
      isSelected={selectedDatabase === database && !selectedTable}
      isHighlighted={isHighlighted}
      isLoading={isLoading && isExpanded}
      hasChildren
      level={level}
      onToggle={handleToggle}
      onSelect={handleSelect}
    >
      {showLoadingSkeleton ? (
        <div
          className="space-y-1 py-1"
          style={{ paddingLeft: `${(level + 1) * 12}px` }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-[80%]" />
          ))}
        </div>
      ) : (
        filteredTables.map((table) => {
          const tableKey = `${database}.${table.name}`
          return (
            <TableNode
              key={tableKey}
              database={database}
              table={table.name}
              engine={table.engine}
              totalRows={table.total_rows}
              isExpanded={isTableExpanded(tableKey)}
              isSelected={
                selectedDatabase === database && selectedTable === table.name
              }
              level={level + 1}
              onToggle={() => onToggleTable(tableKey)}
              onSelect={() => handleSelectTable(table.name, table.engine)}
            />
          )
        })
      )}
    </TreeNode>
  )
}
