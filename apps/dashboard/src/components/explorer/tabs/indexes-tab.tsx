import { Database, Filter, Key, Layers, Settings } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useExplorerState } from '../hooks/use-explorer-state'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'

interface IndexesData {
  partition_key: string
  sorting_key: string
  primary_key: string
  sampling_key: string
  engine: string
  engine_full: string
}

interface SkipIndexData {
  name: string
  type: string
  type_full: string
  expr: string
  granularity: number
  compressed_size: string
  uncompressed_size: string
  compression_ratio: number
}

interface ProjectionData {
  name: string
  compressed_size: string
  uncompressed_size: string
  compression_ratio: number
  rows: string
  parts: number
}

interface ApiResponse<T> {
  data: T
  metadata?: Record<string, unknown>
}

const fetcher = async <T,>(url: string): Promise<ApiResponse<T>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

const ENGINE_FULL_KEYWORDS =
  /\b(PARTITION BY|PRIMARY KEY|ORDER BY|TTL|SETTINGS|SAMPLE BY)\b/g

function formatEngineFull(engineFull: string): string {
  return engineFull.replace(ENGINE_FULL_KEYWORDS, '\n$1')
}

export function IndexesTab() {
  const hostId = useHostId()
  const { database, table } = useExplorerState()

  // Fetch indexes data
  const indexesKey =
    database && table
      ? `/api/v1/explorer/indexes?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      : null
  const {
    data: indexesResponse,
    error: indexesError,
    isLoading: indexesLoading,
  } = useQuery<ApiResponse<IndexesData[]>>({
    queryKey: [indexesKey],
    queryFn: () => fetcher<IndexesData[]>(indexesKey!),
    enabled: Boolean(indexesKey),
  })

  // Fetch skip indexes data
  const skipIndexesKey =
    database && table
      ? `/api/v1/explorer/skip-indexes?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      : null
  const {
    data: skipIndexesResponse,
    error: skipIndexesError,
    isLoading: skipIndexesLoading,
  } = useQuery<ApiResponse<SkipIndexData[]>>({
    queryKey: [skipIndexesKey],
    queryFn: () => fetcher<SkipIndexData[]>(skipIndexesKey!),
    enabled: Boolean(skipIndexesKey),
  })

  // Fetch projections data
  const projectionsKey =
    database && table
      ? `/api/v1/explorer/projections?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      : null
  const {
    data: projectionsResponse,
    error: projectionsError,
    isLoading: projectionsLoading,
  } = useQuery<ApiResponse<ProjectionData[]>>({
    queryKey: [projectionsKey],
    queryFn: () => fetcher<ProjectionData[]>(projectionsKey!),
    enabled: Boolean(projectionsKey),
  })

  const indexData = indexesResponse?.data?.[0]
  const skipIndexes = skipIndexesResponse?.data || []
  const projections = projectionsResponse?.data || []

  if (!database || !table) {
    return null
  }

  const isLoading = indexesLoading || projectionsLoading
  const error = indexesError || projectionsError

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="gap-2 py-3">
              <CardHeader className="px-4">
                <Skeleton className="h-5 w-32" />
              </CardHeader>
              <CardContent className="px-4">
                <Skeleton className="h-12 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="px-4">
            <Skeleton className="h-24 w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <Card className="gap-3 py-4">
        <CardContent className="px-4">
          <div className="text-xs text-destructive">
            Failed to load data: {error.message}
          </div>
        </CardContent>
      </Card>
    )
  }

  const keyFields = [
    {
      label: 'Partition Key',
      value: indexData?.partition_key,
      icon: <Database className="size-3.5" />,
    },
    {
      label: 'Sorting Key',
      value: indexData?.sorting_key,
      icon: <Key className="size-3.5" />,
    },
    {
      label: 'Primary Key',
      value: indexData?.primary_key,
      icon: <Key className="size-3.5" />,
    },
    {
      label: 'Sampling Key',
      value: indexData?.sampling_key,
      icon: <Settings className="size-3.5" />,
    },
  ]

  // Dense table: shorter header row + tighter cell padding, applied at the call
  // site so the shared shadcn Table primitive stays untouched.
  const denseTable = 'text-xs [&_th]:h-8 [&_td]:py-1.5'

  return (
    <div className="flex flex-col gap-4">
      {/* Engine Info */}
      {indexData?.engine && (
        <Card className="gap-3 py-4">
          <CardHeader className="px-4">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Settings className="size-3.5" />
              Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="space-y-1.5">
              <div className="text-sm font-medium">{indexData.engine}</div>
              {indexData.engine_full &&
                indexData.engine_full !== indexData.engine && (
                  <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-xs">
                    <code>{formatEngineFull(indexData.engine_full)}</code>
                  </pre>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys Grid */}
      <div className="grid gap-3 md:grid-cols-2">
        {keyFields.map(({ label, value, icon }) => (
          <Card key={label} className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardTitle className="flex items-center gap-2 text-sm">
                {icon}
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              {value ? (
                <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-xs">
                  <code>{value}</code>
                </pre>
              ) : (
                <p className="text-xs text-muted-foreground">Not set</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Skip Indexes */}
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Filter className="size-3.5" />
            Skip Indexes
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {skipIndexesLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : skipIndexesError ? (
            <p className="text-xs text-muted-foreground">
              Skip indexes data unavailable
            </p>
          ) : skipIndexes.length > 0 ? (
            <Table className={denseTable}>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Expression</TableHead>
                  <TableHead className="text-right">Granularity</TableHead>
                  <TableHead className="text-right">Compressed</TableHead>
                  <TableHead className="text-right">Uncompressed</TableHead>
                  <TableHead className="text-right">Ratio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skipIndexes.map((idx) => (
                  <TableRow key={`${idx.name}-${idx.type}-${idx.expr}`}>
                    <TableCell className="font-medium">{idx.name}</TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
                        {idx.type_full}
                      </code>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs">{idx.expr}</code>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {idx.granularity}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {idx.compressed_size}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {idx.uncompressed_size}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {idx.compression_ratio}x
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground">
              No skip indexes defined for this table
            </p>
          )}
        </CardContent>
      </Card>

      {/* Projections */}
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="size-3.5" />
            Projections
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {projections.length > 0 ? (
            <Table className={denseTable}>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Compressed</TableHead>
                  <TableHead className="text-right">Uncompressed</TableHead>
                  <TableHead className="text-right">Ratio</TableHead>
                  <TableHead className="text-right">Rows</TableHead>
                  <TableHead className="text-right">Parts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {projections.map((proj) => (
                  <TableRow key={proj.name}>
                    <TableCell className="font-medium">{proj.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {proj.compressed_size}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {proj.uncompressed_size}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {proj.compression_ratio}x
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {proj.rows}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {proj.parts}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground">
              No projections defined for this table
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
