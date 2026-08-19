/**
 * "Pick a query" dialog for the Query Advisor page.
 *
 * Two ways to seed the advisor input without typing SQL:
 *  - **Quick queries** — the slowest recent SELECTs on the host, one click each.
 *  - **From history** — browse `system.query_log` with keyword / user / kind /
 *    min-duration / time-window filters (all parameterized server-side).
 *
 * Picking a row calls `onPick(sql)` and closes the dialog. Additive only — the
 * advisor's paste/query-id flow is untouched. Recommend-only: never runs DDL.
 */

import { ClockIcon, DatabaseIcon, ListPlusIcon, SearchIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  HISTORY_PICKER_KIND_ALL,
  HISTORY_PICKER_KIND_OPTIONS,
  HISTORY_PICKER_MAX_LIMIT,
  type HistoryQueryRow,
  truncateQueryText,
} from '@/lib/ai/advisor/history-picker'
import { DEBOUNCE_DELAY, useDebounce } from '@/lib/hooks/use-debounce'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { formatCount, formatDuration } from '@/lib/utils'

interface UnavailableMeta {
  reason: string
  message: string
}

interface HistoryApiResponse {
  success: boolean
  data?: HistoryQueryRow[]
  error?: { message?: string }
  metadata?: { unavailable?: UnavailableMeta }
}
interface UsersApiResponse {
  success: boolean
  data?: string[]
}

interface HistoryFetchResult {
  rows: HistoryQueryRow[]
  unavailable?: UnavailableMeta
}

const HOUR_OPTIONS = [
  { label: 'Last 1 hour', value: '1' },
  { label: 'Last 6 hours', value: '6' },
  { label: 'Last 24 hours', value: '24' },
  { label: 'Last 7 days', value: '168' },
  { label: 'Last 30 days', value: '720' },
] as const

const HOUR_ITEMS: Record<string, string> = Object.fromEntries(
  HOUR_OPTIONS.map((o) => [o.value, o.label])
)

const KIND_ITEMS: Record<string, string> = Object.fromEntries(
  HISTORY_PICKER_KIND_OPTIONS.map((o) => [o.value, o.label])
)

const ALL_USERS = '__all__'

async function fetchHistory(url: string): Promise<HistoryFetchResult> {
  const res = await apiFetch(url)
  const body = (await res.json()) as HistoryApiResponse
  if (!res.ok || !body.success) {
    throw new Error(
      body.error?.message || `Request failed (HTTP ${res.status})`
    )
  }
  return {
    rows: body.data ?? [],
    unavailable: body.metadata?.unavailable,
  }
}

function QueryRowButton({
  row,
  onPick,
}: {
  row: HistoryQueryRow
  onPick: (sql: string) => void
}) {
  return (
    <button
      type="button"
      data-testid="advisor-query-row"
      onClick={() => onPick(row.query)}
      className="w-full rounded-md border border-border/60 bg-card p-3 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <code className="block truncate font-mono text-xs text-foreground">
        {truncateQueryText(row.query, 160)}
      </code>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ClockIcon className="size-3" />
          {formatDuration(Number(row.query_duration_ms) || 0)}
        </span>
        <span className="inline-flex items-center gap-1">
          <DatabaseIcon className="size-3" />
          {formatCount(Number(row.read_rows) || 0)} rows read
        </span>
        {row.user ? <span>{row.user}</span> : null}
        {row.event_time ? (
          <span className="ml-auto tabular-nums">{row.event_time}</span>
        ) : null}
      </div>
    </button>
  )
}

