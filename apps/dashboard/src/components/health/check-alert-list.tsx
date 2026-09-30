/**
 * Built-in alert list (#3438) — every built-in alert with its display name,
 * its stable id, live state on the current host, and inline rename / reset.
 *
 * The id is the stable key: `alert_state` / ACKs stay keyed on it, so a
 * rename never resets anything. The list always renders (the API answers with
 * defaults when there is no metadata DB); only rename/reset are gated on
 * `useHealthStoreAvailability` (#3495) — `unknown` renders disabled too.
 */
import { Check, Pencil, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'

import type { AlertStateRow } from '@/lib/health/alert-state-persist'
import type { CheckAlertInfo } from '@/lib/hooks/use-check-alerts'

import { STATE_BADGE_CLASS, STATE_LABEL } from './alert-state-card'
import { canWriteHealthStore, HealthStoreNotice } from './health-store-notice'
import { useAlertState } from './use-alert-state'
import { type FormEvent, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { useHealthStoreAvailability } from '@/lib/health/store-availability'
import {
  useCheckAlerts,
  useCheckAlertsMutations,
} from '@/lib/hooks/use-check-alerts'
import { describeError } from '@/lib/swr/fetch-error'
import { useHostId } from '@/lib/swr/use-host'
import { cn } from '@/lib/utils'

/** Mirrors `MAX_NAME_LENGTH` in `rule-builder-schema.ts` (server validates). */
const MAX_NAME_LENGTH = 80

function CheckAlertRow({
  alert,
  state,
  canWrite,
}: {
  alert: CheckAlertInfo
  state: AlertStateRow | undefined
  canWrite: boolean
}) {
  const { renameCheckAlert, resetCheckAlert } = useCheckAlertsMutations()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(alert.name)
  const [busy, setBusy] = useState(false)

  const trimmed = draft.trim()
  const canSave =
    canWrite &&
    !busy &&
    trimmed.length > 0 &&
    trimmed.length <= MAX_NAME_LENGTH &&
    trimmed !== alert.name

  const startEdit = () => {
    setDraft(alert.name)
    setEditing(true)
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setBusy(true)
    try {
      await renameCheckAlert(alert.checkId, trimmed)
      setEditing(false)
      toast.success('Alert renamed')
    } catch (err) {
      toast.error('Failed to rename alert', { description: describeError(err) })
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    setBusy(true)
    try {
      await resetCheckAlert(alert.checkId)
      setEditing(false)
      toast.success('Alert name reset')
    } catch (err) {
      toast.error('Failed to reset alert name', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const firing = state && state.severity !== 'ok' ? state.severity : undefined

  return (
    <li
      className="flex flex-wrap items-center gap-2 px-3 py-2"
      data-check-alert={alert.checkId}
    >
      {editing ? (
        <form
          onSubmit={(e) => void save(e)}
          className="flex min-w-0 flex-1 items-center gap-1.5"
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
            maxLength={MAX_NAME_LENGTH}
            aria-label={`Name for ${alert.defaultName}`}
            className="h-8 min-w-0 flex-1 text-[13px]"
            autoFocus
          />
          <Button
            type="submit"
            size="icon-sm"
            variant="ghost"
            disabled={!canSave}
            aria-label="Save name"
          >
            <Check className="size-3.5" strokeWidth={1.5} />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setEditing(false)}
            aria-label="Cancel rename"
          >
            <X className="size-3.5" strokeWidth={1.5} />
          </Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium" title={alert.name}>
            {alert.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{alert.checkId}</span>
            {alert.source === 'd1' && <> · default “{alert.defaultName}”</>}
          </span>
        </div>
      )}

      {firing && (
        <Badge
          className={cn('shrink-0 font-normal', STATE_BADGE_CLASS[firing])}
        >
          {STATE_LABEL[firing]}
        </Badge>
      )}

      {!editing && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={startEdit}
            disabled={!canWrite || busy}
            aria-label={`Rename ${alert.name}`}
            title="Rename"
          >
            <Pencil className="size-3.5" strokeWidth={1.5} />
          </Button>
          {alert.source === 'd1' && (
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() => void reset()}
              disabled={!canWrite || busy}
              aria-label={`Reset ${alert.name} to default name`}
              title="Reset to default name"
            >
              <RotateCcw className="size-3.5" strokeWidth={1.5} />
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

export function CheckAlertList({ className }: { className?: string }) {
  const hostId = useHostId()
  const { alerts, isLoading, error, refetch } = useCheckAlerts()
  const { states } = useAlertState(hostId)
  const availability = useHealthStoreAvailability({ probeError: error })
  const canWrite = canWriteHealthStore(availability)

  const stateById = useMemo(
    () => new Map(states.map((row) => [row.ruleId, row])),
    [states]
  )

  let content: React.ReactNode
  if (isLoading) {
    content = (
      <div className="py-6 text-center text-xs text-muted-foreground">
        Loading alerts…
      </div>
    )
  } else if (error) {
    content = (
      <EmptyState
        variant="error"
        title="Couldn't load built-in alerts"
        description={error.message}
        onRefresh={() => void refetch()}
        compact
      />
    )
  } else {
    content = (
      <ul className="divide-y rounded-xl border bg-card shadow-sm">
        {alerts.map((alert) => (
          <CheckAlertRow
            key={alert.checkId}
            alert={alert}
            state={stateById.get(alert.ruleId)}
            canWrite={canWrite}
          />
        ))}
      </ul>
    )
  }

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium">Built-in alerts</span>
        <span className="text-xs text-muted-foreground">
          Every alert the health sweep can raise. Rename one to change how it
          reads in alert lists here. Its id stays the same, so alert state and
          acknowledgements carry over.
        </span>
      </div>
      <HealthStoreNotice availability={availability} feature="Alert names" />
      {content}
    </div>
  )
}
