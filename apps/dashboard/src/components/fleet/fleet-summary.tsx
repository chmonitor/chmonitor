import { AlertTriangle } from 'lucide-react'

import type { MergedHostInfo } from '@/lib/swr/use-merged-hosts'
import type { FleetSummaryEntry } from './fleet-helpers'

import { computeFleetSummary, formatCount } from './fleet-helpers'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useHostStatus } from '@/lib/swr/use-host-status'
import { cn } from '@/lib/utils'

/**
 * Invisible per-host probe. It calls the SAME `useHostStatus(id, { fleet: true })`
 * query as the host card / table row, so TanStack Query serves all three from
 * one request per host — this adds no extra polling. Keeping the hook here
 * (rather than lifting host fetching into the summary) preserves the
 * hooks-at-deepest-consumer rule: one slow host never blocks the others.
 */
function HostStatusProbe({
  host,
  onReport,
}: {
  host: MergedHostInfo
  onReport: (key: string, entry: FleetSummaryEntry) => void
}) {
  const isBrowser = host.id < 0
  const {
    data: status,
    isLoading,
    isOnline,
  } = useHostStatus(isBrowser ? null : host.id, { fleet: true })

  const key = `${host.source}-${host.id}`
  const state: FleetSummaryEntry['state'] = isBrowser
    ? 'unknown'
    : isLoading
      ? 'loading'
      : isOnline
        ? 'online'
        : 'offline'

  const version = status?.version || undefined
  const runningQueries = status?.runningQueries
  const databases = status?.databases
  const tables = status?.tables

  // Report after commit (never during render — that would update the parent
  // while this child renders). The parent stores by key and ignores an
  // unchanged report, so this settles immediately.
  useEffect(() => {
    onReport(key, { state, version, runningQueries, databases, tables })
  }, [onReport, key, state, version, runningQueries, databases, tables])

  return null
}

/** Single compact stat tile. Deliberately lighter than a ChartCard. */
function StatTile({
  label,
  value,
  hint,
  warn,
}: {
  label: string
  value: string
  hint?: string
  warn?: boolean
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-lg font-semibold tabular-nums leading-tight tracking-tight',
          warn && 'text-amber-600 dark:text-amber-500'
        )}
      >
        {value}
      </p>
      {hint ? (
        <p
          className={cn(
            'flex items-center gap-1 truncate text-xs text-muted-foreground',
            warn && 'text-amber-600 dark:text-amber-500'
          )}
        >
          {warn ? (
            <AlertTriangle className="size-3 shrink-0" strokeWidth={1.5} />
          ) : null}
          {hint}
        </p>
      ) : null}
    </div>
  )
}

interface FleetSummaryStripProps {
  hosts: readonly MergedHostInfo[]
}

/**
 * Fleet-wide stat tiles shown above both the card grid and the table: host
 * counts, ClickHouse version spread (flagging drift), and summed running
 * queries / databases / tables across every reachable host.
 */
export function FleetSummaryStrip({ hosts }: FleetSummaryStripProps) {
  const [entries, setEntries] = useState<Record<string, FleetSummaryEntry>>({})

  const handleReport = useCallback((key: string, entry: FleetSummaryEntry) => {
    setEntries((prev) => {
      const current = prev[key]
      if (
        current &&
        current.state === entry.state &&
        current.version === entry.version &&
        current.runningQueries === entry.runningQueries &&
        current.databases === entry.databases &&
        current.tables === entry.tables
      ) {
        return prev
      }
      return { ...prev, [key]: entry }
    })
  }, [])

  const summary = useMemo(() => {
    const keys = hosts.map((h) => `${h.source}-${h.id}`)
    return computeFleetSummary(
      keys.map((key) => entries[key] ?? { state: 'loading' })
    )
  }, [hosts, entries])

  if (hosts.length === 0) return null

  const versionHint = summary.versionDrift
    ? `${summary.versions.length} versions in use`
    : (summary.versions[0] ?? 'not reported')

  return (
    <>
      {hosts.map((host) => (
        <HostStatusProbe
          key={`probe-${host.source}-${host.id}`}
          host={host}
          onReport={handleReport}
        />
      ))}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Hosts" value={formatCount(summary.total)} />
        <StatTile
          label="Online"
          value={`${summary.online} / ${summary.total}`}
          hint={summary.offline > 0 ? `${summary.offline} offline` : undefined}
          warn={summary.offline > 0}
        />
        <StatTile
          label="Versions"
          value={formatCount(summary.versions.length)}
          hint={versionHint}
          warn={summary.versionDrift}
        />
        <StatTile
          label="Running queries"
          value={formatCount(summary.runningQueries)}
        />
        <StatTile
          label="Databases / tables"
          value={`${formatCount(summary.databases)} / ${formatCount(summary.tables)}`}
        />
      </div>
    </>
  )
}
