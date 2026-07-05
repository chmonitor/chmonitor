import { RefreshCw } from 'lucide-react'

import type { AlertEventRecord } from '@/lib/health/alert-history-store'

import { useAlertHistory } from './use-alert-history'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useHostId } from '@/lib/swr/use-host'
import { isServerHost, useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/format-relative-time'

const ALL_HOSTS_VALUE = 'all'
const HISTORY_LIMIT = 50

/** Badge tint per event severity — 'recovery' reuses the brand's health/live emerald. */
const SEVERITY_BADGE_CLASS: Record<AlertEventRecord['severity'], string> = {
  critical:
    'border-transparent bg-destructive/15 text-destructive dark:bg-destructive/25',
  warning:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  recovery:
    'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
}

/**
 * "Recent alerts" card for the Health Settings dialog — lists dispatched
 * sweep alerts from `GET /api/v1/health/history`, with an optional host/day
 * filter. Persistence is best-effort (see `alert-history-store.ts`): on a
 * deployment without D1 configured (self-hosted/OSS default) this simply
 * shows the "no alerts recorded" empty state rather than an error.
 */
export function RecentAlertsCard() {
  const currentHostId = useHostId()
  const { hosts } = useMergedHosts()
  // Alert history only ever covers env-configured hosts (the sweep reads
  // CLICKHOUSE_* only, never per-user browser/database connections), so
  // offering those in the filter would just always come back empty.
  const serverHosts = useMemo(
    () => hosts.filter((h) => isServerHost(h.source)),
    [hosts]
  )

  const [hostFilter, setHostFilter] = useState<string>(String(currentHostId))
  const [day, setDay] = useState('')

  const hostId = hostFilter === ALL_HOSTS_VALUE ? undefined : Number(hostFilter)

  const { events, isLoading, isFetching, error, refetch } = useAlertHistory({
    hostId,
    day: day || undefined,
    limit: HISTORY_LIMIT,
  })

  let content: React.ReactNode
  if (isLoading) {
    content = (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Loading recent alerts…
      </div>
    )
  } else if (error) {
    content = (
      <EmptyState
        variant="error"
        title="Couldn't load alert history"
        description={error.message}
        onRefresh={refetch}
        compact
      />
    )
  } else if (events.length === 0) {
    content = (
      <EmptyState
        variant="no-data"
        title="No alerts recorded yet"
        description="Dispatched alerts will show up here after the next health sweep."
        compact
      />
    )
  } else {
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Time</TableHead>
            <TableHead>Host</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Delivery</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {events.map((event) => (
            <TableRow
              key={
                event.id ?? `${event.hostId}-${event.rule}-${event.eventTime}`
              }
            >
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                {formatRelativeTime(new Date(event.eventTime).getTime())}
              </TableCell>
              <TableCell className="text-xs">
                {event.hostLabel ?? event.hostId}
              </TableCell>
              <TableCell className="text-xs">{event.rule}</TableCell>
              <TableCell>
                <Badge
                  className={cn(
                    'text-[11px]',
                    SEVERITY_BADGE_CLASS[event.severity]
                  )}
                >
                  {event.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-xs">
                {event.delivered ? (
                  <span className="text-muted-foreground">Delivered</span>
                ) : (
                  <span
                    className="text-destructive"
                    title={event.error ?? undefined}
                  >
                    Failed
                  </span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={hostFilter}
          onValueChange={(value) => {
            if (value != null) setHostFilter(value)
          }}
        >
          <SelectTrigger className="h-8 w-[160px] text-[13px]">
            <SelectValue placeholder="All hosts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_HOSTS_VALUE}>All hosts</SelectItem>
            {serverHosts.map((h) => (
              <SelectItem key={h.id} value={String(h.id)}>
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
          className="h-8 w-[160px] text-[13px]"
          aria-label="Filter by day"
        />
        {day && (
          <Button variant="ghost" size="sm" onClick={() => setDay('')}>
            Clear day
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={refetch}
          disabled={isFetching}
          aria-label="Refresh"
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} />
        </Button>
      </div>

      <ScrollArea className="h-[320px] rounded-md border">
        <div className="p-1">{content}</div>
      </ScrollArea>
    </div>
  )
}
