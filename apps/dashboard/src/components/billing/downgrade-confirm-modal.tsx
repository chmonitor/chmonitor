/**
 * Downgrade protection modal — shown before sending a user to the Polar portal
 * when POST /api/v1/billing/can-downgrade reports the target plan's limits
 * would be exceeded by current usage (plans/19-downgrade-protection.md).
 *
 * Purely presentational: the caller resolves `exceeded` from the API, decides
 * when to open it, and handles the "proceed" side effect (portal redirect +
 * logging) in `onProceed`. Reuses the same Dialog primitive as
 * `paywall-modal.tsx` for visual consistency with the rest of `components/billing/*`.
 *
 * Only meaningful when `exceeded` is non-empty — when it's empty the caller
 * should skip this modal and go straight to the portal, so this renders
 * nothing as a defensive guard against being shown by mistake.
 */
import { AlertTriangleIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { getPlan, PLAN_IDS } from '@/lib/billing/plans'

export interface DowngradeExceededLimit {
  metric: string
  used: number
  targetLimit: number | null
  message: string
}

export interface DowngradeConfirmModalProps {
  open: boolean
  targetPlanId: string
  exceeded: DowngradeExceededLimit[]
  /** Close the modal without proceeding — the user keeps their current plan. */
  onStay: () => void
  /** Proceed to the Polar portal anyway, overriding the warning. */
  onProceed: () => void
  onClose: () => void
}

const METRIC_LABELS: Record<string, string> = {
  hosts: 'Hosts',
  seats: 'Team seats',
  aiRequestsPerDay: 'AI messages / day',
  retentionDays: 'History retention',
}

function targetPlanName(targetPlanId: string): string {
  const isKnownPlanId = (PLAN_IDS as readonly string[]).includes(targetPlanId)
  return isKnownPlanId
    ? getPlan(targetPlanId as (typeof PLAN_IDS)[number]).name
    : targetPlanId
}

export function DowngradeConfirmModal({
  open,
  targetPlanId,
  exceeded,
  onStay,
  onProceed,
  onClose,
}: DowngradeConfirmModalProps) {
  // Caller-driven: nothing to warn about, so there's nothing to show.
  if (exceeded.length === 0) return null

  const planName = targetPlanName(targetPlanId)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        data-testid="downgrade-confirm-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangleIcon
              className="text-amber-500 size-4 shrink-0"
              strokeWidth={2}
            />
            Downgrading will exceed {planName} limits
          </DialogTitle>
          <DialogDescription>
            Downgrading to {planName} will exceed its limits:
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-3 rounded-lg border p-3 text-sm">
          {exceeded.map((item) => (
            <li key={item.metric} className="space-y-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">
                  {METRIC_LABELS[item.metric] ?? item.metric}
                </span>
                <span className="font-medium tabular-nums">
                  {item.used} / {item.targetLimit ?? '∞'}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">{item.message}</p>
            </li>
          ))}
        </ul>

        <DialogFooter>
          <Button onClick={onStay} data-testid="downgrade-stay-cta">
            Stay on current plan
          </Button>
          <Button
            variant="destructive"
            onClick={onProceed}
            data-testid="downgrade-anyway-cta"
          >
            Downgrade anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
