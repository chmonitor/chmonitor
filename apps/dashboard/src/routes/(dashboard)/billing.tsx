import { ExternalLinkIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createFileRoute } from '@tanstack/react-router'

import type { ReactNode } from 'react'

import { useState } from 'react'
import { useClerkIsSignedIn as useClerkIsSignedInImpl } from '@/components/assistant-ui/use-clerk-is-signed-in'
import {
  DowngradeConfirmModal,
  type DowngradeExceededLimit,
} from '@/components/billing/downgrade-confirm-modal'
import {
  type BillingPeriod,
  BillingPeriodToggle,
  CurrentPlanBadge,
  PlanCard,
  PopularBadge,
} from '@/components/billing/plan-card'
import { PlanComparison } from '@/components/billing/plan-comparison'
import { UsageSummary } from '@/components/billing/usage-summary'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { trackEvent } from '@/lib/analytics/analytics'
import { BILLING_PLAN_LIST, getPlan } from '@/lib/billing/plans'
import {
  checkCanDowngrade,
  openBillingPortal,
  startCheckout,
  useBillingSubscription,
} from '@/lib/billing/use-billing'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'

/**
 * Sign-in primitives gated behind the build-time `isClerkEnabled()` constant —
 * Clerk's `useUser()` / `SignInButton` need a mounted `<ClerkProvider />`. When
 * Clerk is off (OSS / self-host) `useClerkIsSignedIn` returns true so the
 * signed-out prompt never shows — billing is a cloud-only surface. Mirrors
 * `agent-auth-gate.tsx`.
 */
const useClerkIsSignedIn: () => boolean = isClerkEnabled()
  ? useClerkIsSignedInImpl
  : () => true
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

interface DowngradeState {
  targetPlanId: string
  exceeded: DowngradeExceededLimit[]
}