function ResultsList({
  isLoading,
  error,
  rows,
  unavailable,
  onPick,
  emptyVariant,
  includeSelf,
}: {
  isLoading: boolean
  error: unknown
  rows: HistoryQueryRow[]
  unavailable?: UnavailableMeta
  onPick: (sql: string) => void
  emptyVariant: 'no-data' | 'filtered-empty'
  includeSelf: boolean
}) {
  if (isLoading) {
    return (
      <div className="space-y-2" data-testid="advisor-query-picker-loading">
        {['s0', 's1', 's2', 's3', 's4'].map((k) => (
          <Skeleton key={k} className="h-16 w-full rounded-md" />
        ))}
      </div>
    )
  }
  if (error) {
    return (
      <EmptyState
        variant="error"
        title="Couldn't load queries"
        description={error instanceof Error ? error.message : String(error)}
      />
    )
  }
  if (unavailable?.reason === 'demo_hidden') {
    return (
      <EmptyState
        variant="no-data"
        title="Demo host is hidden"
        description={
          unavailable.message ||
          'The demo host is hidden for signed-in accounts. Connect your own host to browse query history.'
        }
      />
    )
  }
  if (rows.length === 0) {
    const includeHint = includeSelf
      ? ''
      : ' Turn on “Include dashboard queries” if you want those rows too.'
    return (
      <EmptyState
        variant={emptyVariant}
        title="No queries found"
        description={
          emptyVariant === 'filtered-empty'
            ? `No queries match these filters. Try All kinds, a wider time window, or clearing the keyword.${includeHint}`
            : `No recent queries were found in system.query_log for this host.${includeHint}`
        }
      />
    )
  }
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <QueryRowButton key={row.query_id} row={row} onPick={onPick} />
      ))}
    </div>
  )
}

