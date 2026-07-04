import { ClockIcon, ListTreeIcon, TimerIcon, ZapIcon } from 'lucide-react'

import { useState } from 'react'
import { useQueryHistory } from '@/components/sql-console/hooks/use-query-history'
import { Button } from '@/components/ui/button'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { useTableData } from '@/lib/query/use-table-data'

/**
 * What the picker hands back when a query is chosen.
 *
 * - `sql`: full, runnable SQL — used for sources that carry the complete query
 *   text (the browser's recent history and `system.processes` running queries).
 * - `queryId`: only an id — used for slow queries, whose stored `query` column
 *   is truncated to 500 chars (`substr(query, 1, 500)`), so it is not reliably
 *   runnable. The Explain page resolves the full SQL from `system.query_log` by
 *   this id via its normal `query_id` prefill path.
 */
export type QueryPickSelection = { sql: string } | { queryId: string }

interface QueryPickerProps {
  hostId: number
  onSelect: (selection: QueryPickSelection) => void
}

type Row = Record<string, unknown>

/** Collapse whitespace and cap length for a single-line SQL preview. */
function preview(sql: string, max = 140): string {
  const flat = sql.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

function str(v: unknown): string {
  return v == null ? '' : String(v)
}

/** Short relative time from an epoch-ms timestamp, e.g. "3m ago". */
function timeAgo(ts: number): string {
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * One row in the picker. `value` is a unique, searchable string (cmdk lowercases
 * it and filters against it) — but selection reads the closed-over `sql`/`queryId`
 * rather than cmdk's normalized `onSelect` argument, so the real (case-preserving)
 * SQL is never mangled.
 */
function PickItem({
  value,
  icon: Icon,
  text,
  meta,
  onChoose,
}: {
  value: string
  icon: React.ComponentType<{ className?: string }>
  text: string
  meta?: string
  onChoose: () => void
}) {
  return (
    <CommandItem value={value} onSelect={onChoose} className="gap-2">
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px]">
        {text}
      </span>
      {meta && (
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {meta}
        </span>
      )}
    </CommandItem>
  )
}

/**
 * Picker body. Split out so its data hooks only run while the dialog is open
 * (the running/slow queries are fetched lazily, not on page load).
 */
function QueryPickerContent({
  hostId,
  onChoose,
}: {
  hostId: number
  onChoose: (selection: QueryPickSelection) => void
}) {
  const { entries } = useQueryHistory()
  const recent = entries.filter((e) => e.sql.trim()).slice(0, 10)

  const running = useTableData<Row>('running-queries', hostId)
  const slow = useTableData<Row>('slow-queries', hostId)

  const runningRows = (running.data ?? [])
    .filter((r) => str(r.query).trim())
    .slice(0, 10)
  const slowRows = (slow.data ?? [])
    .filter((r) => str(r.query).trim() && str(r.query_id).trim())
    .slice(0, 10)

  const nothing =
    recent.length === 0 &&
    runningRows.length === 0 &&
    slowRows.length === 0 &&
    !running.isLoading &&
    !slow.isLoading

  return (
    <>
      <CommandInput placeholder="Search recent, running, or slow queries…" />
      <CommandList>
        {nothing && <CommandEmpty>No queries found.</CommandEmpty>}

        {recent.length > 0 && (
          <CommandGroup heading="Recent (this browser)">
            {recent.map((e, i) => {
              const p = preview(e.sql)
              return (
                <PickItem
                  key={e.id}
                  value={`recent-${i} ${p}`}
                  icon={ClockIcon}
                  text={p}
                  meta={timeAgo(e.ts)}
                  onChoose={() => onChoose({ sql: e.sql })}
                />
              )
            })}
          </CommandGroup>
        )}

        {runningRows.length > 0 && (
          <CommandGroup heading="Running now">
            {runningRows.map((r, i) => {
              const sql = str(r.query)
              const p = preview(sql)
              const elapsed =
                str(r.readable_elapsed) ||
                (r.elapsed != null ? `${Number(r.elapsed).toFixed(1)}s` : '')
              const user = str(r.user)
              return (
                <PickItem
                  key={`${str(r.query_id)}-${i}`}
                  value={`running-${i} ${p}`}
                  icon={ZapIcon}
                  text={p}
                  meta={[elapsed, user].filter(Boolean).join(' · ')}
                  onChoose={() => onChoose({ sql })}
                />
              )
            })}
          </CommandGroup>
        )}

        {slowRows.length > 0 && (
          <CommandGroup heading="Slowest (last 24h)">
            {slowRows.map((r, i) => {
              const p = preview(str(r.query))
              const dur =
                str(r.readable_query_duration) ||
                (r.query_duration != null
                  ? `${Number(r.query_duration).toFixed(2)}s`
                  : '')
              const user = str(r.user)
              return (
                <PickItem
                  key={`${str(r.query_id)}-${i}`}
                  value={`slow-${i} ${p}`}
                  icon={TimerIcon}
                  text={p}
                  meta={[dur, user].filter(Boolean).join(' · ')}
                  onChoose={() => onChoose({ queryId: str(r.query_id) })}
                />
              )
            })}
          </CommandGroup>
        )}
      </CommandList>
    </>
  )
}

/**
 * "Pick a query" button + command palette for choosing a query to explain,
 * sourced from the browser's recent history, currently-running queries, and the
 * slowest recent queries. Data is fetched lazily when the dialog opens.
 */
export function QueryPicker({ hostId, onSelect }: QueryPickerProps) {
  const [open, setOpen] = useState(false)

  const choose = (selection: QueryPickSelection) => {
    onSelect(selection)
    setOpen(false)
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <ListTreeIcon className="size-3.5" strokeWidth={1.5} />
        Pick a query
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Pick a query to explain"
        description="Choose a recent, running, or slow query to load into the editor."
      >
        {open && <QueryPickerContent hostId={hostId} onChoose={choose} />}
      </CommandDialog>
    </>
  )
}
