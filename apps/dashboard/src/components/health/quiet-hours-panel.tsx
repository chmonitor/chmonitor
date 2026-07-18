/**
 * Quiet hours panel (#2662).
 *
 * The recurring sibling of `MaintenanceWindowsPanel`: an operator declares a
 * recurring weekday + time-of-day range (in an IANA timezone) during which the
 * health sweep silences outbound alert delivery. Checks still run and findings
 * are still recorded — only delivery is gated. `severityCap = critical` lets
 * criticals keep paging; catch-up notifications fire for still-active criticals
 * once the window closes. Lives as a tab on the health settings page; every
 * action is an immediate server call (create/delete), same as the maintenance
 * panel. Free/OSS: no Clerk sign-in required.
 */

import { MoonStar } from 'lucide-react'
import { toast } from 'sonner'

import type { QuietHoursInfo } from '@/lib/hooks/use-quiet-hours'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import {
  useQuietHours,
  useQuietHoursMutations,
} from '@/lib/hooks/use-quiet-hours'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

/** Sun-first labels; index is the 0–6 weekday number stored server-side. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** All IANA zones when the runtime supports it, else a small useful fallback. */
function timezoneOptions(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.('timeZone')
    if (supported && supported.length > 0) return supported
  } catch {
    // fall through
  }
  const tz = browserTimezone()
  return [...new Set(['UTC', tz])]
}

function formatDays(days: number[]): string {
  if (days.length === 7) return 'Every day'
  return [...days]
    .sort((a, b) => a - b)
    .map((d) => WEEKDAYS[d])
    .join(', ')
}

function QuietHoursRow({
  window,
  onDeleted,
}: {
  window: QuietHoursInfo
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { deleteWindow } = useQuietHoursMutations()

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteWindow(window.id)
      onDeleted()
    } catch (err) {
      toast.error('Failed to delete quiet-hours window', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{formatDays(window.days)}</Badge>
          <span className="truncate text-sm font-medium">
            {window.start} → {window.end}
          </span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {window.timezone} ·{' '}
          {window.severityCap === 'critical'
            ? 'Criticals still page'
            : 'Silences all alerts'}
        </span>
      </div>
      <Button variant="ghost" size="sm" disabled={busy} onClick={handleDelete}>
        Delete
      </Button>
    </div>
  )
}

function AddQuietHoursForm({ onCreated }: { onCreated: () => void }) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [start, setStart] = useState('22:00')
  const [end, setEnd] = useState('07:00')
  const [timezone, setTimezone] = useState(browserTimezone)
  const [allowCriticals, setAllowCriticals] = useState(true)
  const [busy, setBusy] = useState(false)
  const { createWindow } = useQuietHoursMutations()

  const toggleDay = (day: number) => {
    setDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  const handleSubmit = async () => {
    if (days.length === 0) {
      toast.error('Pick at least one day')
      return
    }
    if (start === end) {
      toast.error('Start and end times must differ')
      return
    }
    setBusy(true)
    try {
      await createWindow({
        days: [...days].sort((a, b) => a - b),
        start,
        end,
        timezone,
        severityCap: allowCriticals ? 'critical' : null,
      })
      toast.success('Quiet hours added')
      onCreated()
    } catch (err) {
      toast.error('Failed to create quiet hours', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3">
      <Label className="text-sm font-medium">Add quiet hours</Label>

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Days</Label>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((label, day) => (
            <button
              key={label}
              type="button"
              onClick={() => toggleDay(day)}
              aria-pressed={days.includes(day)}
              className={cn(
                'h-8 min-w-10 rounded-md border px-2 text-xs font-medium transition-colors',
                days.includes(day)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Start</Label>
          <Input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">End</Label>
          <Input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Timezone</Label>
        <Select
          value={timezone}
          onValueChange={(value) => {
            if (value != null) setTimezone(value)
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-64">
            {timezoneOptions().map((tz) => (
              <SelectItem key={tz} value={tz}>
                {tz}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <Label className="text-sm">Let criticals page</Label>
          <span className="text-xs text-muted-foreground">
            Only warnings are silenced; critical alerts still deliver.
          </span>
        </div>
        <Switch checked={allowCriticals} onCheckedChange={setAllowCriticals} />
      </div>

      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={handleSubmit}
      >
        Add
      </Button>
    </div>
  )
}

export function QuietHoursPanel({ className }: { className?: string }) {
  const { windows, isLoading, refetch } = useQuietHours()

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        On the chosen days and time range, the health sweep still runs every
        check and records findings — it only silences the outbound alert. Set
        “Let criticals page” to keep critical alerts flowing; still-active
        criticals get a catch-up notification when the window ends.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && windows.length === 0 && (
        <EmptyState
          compact
          icon={
            <MoonStar
              className="h-10 w-10 text-muted-foreground/60"
              strokeWidth={1.5}
            />
          }
          title="No quiet hours"
          description="Add a recurring window to silence non-critical alerts overnight or on weekends."
        />
      )}

      {windows.length > 0 && (
        <div className="flex flex-col gap-2">
          {windows.map((w) => (
            <QuietHoursRow key={w.id} window={w} onDeleted={refetch} />
          ))}
        </div>
      )}

      <AddQuietHoursForm onCreated={refetch} />
    </div>
  )
}
