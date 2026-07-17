import { Loader2, Pin, PinOff, Play, Trash2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import type { ApiResponse } from '@/lib/api/types'
import type { QueryHistoryEntry } from './hooks/use-query-history'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface ServerHistoryRow {
  query_id: string
  query: string
  event_time: string
  query_duration_ms: number
  read_rows: number
}

const SERVER_HISTORY_SQL = `
  SELECT query_id, query, event_time, query_duration_ms, read_rows
  FROM system.query_log
  WHERE type = 'QueryFinish'
    AND is_initial_query
    AND query_kind = 'Select'
    AND query NOT ILIKE '%system.query_log%'
  ORDER BY event_time DESC
  LIMIT 50
`

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function QueryLine({ sql }: { sql: string }) {
  const oneLine = sql.replace(/\s+/g, ' ').trim()
  return (
    <code className="line-clamp-2 break-words font-mono text-xs leading-snug">
      {oneLine}
    </code>
  )
}

function useServerHistory(hostId: number, enabled: boolean) {
  return useQuery<ServerHistoryRow[], Error>({
    queryKey: ['sql-console:server-history', hostId],
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const params = new URLSearchParams({
        hostId: String(hostId),
        sql: SERVER_HISTORY_SQL,
        format: 'JSONEachRow',
      })
      const res = await apiFetch(`/api/v1/explorer/query?${params.toString()}`)
      const json = (await res.json()) as ApiResponse<ServerHistoryRow[]>
      if (!json.success) throw new Error(json.error?.message ?? 'Failed')
      return json.data ?? []
    },
  })
}

export function QueryHistoryPanel({
  hostId,
  entries,
  onSelect,
  onRemove,
  onTogglePin,
  onClear,
  serverEnabled,
}: {
  hostId: number
  entries: QueryHistoryEntry[]
  onSelect: (sql: string, run?: boolean) => void
  onRemove: (id: string) => void
  onTogglePin: (id: string) => void
  onClear: () => void
  /** Whether the Server tab is mounted (so it only queries when viewed). */
  serverEnabled: boolean
}) {
  const server = useServerHistory(hostId, serverEnabled)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)

  return (
    <Tabs defaultValue="mine" className="flex h-full flex-col">
      <TabsList className="mx-1 mt-1">
        <TabsTrigger value="mine">Mine</TabsTrigger>
        <TabsTrigger value="server">Server</TabsTrigger>
      </TabsList>

      <TabsContent value="mine" className="min-h-0 flex-1">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-muted-foreground text-xs">
            {entries.length} saved locally
          </span>
          {entries.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setConfirmClearOpen(true)}
            >
              <Trash2 className="mr-1 size-3" /> Clear
            </Button>
          )}
        </div>

        <Dialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Clear query history?</DialogTitle>
              <DialogDescription>
                This removes all unpinned queries from your local history.
                Pinned queries are kept. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmClearOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  onClear()
                  setConfirmClearOpen(false)
                }}
              >
                Clear history
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <ScrollArea className="h-[calc(100%-2.5rem)]">
          <ul className="space-y-1 px-2 pb-4">
            {entries.length === 0 && (
              <li className="text-muted-foreground p-4 text-center text-sm">
                No history yet. Queries you run appear here.
              </li>
            )}
            {entries.map((e) => (
              <li
                key={e.id}
                className={cn(
                  'group hover:bg-muted/60 rounded-md border p-2 transition-colors',
                  e.pinned && 'border-primary/40'
                )}
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => onSelect(e.sql, false)}
                  title="Load into editor"
                >
                  <QueryLine sql={e.sql} />
                </button>
                <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-[11px]">
                  <span>
                    {relTime(e.ts)}
                    {e.rows !== undefined &&
                      ` · ${e.rows.toLocaleString()} rows`}
                    {!e.ok && ' · failed'}
                  </span>
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Run"
                      aria-label="Run"
                      onClick={() => onSelect(e.sql, true)}
                    >
                      <Play className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title={e.pinned ? 'Unpin' : 'Pin'}
                      aria-label={e.pinned ? 'Unpin' : 'Pin'}
                      onClick={() => onTogglePin(e.id)}
                    >
                      {e.pinned ? (
                        <PinOff className="size-3" />
                      ) : (
                        <Pin className="size-3" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Remove"
                      aria-label="Remove"
                      onClick={() => onRemove(e.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </TabsContent>

      <TabsContent value="server" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <ul className="space-y-1 px-2 py-2 pb-4">
            {server.isFetching && !server.data && (
              <li className="text-muted-foreground flex items-center justify-center gap-2 p-4 text-sm">
                <Loader2 className="size-4 animate-spin" /> Loading…
              </li>
            )}
            {server.error && (
              <li className="text-destructive p-4 text-center text-xs">
                {server.error.message}
              </li>
            )}
            {server.data?.length === 0 && (
              <li className="text-muted-foreground p-4 text-center text-sm">
                No recent SELECT queries in system.query_log.
              </li>
            )}
            {server.data?.map((r) => (
              <li
                key={r.query_id}
                className="group hover:bg-muted/60 rounded-md border p-2"
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => onSelect(r.query, false)}
                  title="Load into editor"
                >
                  <QueryLine sql={r.query} />
                </button>
                <div className="text-muted-foreground mt-1.5 flex items-center justify-between text-[11px]">
                  <span>
                    {r.query_duration_ms} ms ·{' '}
                    {Number(r.read_rows).toLocaleString()} rows
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6 opacity-0 transition-opacity group-hover:opacity-100"
                    title="Run"
                    aria-label="Run"
                    onClick={() => onSelect(r.query, true)}
                  >
                    <Play className="size-3" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  )
}
