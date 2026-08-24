import { useQuery } from '@tanstack/react-query'
import {
  createFileRoute,
  useLocation,
  useNavigate,
} from '@tanstack/react-router'

import type { AdvisorRecommendationsOutput } from '@/components/agents/advisor-recommendations-panel'

import {
  type AdvisorErrorCode,
  findAdvisorTargetTable,
} from '@chm/query-advisor-core'
import { lazy, Suspense, useState } from 'react'
import { AdvisorQueryPicker } from '@/components/agents/advisor-query-picker'
import { AdvisorRecommendationsPanel } from '@/components/agents/advisor-recommendations-panel'
import { AdvisorSchemaTab } from '@/components/agents/advisor-schema-tab'
import { ErrorAlert } from '@/components/feedback'
import { TableSkeleton } from '@/components/skeletons'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { ADVISOR_TABS, resolveAdvisorTab } from '@/lib/ai/advisor/advisor-tabs'
import {
  advisorUserInputCopy,
  isAdvisorUserInputError,
} from '@/lib/ai/advisor/empty-copy'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useFeatureTracking } from '@/lib/telemetry'
import { splitHref } from '@/lib/url/url-builder'

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
  code?: AdvisorErrorCode
}

class AdvisorClientError extends Error {
  code?: AdvisorErrorCode
  constructor(message: string, code?: AdvisorErrorCode) {
    super(message)
    this.name = 'AdvisorClientError'
    this.code = code
  }
}

const fetcher = async (url: string): Promise<AdvisorApiResponse> => {
  const res = await apiFetch(url)
  const body = (await res.json()) as AdvisorApiResponse | AdvisorApiError
  if (!res.ok || !body.success) {
    const err = body as AdvisorApiError
    throw new AdvisorClientError(
      err.error || `Analysis failed (HTTP ${res.status})`,
      err.code
    )
  }
  return body
}

function EditorFallback() {
  return <Skeleton className="h-[120px] w-full rounded-md" />
}

function advisorErrorCode(error: unknown): AdvisorErrorCode | undefined {
  return error instanceof AdvisorClientError ? error.code : undefined
}

function AdvisorResult({
  committed,
  data,
  error,
  isLoading,
}: {
  committed: { mode: 'sql'; sql: string } | { mode: 'queryId'; queryId: string }
  data: AdvisorApiResponse | undefined
  error: unknown
  isLoading: boolean
}) {
  const localTableCheck =
    committed.mode === 'sql' ? findAdvisorTargetTable(committed.sql) : null
  const localCode =
    localTableCheck && !localTableCheck.ok ? localTableCheck.code : undefined
  const remoteCode = advisorErrorCode(error)
  const code = localCode ?? remoteCode
  const message =
    localTableCheck && !localTableCheck.ok
      ? localTableCheck.error
      : error instanceof Error
        ? error.message
        : String(error ?? '')

  if (isLoading) return <TableSkeleton rows={4} />

  if (isAdvisorUserInputError(code)) {
    const copy = advisorUserInputCopy(code, message)
    return (
      <div
        className="rounded-xl border border-dashed bg-card/40 px-6 py-10"
        data-testid="advisor-user-input-empty"
      >
        <EmptyState
          variant="no-results"
          title={copy.title}
          description={copy.description}
        />
      </div>
    )
  }

  if (error) {
    return (
      <ErrorAlert
        title="Analysis failed"
        message={error instanceof Error ? error.message : String(error)}
      />
    )
  }

  if (!data) return null

  if (data.recommendations.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-card/40 px-6 py-10">
        <EmptyState
          variant="no-data"
          title="No recommendations"
          description="This query looks well-tuned for the table's current schema — no skip-index, projection, partition-key, or PREWHERE opportunities were found."
        />
      </div>
    )
  }

  return <AdvisorRecommendationsPanel output={data} />
}

