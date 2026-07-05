import { Building2, CreditCard, Sparkles } from 'lucide-react'

import {
  OrganizationProfile,
  useOrganization,
} from '@clerk/tanstack-react-start'
import { CloudOnlyNotice } from '@/components/cloud-only-notice'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getPlan } from '@/lib/billing/plans'
import { useBillingSubscription } from '@/lib/billing/use-billing'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'

/**
 * Member management surface. Renders Clerk's <OrganizationProfile/> (members,
 * roles, invitations) when the user has an active organization; otherwise an
 * upgrade prompt, since orgs are provisioned on a paid plan.
 *
 * Clerk imports are static but inert until this renders — and it only renders on
 * the cloud build (the route is cloud-gated in the sidebar), matching the
 * lazy-Clerk pattern used across the app.
 */
export function OrganizationMembers() {
  if (!isClerkEnabled() || !isCloudModeClient()) {
    // OSS / non-cloud: the sidebar already hides this route; this guards direct
    // URL access. Shown as a clean "cloud feature" notice rather than the old
    // misleading "No organization yet" card (which implied the user could —
    // and should — create one).
    return <CloudOnlyNotice feature="Organizations" />
  }
  return (
    <div className="mx-auto max-w-4xl space-y-6 py-8">
      <PlanSection />
      <OrgProfileGate />
    </div>
  )
}

function OrgProfileGate() {
  const { organization, isLoaded } = useOrganization()

  if (!isLoaded) {
    return <div className="bg-muted h-96 animate-pulse rounded-xl" />
  }

  if (!organization) {
    return <NoOrgState />
  }

  return <OrganizationProfile routing="hash" />
}

/**
 * Shows the user's current plan, renewal date (or cancellation warning), and a
 * link to manage billing. Fetches subscription at this component (deepest consumer).
 */
function PlanSection() {
  const { data: subscription, isLoading } = useBillingSubscription()

  if (isLoading) {
    return <Skeleton className="h-[72px] w-full rounded-xl" />
  }

  const planId = subscription?.planId ?? 'free'
  const plan = getPlan(planId)
  const currentPeriodEnd = subscription?.currentPeriodEnd
  const cancelAtPeriodEnd = subscription?.cancelAtPeriodEnd
  const status = subscription?.status
  const isFree = planId === 'free'

  const endDate = currentPeriodEnd
    ? new Date(currentPeriodEnd * 1000).toLocaleDateString()
    : null

  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CreditCard className="text-muted-foreground size-4 shrink-0" />
            <span className="text-sm font-medium">{plan.name} plan</span>
            {!isFree && status && (
              <Badge variant="secondary" className="text-[11px] capitalize">
                {status}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {isFree ? (
              'Upgrade to unlock teams, more hosts, and scheduled AI Insights.'
            ) : endDate ? (
              cancelAtPeriodEnd ? (
                <span className="text-amber-600 dark:text-amber-400">
                  Cancels on {endDate}
                </span>
              ) : (
                <>Renews {endDate}</>
              )
            ) : null}
          </p>
        </div>
        <Button
          size="sm"
          variant={isFree ? 'default' : 'outline'}
          className="shrink-0"
          render={
            <a href="/billing">{isFree ? 'Upgrade' : 'Manage billing'}</a>
          }
        />
      </CardContent>
    </Card>
  )
}

function NoOrgState() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <CardHeader className="items-center text-center">
          <div className="bg-primary/10 mb-2 flex size-12 items-center justify-center rounded-xl">
            <Building2 className="text-primary size-6" />
          </div>
          <CardTitle>No organization yet</CardTitle>
          <CardDescription>
            Upgrade to Pro or Max to create a team workspace — invite members,
            assign roles, and share your plan.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button
            render={
              <a href="/billing">
                <Sparkles className="size-4" /> View plans
              </a>
            }
          />
        </CardContent>
      </Card>
    </div>
  )
}
