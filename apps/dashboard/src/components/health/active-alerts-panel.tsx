/**
 * Active Alerts panel (plan 29).
 *
 * Lists currently-firing conditions (from `GET /api/v1/health/findings`, a
 * read-only re-derivation of the sweep's rule evaluation) alongside their ACK
 * state (from `GET /api/v1/health/ack`). Each un-acked finding gets a
 * duration picker + "Acknowledge" button that snoozes the health sweep's
 * webhook dispatch for that `(hostId, ruleId)` condition; an active ACK shows
 * who acked it and when it expires, with a "Clear" button to un-ACK early.
 * ACK/snooze is a free, OSS-included capability — no plan gating.
 */
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import type { AckDurationKey, AlertAck } from '@/lib/health/alert-ack-store'
import type { CurrentFinding } from '@/lib/health/current-findings'

import { useAckMutations, useActiveAlerts } from './use-active-alerts'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
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
import { cn } from '@/lib/utils'

const DURATION_OPTIONS: { value: AckDurationKey; label: string }[] = [
  { value: '5m', label: '5 min' },
  { value: '15m', label: '15 min' },
  { value: '60m', label: '1 hour' },
  { value: '240m', label: '4 hours' },
]

const SEVERITY_BADGE_CLASS: Record<CurrentFinding['severity'], string> = {
  critical:
    'border-transparent bg-destructive/15 text-destructive dark:bg-destructive/25',
  warning:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
}

function findAck(
  acks: AlertAck[],
  hostId: number,
  ruleId: string
): AlertAck | undefined {
  const now = Date.now()
  return acks.find(
    (a) => a.hostId === hostId && a.ruleId === ruleId && a.expiresAt > now
  )
}

/** Short forward-relative label ("in 12m", "in 1h") for an ACK's expiry. */
function formatExpiresIn(expiresAt: number): string {
  const ms = expiresAt - Date.now()
  if (ms <= 0) return 'expired'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes}m`
  const hours = Math.round(minutes / 60)
  return `in ${hours}h`
}

function AckControl({
  finding,
  ack,
}: {
  finding: CurrentFinding
  ack: AlertAck | undefined
}) {
  const [duration, setDuration] = useState<AckDurationKey>('15m')
  const { ack: ackMutation, clear: clearMutation } = useAckMutations()

  if (ack) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          Acked by <span className="font-medium">{ack.ackedBy}</span>{' '}
          {formatExpiresIn(ack.expiresAt)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          disabled={clearMutation.isPending}
          onClick={() => {
            clearMutation.mutate(
              { hostId: finding.hostId, ruleId: finding.ruleId },
              {
                onError: () => toast.error('Failed to clear ACK'),
              }
            )
          }}
        >
          Clear
        </Button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Select
        value={duration}
        onValueChange={(v) => setDuration(v as AckDurationKey)}
      >
        <SelectTrigger className="h-7 w-[100px] text-[12px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DURATION_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        disabled={ackMutation.isPending}
        onClick={() => {
          ackMutation.mutate(
            { hostId: finding.hostId, ruleId: finding.ruleId, duration },
            {
              onError: () => toast.error('Failed to acknowledge alert'),
            }
          )
        }}
      >
        Acknowledge
      </Button>
    </div>
  )
}

export function ActiveAlertsPanel() {
  const { findings, acks, isLoading, isFetching, error, refetch } =
    useActiveAlerts()

  let content: React.ReactNode
  if (isLoading) {
    content = (
      <div className="py-8 text-center text-xs text-muted-foreground">
        Loading active alerts…
      </div>
    )
  } else if (error) {
    content = (
      <EmptyState
        variant="error"
        title="Couldn't load active alerts"
        description={error.message}
        onRefresh={refetch}
        compact
      />
    )
  } else if (findings.length === 0) {
    content = (
      <EmptyState
        variant="no-data"
        title="No active alerts"
        description="Every monitored condition is currently healthy."
        compact
      />
    )
  } else {
    content = (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Host</TableHead>
            <TableHead>Rule</TableHead>
            <TableHead>Severity</TableHead>
            <TableHead>Value</TableHead>
            <TableHead>ACK</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {findings.map((finding) => (
            <TableRow key={`${finding.hostId}-${finding.ruleId}`}>
              <TableCell className="text-xs">{finding.hostName}</TableCell>
              <TableCell className="text-xs">{finding.title}</TableCell>
              <TableCell>
                <Badge
                  className={cn(
                    'text-[11px]',
                    SEVERITY_BADGE_CLASS[finding.severity]
                  )}
                >
                  {finding.severity}
                </Badge>
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {finding.label}
              </TableCell>
              <TableCell>
                <AckControl
                  finding={finding}
                  ack={findAck(acks, finding.hostId, finding.ruleId)}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
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
      <div className="max-h-[320px] overflow-y-auto rounded-md border">
        <div className="p-1">{content}</div>
      </div>
    </div>
  )
}