function BillingPage() {
  const signedIn = useClerkIsSignedIn()
  const { data: sub, isLoading } = useBillingSubscription()
  const [period, setPeriod] = useState<BillingPeriod>('yearly')
  const [busy, setBusy] = useState<string | null>(null)
  const [downgradeState, setDowngradeState] = useState<DowngradeState | null>(
    null
  )

  // Cloud visitors who aren't signed in get a sign-in prompt instead of a
  // billing UI they can't act on. (Always signed-in in OSS, so never shown.)
  if (!signedIn) return <BillingSignedOut />

  const currentPlanId = sub?.planId ?? 'free'
  const currentPlan = getPlan(currentPlanId)
  // 'none' means "never subscribed" — show it as the free plan, not a raw status.
  const hasSubscription = Boolean(sub && sub.status !== 'none')
  const statusLabel = hasSubscription ? sub?.status : 'free'

  async function onCheckout(planId: 'pro' | 'max') {
    setBusy(planId)
    trackEvent('upgrade_click', { plan_id: planId, source: 'billing_page' })
    try {
      await startCheckout(planId, period)
    } catch (err) {
      setBusy(null)
      toast.error(err instanceof Error ? err.message : 'Checkout failed')
    }
  }

  async function onPortal() {
    setBusy('portal')
    try {
      await openBillingPortal()
    } catch (err) {
      setBusy(null)
      toast.error(
        err instanceof Error ? err.message : 'Could not open billing portal'
      )
    }
  }

  /**
   * "Change to <plan>" — plan 19's downgrade protection. Pre-flights the
   * change against the target plan's limits; only over-limit changes see the
   * warning modal, so upgrades between paid tiers proceed straight through
   * (can-downgrade returns `ok: true` harmlessly for those).
   */
  async function onChangeToPlan(planId: 'pro' | 'max') {
    setBusy(planId)
    try {
      const { ok, exceeded } = await checkCanDowngrade(planId)
      if (ok) {
        await openBillingPortal()
        return // navigating away — leave `busy` true through the redirect
      }
      setDowngradeState({ targetPlanId: planId, exceeded })
      setBusy(null)
    } catch (err) {
      setBusy(null)
      toast.error(
        err instanceof Error ? err.message : 'Could not check plan change'
      )
    }
  }

  function onStayOnCurrentPlan() {
    setDowngradeState(null)
  }

  async function onDowngradeAnyway() {
    if (!downgradeState) return
    trackEvent('downgrade_override', {
      target_plan: downgradeState.targetPlanId,
      exceeded_metrics: downgradeState.exceeded.map((e) => e.metric).join(','),
    })
    setDowngradeState(null)
    setBusy('portal')
    try {
      await openBillingPortal()
    } catch (err) {
      setBusy(null)
      toast.error(
        err instanceof Error ? err.message : 'Could not open billing portal'
      )
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Manage your plan and host limits. Early access is free while in beta.
        </p>
      </div>

      {/* Current plan */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                {currentPlan.name}
                <Badge variant="secondary">
                  {isLoading ? '…' : statusLabel}
                </Badge>
              </CardTitle>
              <CardDescription>
                {currentPlan.hosts === null
                  ? 'Unlimited hosts'
                  : `${currentPlan.hosts} host${currentPlan.hosts === 1 ? '' : 's'} included`}
                {currentPlan.seats !== null &&
                  ` · ${currentPlan.seats} seat${currentPlan.seats === 1 ? '' : 's'}`}
              </CardDescription>
            </div>
            {hasSubscription && (
              <Button
                variant="outline"
                onClick={onPortal}
                disabled={busy !== null}
              >
                Manage billing <ExternalLinkIcon className="size-4" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <UsageSummary />
        </CardContent>
      </Card>

      {/* Billing period toggle */}
      <BillingPeriodToggle value={period} onChange={setPeriod} />

      {/* Plan grid */}
      <div className="grid items-stretch gap-4 md:grid-cols-2 lg:grid-cols-4">
        {BILLING_PLAN_LIST.map((plan) => {
          const isCurrent = plan.id === currentPlanId
          const paid = plan.id === 'pro' || plan.id === 'max'
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              period={period}
              featured={plan.id === 'pro'}
              badge={
                isCurrent ? (
                  <CurrentPlanBadge />
                ) : plan.id === 'pro' ? (
                  <PopularBadge />
                ) : undefined
              }
              cta={
                isCurrent ? (
                  <Button variant="outline" className="w-full" disabled>
                    Current plan
                  </Button>
                ) : paid && hasSubscription ? (
                  // Active subscribers can't start a fresh checkout (Polar blocks
                  // it: "You already have an active subscription"). Plan changes
                  // go through the customer portal, which prorates correctly.
                  // Pre-flighted by can-downgrade (plan 19) so a change that
                  // would exceed the target plan's limits warns first.
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => onChangeToPlan(plan.id as 'pro' | 'max')}
                    disabled={busy !== null}
                  >
                    {busy === plan.id ? 'Checking…' : `Change to ${plan.name}`}
                  </Button>
                ) : paid ? (
                  <Button
                    className="w-full"
                    onClick={() => onCheckout(plan.id as 'pro' | 'max')}
                    disabled={busy !== null}
                  >
                    {busy === plan.id
                      ? 'Redirecting…'
                      : `Upgrade to ${plan.name}`}
                  </Button>
                ) : plan.id === 'enterprise' ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    render={<a href="mailto:hello@chmonitor.dev">Contact us</a>}
                  />
                ) : (
                  <Button variant="outline" className="w-full" disabled>
                    Free forever
                  </Button>
                )
              }
            />
          )
        })}
      </div>

      {/* Full benefits matrix */}
      <PlanComparison currentPlanId={currentPlanId} />

      <DowngradeConfirmModal
        open={downgradeState !== null}
        targetPlanId={downgradeState?.targetPlanId ?? ''}
        exceeded={downgradeState?.exceeded ?? []}
        onStay={onStayOnCurrentPlan}
        onProceed={onDowngradeAnyway}
        onClose={onStayOnCurrentPlan}
      />
    </div>
  )
}

/**
 * Signed-out cloud view. Leads with a sign-in prompt (you can't check out or
 * manage a subscription anonymously), then shows the full plan comparison so a
 * visitor can still weigh the plans before creating an account.
 */
function BillingSignedOut() {
  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Plans and host limits for the hosted cloud. Early access is free while
          in beta.
        </p>
      </div>

      <Card className="overflow-hidden">
        <div className="from-primary/[0.06] bg-gradient-to-b to-transparent">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="bg-primary/10 flex size-12 items-center justify-center rounded-full">
              <SparklesIcon className="text-primary size-5" strokeWidth={2} />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">
                Sign in to get started
              </h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
                Create a free account to connect your ClickHouse hosts, choose a
                plan, and manage your subscription. No card required to start.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {ClerkSignInButton ? (
                <ClerkSignInButton>
                  <Button size="lg">Sign in / Create account</Button>
                </ClerkSignInButton>
              ) : null}
              <Button
                variant="ghost"
                size="lg"
                render={
                  <a
                    href="https://docs.chmonitor.dev"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read the docs <ExternalLinkIcon className="size-4" />
                  </a>
                }
              />
            </div>
          </CardContent>
        </div>
      </Card>

      {/* Let signed-out visitors compare plans before committing. */}
      <PlanComparison currentPlanId="free" />
    </div>
  )
}

export const Route = createFileRoute('/(dashboard)/billing')({
  component: BillingPage,
})
