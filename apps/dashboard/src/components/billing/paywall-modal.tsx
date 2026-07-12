/**
 * The upgrade paywall — replaces a raw 402 error toast with a conversion
 * surface. Mounted once at the app shell (`components/billing/paywall-host.tsx`
 * inside `DashboardShell`) and driven by the global paywall store
 * (`lib/billing/paywall-store.ts`), which `apiFetch` populates whenever a
 * request comes back with a classified billing-limit 402
 * (`classifyBillingLimit`).
 *
 * Honest paywalls: the hard "Upgrade" CTA only renders when
 * `plan-enforcement.ts` says the hit limit is actually `enforced` server-side
 * (see `paywall-logic.ts:enforcementForReason`). A `deferred` limit shows
 * beta-friendly copy instead — never a false "you must upgrade" claim.
 */

import { toast } from 'sonner'

import type { BillingLimitReason } from '@/lib/api/error-handler/types'

import {
  enforcementForReason,
  findNextTier,
  formatReasonCap,
  REASON_TITLES,
  resolveCurrentPlan,
  resolveUpgradeAction,
} from './paywall-logic'
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
import { trackEvent } from '@/lib/analytics/analytics'
import { salesContactMailto } from '@/lib/billing/contact'
import { openBillingPortal, startCheckout } from '@/lib/billing/use-billing'

export interface PaywallModalProps {
  open: boolean
  reason: BillingLimitReason
  /** Human-readable upgrade nudge, echoed from the server's `limitMessage()`. */
  message: string
  currentPlanId: string
  onClose: () => void
}

export function PaywallModal({
  open,
  reason,
  message,
  currentPlanId,
  onClose,
}: PaywallModalProps) {
  const [busy, setBusy] = useState(false)
  const currentPlan = resolveCurrentPlan(currentPlanId)
  const nextTier = findNextTier(currentPlan.id, reason)
  const enforcement = enforcementForReason(reason)
  const action = resolveUpgradeAction(currentPlan.id, nextTier)
  const showHardCta =
    enforcement.status === 'enforced' && action.kind !== 'none'

  async function onUpgrade() {
    setBusy(true)
    trackEvent('upgrade_click', {
      plan_id: nextTier?.id ?? 'unknown',
      source: `paywall_${reason}`,
    })
    try {
      if (action.kind === 'checkout') {
        await startCheckout(action.planId, 'monthly')
        return // navigating away — leave `busy` true through the redirect
      }
      if (action.kind === 'portal') {
        await openBillingPortal()
        return
      }
    } catch (err) {
      setBusy(false)
      toast.error(
        err instanceof Error ? err.message : 'Could not start checkout'
      )
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md" data-testid="paywall-modal">
        <DialogHeader>
          <DialogTitle>{REASON_TITLES[reason]}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>

        {nextTier && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
            <div className="space-y-1">
              <div className="text-muted-foreground">
                {currentPlan.name} (current)
              </div>
              <div className="font-medium">
                {formatReasonCap(reason, currentPlan)}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-muted-foreground">{nextTier.name}</div>
              <div className="font-medium">
                {formatReasonCap(reason, nextTier)}
              </div>
            </div>
          </div>
        )}

        {enforcement.status === 'deferred' && (
          <p
            className="text-muted-foreground text-sm"
            data-testid="paywall-deferred-copy"
          >
            This limit isn&apos;t billed during early access —{' '}
            {enforcement.reason}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Dismiss
          </Button>
          {showHardCta &&
            (action.kind === 'contact' ? (
              <Button render={<a href={salesContactMailto()}>Contact us</a>} />
            ) : (
              <Button
                onClick={onUpgrade}
                disabled={busy}
                data-testid="paywall-upgrade-cta"
              >
                {busy ? 'Redirecting…' : `Upgrade to ${nextTier?.name}`}
              </Button>
            ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
