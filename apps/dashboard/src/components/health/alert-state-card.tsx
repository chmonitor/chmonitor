import { RefreshCw } from 'lucide-react'

import type { AlertRuleSeverity } from '@/lib/alerting/rule-registry'
import type { AlertStateRow } from '@/lib/health/alert-state-persist'

import { HEALTH_CHECKS } from './health-checks'
import { useAlertState } from './use-alert-state'
import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useHostId } from '@/lib/swr/use-host'
import { cn, formatDuration } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils/format-relative-time'

/** Badge tint per confirmed state — 'ok' reuses the brand's health emerald. */
const STATE_BADGE_CLASS: Record<AlertRuleSeverity, string> = {
  ok: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  warning:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  critical:
    'border-transparent bg-destructive/15 text-destructive dark:bg-destructive/25',
}

const STATE_LABEL: Record<AlertRuleSeverity, string> = {
  ok: 'OK',
  warning: 'Warning',
  critical: 'Critical',
}

function checkTitle(ruleId: string): string {
  const match = HEALTH_CHECKS.find((c) => c.id === ruleId)
  return match?.title ?? ruleId
}

function StateRow({ row, now }: { row: AlertStateRow; now: number }) {
  const firing = row.severity !== 'ok'
  return (
    <TableRow>
      <TableCell className="font-medium">{checkTitle(row.ruleId)}</TableCell>
      <TableCell>
        <Badge className={cn('font-normal', STATE_BADGE_CLASS[row.severity])}>
          {STATE_LABEL[row.severity]}
        </Badge>
        {row.pendingSeverity && row.pendingSeverity !== row.severity && (
          <span className="ml-2 text-xs text-muted-foreground">
            {/* An in-flight hysteresis streak awaiting confirmation. */}
            {row.pendingSeverity === 'ok' ? 'clearing' : 'rising'} (
            {row.pendingCount ?? 1})
          </span>
        )}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {formatRelativeTime(row.updatedAt)}
      </TableCell>
      <TableCell className="text-muted-foreground">
        {firing && row.firstFiredAt !== undefined
          ? formatDuration(now - row.firstFiredAt)
          : '—'}
      </TableCell>
    </TableRow>
  )
}

/**
 * "Current alert state" card (#2767) — the health sweep's persisted last-known
 * state per check for the currently-selected host: confirmed severity, when it
 * last transitioned, any in-flight hysteresis streak, and (for a firing
 * condition) how long the incident has been open. Best-effort: on a deployment
 * without D1 configured (self-hosted/OSS default) this shows the empty state.
 */
export function AlertStateCard() {
  const hostId = useHostId()
  const { states, isLoading, isFetching, error, refetch } =
    useAlertState(hostId)
  const now = Date.now()

  // Firing conditions first, then most-recently-transitioned.
  const sorted = useMemo(
    () =>
      [...states].sort((a, b) => {
        const af = a.severity === 'ok' ? 0 : 1
        const bf = b.severity === 'ok' ? 0 : 1
        if (af !== bf) return bf - af
        return b.updatedAt - a.updatedAt
      }),
    [states]
  )

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-medium text-sm">Current alert state</h3>
          <p className="text-muted-foreground text-xs">
            Last-known state and transition per check, with hysteresis damping.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={refetch}
          disabled={isFetching}
        >
          <RefreshCw className={cn('size-4', isFetching && 'animate-spin')} />
        </Button>
      </div>

      {error ? (
        <EmptyState
          title="Couldn't load alert state"
          description={error.message}
        />
      ) : isLoading ? (
        <EmptyState title="Loading…" description="Fetching current state." />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="No tracked state yet"
          description="Once the health sweep runs (and D1 is configured) each check's current state and last transition appear here."
        />
      ) : (
        <ScrollArea className="max-h-80">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Check</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Last transition</TableHead>
                <TableHead>Firing for</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <StateRow
                  key={`${row.hostId}:${row.ruleId}`}
                  row={row}
                  now={now}
                />
              ))}
            </TableBody>
          </Table>
        </ScrollArea>
      )}
    </div>
  )
}
