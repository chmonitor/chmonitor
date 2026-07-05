/**
 * Maintenance windows panel (plan 28).
 *
 * Lets an operator declare a maintenance window (one host or all hosts) so
 * the health sweep suppresses outbound alerts while `now` falls inside it —
 * the finding is still recorded, this only gates the notification. Lives as
 * a tab in `HealthSettingsDialog` alongside Webhooks/History; every action
 * here is an immediate server call (create/delete), same pattern as
 * `WebhookSubscriptionsPanel`. Free/OSS feature: no Clerk sign-in required,
 * the server falls back to a single-tenant owner when Clerk isn't configured.
 */

import { toast } from 'sonner'

import type { MaintenanceWindowInfo } from '@/lib/hooks/use-maintenance-windows'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useMaintenanceWindows,
  useMaintenanceWindowsMutations,
} from '@/lib/hooks/use-maintenance-windows'
import { useHosts } from '@/lib/swr/use-hosts'
import { cn } from '@/lib/utils'

const ALL_HOSTS_VALUE = '__all__'

function windowStatus(w: MaintenanceWindowInfo): {
  label: string
  variant: 'default' | 'secondary' | 'outline'
} {
  const now = Date.now()
  if (now < w.startsAt) return { label: 'Upcoming', variant: 'outline' }
  if (now >= w.endsAt) return { label: 'Ended', variant: 'secondary' }
  return { label: 'Active', variant: 'default' }
}

/** `datetime-local` uses the browser's local timezone with no offset suffix. */
function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromDatetimeLocalValue(value: string): number | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : null
}

function WindowRow({
  window,
  hostName,
  onDeleted,
}: {
  window: MaintenanceWindowInfo
  hostName: string
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { deleteWindow } = useMaintenanceWindowsMutations()
  const status = windowStatus(window)

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteWindow(window.id)
      onDeleted()
    } catch {
      toast.error('Failed to delete maintenance window')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          <span className="truncate text-sm font-medium">{hostName}</span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {window.reason || 'No reason given'} ·{' '}
          {new Date(window.startsAt).toLocaleString()} →{' '}
          {new Date(window.endsAt).toLocaleString()}
        </span>
      </div>
      <Button variant="ghost" size="sm" disabled={busy} onClick={handleDelete}>
        Delete
      </Button>
    </div>
  )
}

function AddWindowForm({ onCreated }: { onCreated: () => void }) {
  const { hosts } = useHosts()
  const [hostValue, setHostValue] = useState<string>(ALL_HOSTS_VALUE)
  const [reason, setReason] = useState('')
  const [startsAt, setStartsAt] = useState(() =>
    toDatetimeLocalValue(Date.now())
  )
  const [endsAt, setEndsAt] = useState(() =>
    toDatetimeLocalValue(Date.now() + 60 * 60 * 1000)
  )
  const [busy, setBusy] = useState(false)
  const { createWindow } = useMaintenanceWindowsMutations()

  const handleSubmit = async () => {
    const startMs = fromDatetimeLocalValue(startsAt)
    const endMs = fromDatetimeLocalValue(endsAt)
    if (startMs === null || endMs === null) {
      toast.error('Enter a valid start and end time')
      return
    }
    if (endMs <= startMs) {
      toast.error('End time must be after start time')
      return
    }
    setBusy(true)
    try {
      await createWindow({
        hostId: hostValue === ALL_HOSTS_VALUE ? null : Number(hostValue),
        reason: reason.trim(),
        startsAt: startMs,
        endsAt: endMs,
      })
      toast.success('Maintenance window created')
      setReason('')
      onCreated()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to create window'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">Add maintenance window</Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Host</Label>
          <Select
            value={hostValue}
            onValueChange={(value) => {
              if (value != null) setHostValue(value)
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_HOSTS_VALUE}>All hosts</SelectItem>
              {hosts.map((h) => (
                <SelectItem key={h.id} value={String(h.id)}>
                  {h.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Reason</Label>
          <Input
            placeholder="Deploy, backup, …"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Starts</Label>
          <Input
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Ends</Label>
          <Input
            type="datetime-local"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </div>
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

export function MaintenanceWindowsPanel({ className }: { className?: string }) {
  const { windows, isLoading, refetch } = useMaintenanceWindows()
  const { hosts } = useHosts()

  const hostName = (hostId: number | null): string => {
    if (hostId === null) return 'All hosts'
    return hosts.find((h) => h.id === hostId)?.name ?? `Host ${hostId}`
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        While a window is active, the health sweep still runs every check and
        records findings — it only suppresses the outbound alert notification
        for the covered host(s).
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && windows.length === 0 && (
        <p className="text-sm text-muted-foreground">No maintenance windows.</p>
      )}

      <div className="flex flex-col gap-2">
        {windows.map((w) => (
          <WindowRow
            key={w.id}
            window={w}
            hostName={hostName(w.hostId)}
            onDeleted={refetch}
          />
        ))}
      </div>

      <AddWindowForm onCreated={refetch} />
    </div>
  )
}