export function AdvisorQueryPicker({
  onPick,
}: {
  onPick: (sql: string) => void
}) {
  const hostId = useHostId()
  const [open, setOpen] = useState(false)

  const [keyword, setKeyword] = useState('')
  const [user, setUser] = useState<string>(ALL_USERS)
  const [kind, setKind] = useState<string>(HISTORY_PICKER_KIND_ALL)
  const [minDurationSec, setMinDurationSec] = useState('')
  const [hours, setHours] = useState('24')
  const [includeSelf, setIncludeSelf] = useState(false)

  const debouncedKeyword = useDebounce(keyword, DEBOUNCE_DELAY.SLOW)

  const handlePick = (sql: string) => {
    onPick(sql)
    setOpen(false)
  }

  const includeSelfParam = includeSelf ? '&includeSelf=1' : ''

  const quickUrl = `/api/v1/advisor/history?hostId=${hostId}&hours=24&limit=6&kind=Select${includeSelfParam}`
  const quick = useQuery<HistoryFetchResult>({
    queryKey: ['advisor-quick', hostId, includeSelf],
    queryFn: () => fetchHistory(quickUrl),
    enabled: open,
  })

  const historyUrl = useMemo(() => {
    const params = new URLSearchParams({
      hostId: String(hostId),
      hours,
      limit: String(HISTORY_PICKER_MAX_LIMIT),
    })
    if (kind && kind !== HISTORY_PICKER_KIND_ALL) params.set('kind', kind)
    if (debouncedKeyword.trim()) params.set('keyword', debouncedKeyword.trim())
    if (user !== ALL_USERS) params.set('user', user)
    if (includeSelf) params.set('includeSelf', '1')
    const sec = Number(minDurationSec)
    if (Number.isFinite(sec) && sec > 0) {
      params.set('minDurationMs', String(Math.floor(sec * 1000)))
    }
    return `/api/v1/advisor/history?${params.toString()}`
  }, [hostId, hours, kind, debouncedKeyword, user, minDurationSec, includeSelf])

  const history = useQuery<HistoryFetchResult>({
    queryKey: ['advisor-history', historyUrl],
    queryFn: () => fetchHistory(historyUrl),
    enabled: open,
  })

  const users = useQuery<string[]>({
    queryKey: ['advisor-history-users', hostId],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/v1/advisor/history?hostId=${hostId}&facet=users`
      )
      const body = (await res.json()) as UsersApiResponse
      return body.success ? (body.data ?? []) : []
    },
    enabled: open,
  })

  const userItems = useMemo(() => {
    const items: Record<string, string> = { [ALL_USERS]: 'All users' }
    for (const u of users.data ?? []) {
      items[u] = u
    }
    return items
  }, [users.data])

  const hasHistoryFilters =
    debouncedKeyword.trim() !== '' ||
    user !== ALL_USERS ||
    kind !== HISTORY_PICKER_KIND_ALL ||
    Number(minDurationSec) > 0

  const historyRows = history.data?.rows ?? []
  const quickRows = quick.data?.rows ?? []

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            data-testid="advisor-query-picker-trigger"
          />
        }
      >
        <ListPlusIcon className="size-4" />
        Pick a query
      </DialogTrigger>
      <DialogContent
        className="flex h-[min(36rem,85vh)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl border bg-card p-0 sm:max-w-2xl"
        data-testid="advisor-query-picker-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle>Pick a query to analyze</DialogTitle>
          <DialogDescription>
            Start from a quick example or browse query history. Selecting a
            query loads it and runs analysis.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          defaultValue="quick"
          className="flex min-h-0 flex-1 flex-col gap-0 px-4 pb-4"
        >
          <TabsList className="mt-3 shrink-0">
            <TabsTrigger value="quick">Quick queries</TabsTrigger>
            <TabsTrigger
              value="history"
              data-testid="advisor-query-picker-tab-history"
            >
              From history
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="quick"
            className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3"
          >
            <p className="mb-3 shrink-0 text-xs text-muted-foreground">
              The slowest SELECT queries on this host in the last 24 hours — the
              best candidates for optimization.
            </p>
            <div
              className="min-h-0 flex-1 overflow-y-auto"
              data-testid="advisor-query-picker-list"
            >
              <ResultsList
                isLoading={quick.isLoading}
                error={quick.error}
                rows={quickRows}
                unavailable={quick.data?.unavailable}
                onPick={handlePick}
                emptyVariant="no-data"
                includeSelf={includeSelf}
              />
            </div>
          </TabsContent>

          <TabsContent
            value="history"
            className="flex min-h-0 flex-1 flex-col overflow-hidden pt-3"
          >
            <div className="shrink-0 space-y-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Search query text (case-insensitive)..."
                  className="pl-8"
                />
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Time</Label>
                  <Select
                    value={hours}
                    items={HOUR_ITEMS}
                    onValueChange={(v) => {
                      if (v != null) setHours(v)
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-full"
                      data-testid="advisor-query-picker-hours"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HOUR_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">User</Label>
                  <Select
                    value={user}
                    items={userItems}
                    onValueChange={(v) => {
                      if (v != null) setUser(v)
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-full"
                      data-testid="advisor-query-picker-user"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_USERS}>All users</SelectItem>
                      {(users.data ?? []).map((u) => (
                        <SelectItem key={u} value={u}>
                          {u}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Kind</Label>
                  <Select
                    value={kind}
                    items={KIND_ITEMS}
                    onValueChange={(v) => {
                      if (v != null) setKind(v)
                    }}
                  >
                    <SelectTrigger
                      className="h-8 w-full"
                      data-testid="advisor-query-picker-kind"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HISTORY_PICKER_KIND_OPTIONS.map((k) => (
                        <SelectItem key={k.value} value={k.value}>
                          {k.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Min duration (s)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={minDurationSec}
                    onChange={(e) => setMinDurationSec(e.target.value)}
                    placeholder="0"
                    className="h-8"
                  />
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Switch
                  checked={includeSelf}
                  onCheckedChange={(checked) => setIncludeSelf(checked)}
                  aria-label="Include dashboard queries"
                  data-testid="advisor-query-picker-include-self"
                />
                <span>Include dashboard queries</span>
              </label>

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing up to {HISTORY_PICKER_MAX_LIMIT} slowest matches.
                </p>
                {historyRows.length > 0 ? (
                  <Badge variant="secondary" className="text-xs">
                    {historyRows.length} result
                    {historyRows.length === 1 ? '' : 's'}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div
              className="mt-3 min-h-0 flex-1 overflow-y-auto"
              data-testid="advisor-query-picker-history-list"
            >
              <ResultsList
                isLoading={history.isLoading}
                error={history.error}
                rows={historyRows}
                unavailable={history.data?.unavailable}
                onPick={handlePick}
                emptyVariant={hasHistoryFilters ? 'filtered-empty' : 'no-data'}
                includeSelf={includeSelf}
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