function AdvisorContent() {
  const hostId = useHostId()
  useFeatureTracking('advisor')
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()

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

  const skipFetch =
    committed?.mode === 'sql' && !findAdvisorTargetTable(committed.sql).ok

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
    enabled: Boolean(apiUrl) && !skipFetch,
  })

  const commitSql = (sql: string) => {
    setCommitted({ mode: 'sql', sql })
    const params = new URLSearchParams(searchParams.toString())
    params.set('query', sql)
    params.delete('queryId')
    navigate({
      ...splitHref(`${pathname}?${params.toString()}`),
      replace: true,
    })
  }

  const handleAnalyze = () => {
    if (mode === 'sql') {
      if (!sqlInput.trim()) return
      commitSql(sqlInput)
      return
    }
    if (!queryIdInput.trim()) return
    setCommitted({ mode: 'queryId', queryId: queryIdInput })
    const params = new URLSearchParams(searchParams.toString())
    params.set('queryId', queryIdInput)
    params.delete('query')
    navigate({
      ...splitHref(`${pathname}?${params.toString()}`),
      replace: true,
    })
  }

  const handlePickQuery = (sql: string) => {
    setMode('sql')
    setSqlInput(sql)
    commitSql(sql)
  }

  const canAnalyze =
    mode === 'sql' ? Boolean(sqlInput.trim()) : Boolean(queryIdInput.trim())
  const analyzing = Boolean(apiUrl) && !skipFetch && (isLoading || isFetching)

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Ranked skip-index, projection, partition-key, and PREWHERE suggestions
        for a slow query. Recommend-only — nothing is applied for you.
      </p>

      <Tabs value={mode} onValueChange={(v) => setMode(v as 'sql' | 'queryId')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="sql">SQL</TabsTrigger>
            <TabsTrigger value="queryId">Query ID</TabsTrigger>
          </TabsList>
          <AdvisorQueryPicker onPick={handlePickQuery} />
        </div>

        <TabsContent value="sql" className="space-y-2 pt-2">
          <Suspense fallback={<EditorFallback />}>
            <SqlEditor
              value={sqlInput}
              onChange={setSqlInput}
              onRun={handleAnalyze}
              placeholder="SELECT … FROM events WHERE …"
            />
          </Suspense>
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
            placeholder="e.g. 5f2b1e3a-…"
          />
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {mode === 'sql'
            ? 'Press Cmd/Ctrl + Enter to analyze.'
            : 'Press Enter to analyze.'}
        </p>
        <Button onClick={handleAnalyze} disabled={!canAnalyze || analyzing}>
          {analyzing ? 'Analyzing…' : 'Analyze'}
        </Button>
      </div>

      {committed ? (
        <AdvisorResult
          committed={committed}
          data={data}
          error={skipFetch ? undefined : error}
          isLoading={analyzing && !data}
        />
      ) : (
        <div className="rounded-xl border border-dashed bg-card/40 px-6 py-10">
          <EmptyState
            variant="no-data"
            title="Nothing to analyze yet"
            description="Paste a SELECT that reads a table, pick a slow query, or look up a query_id — then press Analyze."
          />
        </div>
      )}
    </div>
  )
}

function AdvisorPage() {
  const navigate = useNavigate()
  const pathname = useLocation({ select: (l) => l.pathname })
  const searchParams = useUrlSearchParams()
  const tab = resolveAdvisorTab({
    view: searchParams.get('view'),
    query: searchParams.get('query'),
    queryId: searchParams.get('queryId'),
  })

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', value)
    navigate({
      ...splitHref(`${pathname}?${params.toString()}`),
      replace: true,
    })
  }

  return (
    <Suspense fallback={<TableSkeleton rows={3} />}>
      <Tabs value={tab} onValueChange={setTab} className="flex flex-col gap-4">
        <TabsList>
          {ADVISOR_TABS.map((item) => (
            <TabsTrigger key={item.value} value={item.value}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="schema" className="mt-0">
          <AdvisorSchemaTab />
        </TabsContent>
        <TabsContent value="query" className="mt-0">
          <AdvisorContent />
        </TabsContent>
      </Tabs>
    </Suspense>
  )
}

export const Route = createFileRoute('/(dashboard)/advisor')({
  component: AdvisorPage,
})
