/**
 * "Pick a query" dialog for the Query Advisor page.
 *
 * Two ways to seed the advisor input without typing SQL:
 *  - **Quick queries** — the slowest recent SELECTs on the host, one click each.
 *  - **From history** — browse `system.query_log` with keyword / user / kind /
 *    min-duration / time-window filters (all parameterized server-side).
 *
 * Picking a row calls `onPick(sql)` and closes the dialog. Additive only — the
 * advisor's paste/query-id flow is untouched.
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
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  HISTORY_PICKER_KINDS,
  HISTORY_PICKER_MAX_LIMIT,
  type HistoryQueryRow,
  truncateQueryText,
} from '@/lib/ai/advisor/history-picker'
import { DEBOUNCE_DELAY, useDebounce } from '@/lib/hooks/use-debounce'
import { useHostId } from '@/lib/swr'
import { apiFetch } from '@/lib/swr/api-fetch'
import { formatCount, formatDuration } from '@/lib/utils'

interface HistoryApiResponse {
  success: boolean
  data?: HistoryQueryRow[]
  error?: { message?: string }
}
interface UsersApiResponse {
  success: boolean
  data?: string[]
}

const HOUR_OPTIONS = [
  { label: 'Last 1 hour', value: '1' },
  { label: 'Last 6 hours', value: '6' },
  { label: 'Last 24 hours', value: '24' },
  { label: 'Last 7 days', value: '168' },
  { label: 'Last 30 days', value: '720' },
]

const ALL_USERS = '__all__'

async function fetchHistory(url: string): Promise<HistoryQueryRow[]> {
  const res = await apiFetch(url)
  const body = (await res.json()) as HistoryApiResponse
  if (!res.ok || !body.success) {
    throw new Error(
      body.error?.message || `Request failed (HTTP ${res.status})`
    )
  }
  return body.data ?? []
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
  onPick,
  emptyVariant,
}: {
  isLoading: boolean
  error: unknown
  rows: HistoryQueryRow[]
  onPick: (sql: string) => void
  emptyVariant: 'no-data' | 'filtered-empty'
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
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
  if (rows.length === 0) {
    return (
      <EmptyState
        variant={emptyVariant}
        title="No queries found"
        description={
          emptyVariant === 'filtered-empty'
            ? 'No queries match these filters. Try widening the time window or clearing the keyword.'
            : 'No recent SELECT queries were found in system.query_log for this host.'
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

  // History filters
  const [keyword, setKeyword] = useState('')
  const [user, setUser] = useState<string>(ALL_USERS)
  const [kind, setKind] = useState<string>('Select')
  const [minDurationSec, setMinDurationSec] = useState('')
  const [hours, setHours] = useState('24')

  const debouncedKeyword = useDebounce(keyword, DEBOUNCE_DELAY.SLOW)

  const handlePick = (sql: string) => {
    onPick(sql)
    setOpen(false)
  }

  // Quick tab: slowest recent SELECTs.
  const quickUrl = `/api/v1/advisor/history?hostId=${hostId}&hours=24&limit=6`
  const quick = useQuery<HistoryQueryRow[]>({
    queryKey: ['advisor-quick', hostId],
    queryFn: () => fetchHistory(quickUrl),
    enabled: open,
  })

  // History tab: filtered browse.
  const historyUrl = useMemo(() => {
    const params = new URLSearchParams({
      hostId: String(hostId),
      hours,
      kind,
      limit: String(HISTORY_PICKER_MAX_LIMIT),
    })
    if (debouncedKeyword.trim()) params.set('keyword', debouncedKeyword.trim())
    if (user !== ALL_USERS) params.set('user', user)
    const sec = Number(minDurationSec)
    if (Number.isFinite(sec) && sec > 0) {
      params.set('minDurationMs', String(Math.floor(sec * 1000)))
    }
    return `/api/v1/advisor/history?${params.toString()}`
  }, [hostId, hours, kind, debouncedKeyword, user, minDurationSec])

  const history = useQuery<HistoryQueryRow[]>({
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

  const hasHistoryFilters =
    debouncedKeyword.trim() !== '' ||
    user !== ALL_USERS ||
    Number(minDurationSec) > 0

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <ListPlusIcon className="size-4" />
        Pick a query
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Pick a query to analyze</DialogTitle>
          <DialogDescription>
            Start from a quick example or browse your query history. Selecting a
            query loads it into the advisor input.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="quick">
          <TabsList>
            <TabsTrigger value="quick">Quick queries</TabsTrigger>
            <TabsTrigger value="history">From history</TabsTrigger>
          </TabsList>

          <TabsContent value="quick" className="pt-3">
            <p className="mb-3 text-xs text-muted-foreground">
              The slowest SELECT queries on this host in the last 24 hours — the
              best candidates for optimization.
            </p>
            <ScrollArea className="h-[420px] pr-3">
              <ResultsList
                isLoading={quick.isLoading}
                error={quick.error}
                rows={quick.data ?? []}
                onPick={handlePick}
                emptyVariant="no-data"
              />
            </ScrollArea>
          </TabsContent>

          <TabsContent value="history" className="pt-3">
            <div className="space-y-3">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="Search query text (case-insensitive)..."
                  className="pl-8"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label className="text-xs">Time</Label>
                  <Select
                    value={hours}
                    onValueChange={(v) => setHours(v ?? '24')}
                  >
                    <SelectTrigger className="h-8">
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
                    onValueChange={(v) => setUser(v ?? ALL_USERS)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="All users" />
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
                    onValueChange={(v) => setKind(v ?? 'Select')}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {HISTORY_PICKER_KINDS.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
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

              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Showing up to {HISTORY_PICKER_MAX_LIMIT} slowest matches.
                </p>
                {history.data && history.data.length > 0 ? (
                  <Badge variant="secondary" className="text-xs">
                    {history.data.length} result
                    {history.data.length === 1 ? '' : 's'}
                  </Badge>
                ) : null}
              </div>

              <ScrollArea className="h-[300px] pr-3">
                <ResultsList
                  isLoading={history.isLoading}
                  error={history.error}
                  rows={history.data ?? []}
                  onPick={handlePick}
                  emptyVariant={
                    hasHistoryFilters ? 'filtered-empty' : 'no-data'
                  }
                />
              </ScrollArea>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
