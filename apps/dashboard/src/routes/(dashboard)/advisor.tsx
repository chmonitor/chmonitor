import { WandSparklesIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import type { AdvisorRecommendationsOutput } from '@/components/agents/advisor-recommendations-panel'

import { lazy, Suspense, useState } from 'react'
import { AdvisorRecommendationsPanel } from '@/components/agents/advisor-recommendations-panel'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'

// CodeMirror is heavy and browser-only — lazy-load it, same as /explain.
const SqlEditor = lazy(() =>
  import('@/components/explorer/sql-editor').then((m) => ({
    default: m.SqlEditor,
  }))
)

interface AdvisorApiResponse extends AdvisorRecommendationsOutput {
  success: true
}
interface AdvisorApiError {
  success: false
  error: string
}

const fetcher = async (url: string): Promise<AdvisorApiResponse> => {
  const res = await apiFetch(url)
  const body = (await res.json()) as AdvisorApiResponse | AdvisorApiError
  if (!res.ok || !body.success) {
    throw new Error(
      (body as AdvisorApiError).error || `Analysis failed (HTTP ${res.status})`
    )
  }
  return body
}

function EditorFallback() {
  return <Skeleton className="h-[120px] w-full rounded-md" />
}

function AdvisorContent() {
  const hostId = useHostId()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [mode, setMode] = useState<'sql' | 'queryId'>(
    searchParams.get('queryId') ? 'queryId' : 'sql'
  )
  const [sqlInput, setSqlInput] = useState(searchParams.get('query') ?? '')
  const [queryIdInput, setQueryIdInput] = useState(
    searchParams.get('queryId') ?? ''
  )
  const [committed, setCommitted] = useState<
    { mode: 'sql'; sql: string } | { mode: 'queryId'; queryId: string } | null
  >(() => {
    const query = searchParams.get('query')
    const queryId = searchParams.get('queryId')
    if (queryId) return { mode: 'queryId', queryId }
    if (query) return { mode: 'sql', sql: query }
    return null
  })

  const apiUrl = committed
    ? (() => {
        const params = new URLSearchParams()
        params.set('hostId', String(hostId))
        if (committed.mode === 'sql') params.set('sql', committed.sql)
        else params.set('queryId', committed.queryId)
        return `/api/v1/advisor?${params.toString()}`
      })()
    : null

  const { data, error, isLoading, isFetching } = useQuery<AdvisorApiResponse>({
    queryKey: [apiUrl],
    queryFn: () => fetcher(apiUrl as string),
    enabled: Boolean(apiUrl),
  })

  const handleAnalyze = () => {
    if (mode === 'sql') {
      if (!sqlInput.trim()) return
      setCommitted({ mode: 'sql', sql: sqlInput })
      const params = new URLSearchParams(searchParams.toString())
      params.set('query', sqlInput)
      params.delete('queryId')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    } else {
      if (!queryIdInput.trim()) return
      setCommitted({ mode: 'queryId', queryId: queryIdInput })
      const params = new URLSearchParams(searchParams.toString())
      params.set('queryId', queryIdInput)
      params.delete('query')
      router.replace(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }

  const canAnalyze =
    mode === 'sql' ? Boolean(sqlInput.trim()) : Boolean(queryIdInput.trim())

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <WandSparklesIcon className="size-5" />
            Query Advisor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Analyze a slow query and get ranked, recommend-only optimization
            suggestions — skip indexes, projections, partition keys, and
            PREWHERE rewrites. Every DDL/rewrite is text to review and run
            yourself; nothing here is ever applied automatically. Pick a query
            from{' '}
            <a href="/slow-queries" className="underline underline-offset-2">
              Slow Queries
            </a>{' '}
            and copy its query ID, or paste SQL directly.
          </p>

          <Tabs
            value={mode}
            onValueChange={(v) => setMode(v as 'sql' | 'queryId')}
          >
            <TabsList>
              <TabsTrigger value="sql">SQL</TabsTrigger>
              <TabsTrigger value="queryId">Query ID</TabsTrigger>
            </TabsList>

            <TabsContent value="sql" className="space-y-2 pt-2">
              <Suspense fallback={<EditorFallback />}>
                <SqlEditor
                  value={sqlInput}
                  onChange={setSqlInput}
                  onRun={handleAnalyze}
                  placeholder="Enter the slow SELECT query to analyze..."
                />
              </Suspense>
              <p className="text-xs text-muted-foreground">
                Press Cmd/Ctrl + Enter to analyze.
              </p>
            </TabsContent>

            <TabsContent value="queryId" className="space-y-2 pt-2">
              <Label htmlFor="advisor-query-id" className="text-xs">
                query_id from system.query_log
              </Label>
              <Input
                id="advisor-query-id"
                value={queryIdInput}
                onChange={(e) => setQueryIdInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAnalyze()
                }}
                placeholder="e.g. 5f2b1e3a-..."
              />
            </TabsContent>
          </Tabs>

          <div className="flex justify-end">
            <Button onClick={handleAnalyze} disabled={!canAnalyze}>
              Analyze
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading || (isFetching && !data) ? <TableSkeleton rows={4} /> : null}

      {error ? (
        <ErrorAlert
          title="Analysis failed"
          message={error instanceof Error ? error.message : String(error)}
        />
      ) : null}

      {!isLoading && !error && data ? (
        data.recommendations.length === 0 ? (
          <Card>
            <CardContent className="py-8">
              <EmptyState
                variant="no-data"
                title="No recommendations"
                description="This query looks well-tuned for the table's current schema — no skip-index, projection, partition-key, or PREWHERE opportunities were found."
              />
            </CardContent>
          </Card>
        ) : (
          <AdvisorRecommendationsPanel output={data} />
        )
      ) : null}
    </div>
  )
}

function AdvisorPage() {
  return (
    <Suspense fallback={<TableSkeleton rows={3} />}>
      <AdvisorContent />
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/advisor')({
  component: AdvisorPage,
})
