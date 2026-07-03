import { useQuery } from '@tanstack/react-query'

import { ColumnNode } from './column-node'
import { TreeNode } from './tree-node'
import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { getEngineIconConfig } from '@/lib/clickhouse-engine-icons'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface Column {
  name: string
  type: string
  is_in_primary_key: boolean
  is_in_sorting_key: boolean
}

interface ApiResponse<T> {
  data: T
  metadata?: Record<string, unknown>
}

interface TableNodeProps {
  database: string
  table: string
  engine: string
  totalRows?: number
  isExpanded: boolean
  isSelected: boolean
  level: number
  onToggle: () => void
  onSelect: () => void
}

const fetcher = async (url: string): Promise<ApiResponse<Column[]>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

/**
 * Format row count for display from raw number.
 * - 0 → "0"
 * - 1500 → "1.5K"
 * - 103194 → "103K" (rounded)
 * - 1250000 → "1.3M"
 * - 11610000000 → "11.6B"
 */
function formatRowCount(rows: number): string {
  if (rows === 0) return '0'

  const thresholds = [
    { value: 1_000_000_000_000, suffix: 'T' },
    { value: 1_000_000_000, suffix: 'B' },
    { value: 1_000_000, suffix: 'M' },
    { value: 1_000, suffix: 'K' },
  ]

  for (const { value, suffix } of thresholds) {
    if (rows >= value) {
      const formatted = rows / value
      // Round to 1 decimal place if needed, otherwise whole number
      const rounded =
        formatted % 1 === 0
          ? Math.round(formatted)
          : formatted.toFixed(1).replace(/\.0$/, '')
      return `${rounded}${suffix}`
    }
  }

  return rows.toString()
}

function RowCountBadge({ totalRows }: { totalRows: number }) {
  const [isHovered, setIsHovered] = useState(false)
  const formatted = formatRowCount(totalRows)
  const suffix = totalRows === 1 ? ' row' : ' rows'

  return (
    <span
      role="presentation"
      className="ml-auto text-[10px] text-muted-foreground tabular-nums cursor-default overflow-hidden"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="inline-flex">
        {formatted}
        <span
          className={cn(
            'inline-block transition-[opacity,max-width] duration-200 ease-out',
            isHovered ? 'max-w-[40px] opacity-100' : 'max-w-0 opacity-0'
          )}
        >
          {suffix}
        </span>
      </span>
    </span>
  )
}

export const TableNode = function TableNode({
  database,
  table,
  engine,
  totalRows,
  isExpanded,
  isSelected,
  level,
  onToggle,
  onSelect,
}: TableNodeProps) {
  const hostId = useHostId()
  const [shouldFetch, setShouldFetch] = useState(false)
  const engineConfig = getEngineIconConfig(engine)

  const queryKey = [
    `/api/v1/explorer/columns?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`,
  ]

  const { data: response, isLoading } = useQuery<ApiResponse<Column[]>>({
    queryKey,
    queryFn: () =>
      fetcher(
        `/api/v1/explorer/columns?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      ),
    enabled: shouldFetch,
    // Column schema changes rarely — cache across expand/collapse and remounts.
    staleTime: 5 * 60_000,
  })

  const columns = response?.data

  const handleToggle = () => {
    if (!shouldFetch) {
      setShouldFetch(true)
    }
    onToggle()
  }

  const showLoadingSkeleton = isLoading && isExpanded && !columns

  return (
    <TreeNode
      label={table}
      icon={engineConfig.icon}
      iconClassName={engineConfig.color}
      iconTooltip={engine}
      isExpanded={isExpanded}
      isSelected={isSelected}
      isLoading={isLoading && isExpanded}
      hasChildren
      expandOnSelect={false}
      level={level}
      badge={
        totalRows !== undefined && totalRows !== null ? (
          <RowCountBadge totalRows={totalRows} />
        ) : undefined
      }
      onToggle={handleToggle}
      onSelect={onSelect}
    >
      {showLoadingSkeleton ? (
        <div
          className="space-y-1 py-1"
          style={{ paddingLeft: `${(level + 1) * 12}px` }}
        >
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-[70%]" />
          ))}
        </div>
      ) : (
        columns?.map((column) => (
          <ColumnNode
            key={column.name}
            name={column.name}
            type={column.type}
            isInPrimaryKey={column.is_in_primary_key}
            isInSortingKey={column.is_in_sorting_key}
            level={level + 1}
          />
        ))
      )}
    </TreeNode>
  )
}
