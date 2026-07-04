import { Check, Copy, SparklesIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useExplorerState } from '../hooks/use-explorer-state'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { formatSql } from '@/lib/sql-format'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'
import { dedent } from '@/lib/utils'

interface DdlRow {
  create_table_query: string
}

interface ApiResponse<T> {
  data: T
  metadata?: Record<string, unknown>
}

const fetcher = async (url: string): Promise<ApiResponse<DdlRow[]>> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json()
}

export function DdlTab() {
  const hostId = useHostId()
  const { database, table } = useExplorerState()
  const [copied, setCopied] = useState(false)
  // Pretty-format on by default — DDL is small, so formatting is cheap and the
  // formatted form is what most people want to read. In-memory only (no shared
  // preference) so it stays independent of the Request Info "Beautify" toggle.
  const [isBeautified, setIsBeautified] = useState(true)

  const url =
    database && table
      ? `/api/v1/explorer/ddl?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
      : null

  const {
    data: response,
    error,
    isLoading,
  } = useQuery<ApiResponse<DdlRow[]>>({
    queryKey: [url],
    queryFn: () => fetcher(url!),
    enabled: Boolean(database && table),
  })

  const ddl = response?.data?.[0]?.create_table_query
  const raw = ddl ? dedent(ddl) : ''

  // Lazily format the DDL when beautify is on. Show the raw DDL while the
  // formatter chunk loads (no flash) and reset on table change so we never
  // render a previous table's formatted SQL under the new header.
  const [formatted, setFormatted] = useState<string | null>(null)
  useEffect(() => {
    setFormatted(null)
    if (!isBeautified || !ddl) return
    let cancelled = false
    formatSql(ddl).then((result) => {
      if (!cancelled) setFormatted(result)
    })
    return () => {
      cancelled = true
    }
  }, [isBeautified, ddl])

  const displaySql = isBeautified ? (formatted ?? raw) : raw

  const handleCopy = async () => {
    if (displaySql) {
      await navigator.clipboard.writeText(displaySql)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  if (!database || !table) {
    return null
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Table DDL</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-96 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Table DDL</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-destructive">
            Failed to load DDL: {error.message}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Table DDL</CardTitle>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <SparklesIcon className="size-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Beautify</span>
            <Switch
              size="sm"
              checked={isBeautified}
              onCheckedChange={setIsBeautified}
              aria-label="Toggle SQL formatting"
            />
          </div>
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? (
              <>
                <Check className="mr-2 size-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-2 size-4" />
                Copy
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-4 font-mono text-xs leading-relaxed">
          <code>{displaySql}</code>
        </pre>
      </CardContent>
    </Card>
  )
}
