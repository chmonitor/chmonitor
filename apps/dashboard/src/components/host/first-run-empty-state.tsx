import {
  ArrowRight,
  DatabaseZap,
  KeyRound,
  PlugZap,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'

import type { ReactNode } from 'react'

import { useState } from 'react'
import { PlanCard, PopularBadge } from '@/components/billing/plan-card'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { AddHostDialog } from '@/components/connections'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/analytics'
import { BILLING_PLAN_LIST } from '@/lib/billing/plans'
import {
  startCheckout,
  useBillingSubscription,
} from '@/lib/billing/use-billing'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { docsSiteUrl } from '@/lib/docs-site'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'

// Clerk's SignInButton needs a mounted <ClerkProvider>. Gate it behind the
// build-time constant so non-Clerk (self-hosted) builds render null instead.
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

/**
 * First-run onboarding / welcome surface.
 *
 * Rendered by `FirstRunGate` when the visitor has ZERO usable ClickHouse hosts.
 * The exact framing depends on the deployment:
 *
 *  - Cloud (SaaS), signed in → "Connect your ClickHouse" setup page. The demo
 *    was hidden once they signed in, so this is the moment to bring their own
 *    host. Primary action opens the Add-host dialog (server storage).
 *  - Cloud (SaaS), anonymous → "Sign in to connect" with the value prop.
 *  - Self-hosted (OSS) → operator-oriented guidance: set CLICKHOUSE_HOST env
 *    vars, or add a browser connection. Unchanged from the original behaviour.
 *
 * @see components/host/first-run-gate.tsx
 */
export function FirstRunEmptyState() {
  const { cloudMode, isSignedIn } = useMergedHosts()
  const [addOpen, setAddOpen] = useState(false)

  let body: ReactNode
  if (cloudMode && isSignedIn) {
    body = <ConnectYourHost onAddHost={() => setAddOpen(true)} />
  } else if (cloudMode) {
    body = <SignInToConnect />
  } else {
    body = <SelfHostedSetup onAddHost={() => setAddOpen(true)} />
  }

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl">{body}</div>
      </div>
      <AddHostDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Shared layout pieces                                                */
/* ------------------------------------------------------------------ */

function WelcomeHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: ReactNode
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
        <ChmonitorLogo width={28} height={28} className="size-7" />
      </div>
      <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
        {title}
      </h1>
      <p className="mt-2 text-pretty text-sm text-muted-foreground">
        {subtitle}
      </p>
    </div>
  )
}

function SetupStep({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border bg-muted/40 text-muted-foreground">
        {icon}
      </span>
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{children}</span>
      </span>
    </li>
  )
}

function DocsFooter({ links }: { links: { slug: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {links.map(({ slug, label }) => (
        <a
          key={slug}
          href={docsSiteUrl(slug)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted"
        >
          {label}
        </a>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cloud — signed in                                                   */
/* ------------------------------------------------------------------ */

function ConnectYourHost({ onAddHost }: { onAddHost: () => void }) {
  const { data: sub } = useBillingSubscription()
  const currentPlanId = sub?.planId ?? 'free'
  const isPaid = currentPlanId === 'pro' || currentPlanId === 'max'
  // Onboarding: pick a plan first, then connect a host. Paid users (or anyone
  // who already chose) skip straight to connect.
  const [step, setStep] = useState<'plan' | 'connect'>(
    isPaid ? 'connect' : 'plan'
  )

  if (step === 'plan') {
    return (
      <div className="space-y-7">
        <WelcomeHeader
          title="Choose your plan"
          subtitle="Start free, or pick a paid plan for more hosts, seats and history. You can upgrade anytime — no card needed for Free."
        />
        <OnboardingPlans
          currentPlanId={currentPlanId}
          onContinueFree={() => setStep('connect')}
        />
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <WelcomeHeader
        title="Connect your ClickHouse"
        subtitle="Your workspace is ready. Add a ClickHouse host to start monitoring queries, merges, replication and cluster health."
      />

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <ul className="space-y-4">
          <SetupStep
            icon={<DatabaseZap className="size-4" />}
            title="1. Have your connection details"
          >
            The HTTP(S) endpoint (e.g.{' '}
            <code className="rounded bg-muted px-1 text-[11px]">
              https://host:8443
            </code>
            ), username and password.
          </SetupStep>
          <SetupStep
            icon={<ShieldCheck className="size-4" />}
            title="2. Use a read-only monitoring user"
          >
            A user with{' '}
            <code className="rounded bg-muted px-1 text-[11px]">SELECT</code> on{' '}
            <code className="rounded bg-muted px-1 text-[11px]">system.*</code>{' '}
            is enough. No write access needed.
          </SetupStep>
          <SetupStep
            icon={<PlugZap className="size-4" />}
            title="3. Connect and explore"
          >
            Credentials are stored encrypted and synced to your account. Test
            the connection before saving.
          </SetupStep>
        </ul>

        <Button
          className="mt-5 w-full"
          size="lg"
          onClick={onAddHost}
          data-testid="welcome-add-host"
        >
          <PlugZap className="size-4" />
          Add ClickHouse host
          <ArrowRight className="ml-auto size-4" />
        </Button>

        <p className="text-muted-foreground mt-3 text-center text-xs">
          Not sure where to start?{' '}
          <a
            href={docsSiteUrl('getting-started/clickhouse-requirements')}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Read the full setup guide
          </a>
        </p>
      </div>

      <DocsFooter
        links={[
          { slug: 'getting-started', label: 'Getting started' },
          {
            slug: 'getting-started/clickhouse-requirements',
            label: 'Create a monitoring user',
          },
          {
            slug: 'guides/connect-firewalled-clickhouse',
            label: 'Connect behind a firewall',
          },
          {
            slug: 'guides/connection-errors',
            label: 'Connection troubleshooting',
          },
        ]}
      />
    </div>
  )
}

/** Onboarding plan picker: Free continues with no Polar; Pro/Max → checkout. */
function OnboardingPlans({
  currentPlanId,
  onContinueFree,
}: {
  currentPlanId: string
  onContinueFree: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)

  async function choosePaid(planId: 'pro' | 'max') {
    setBusy(planId)
    trackEvent('upgrade_click', { plan_id: planId, source: 'welcome' })
    try {
      await startCheckout(planId, 'yearly')
    } catch (err) {
      setBusy(null)
      toast.error(err instanceof Error ? err.message : 'Checkout failed')
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid items-stretch gap-4 sm:grid-cols-3">
        {BILLING_PLAN_LIST.filter((p) => p.id !== 'enterprise').map((plan) => {
          const isFree = plan.id === 'free'
          const isCurrent = plan.id === currentPlanId
          return (
            <PlanCard
              key={plan.id}
              plan={plan}
              period="yearly"
              featured={plan.id === 'pro'}
              badge={plan.id === 'pro' ? <PopularBadge /> : undefined}
              maxHighlights={3}
              cta={
                isFree ? (
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={onContinueFree}
                    disabled={busy !== null}
                    data-testid="onboarding-choose-free"
                  >
                    Continue with Free
                  </Button>
                ) : (
                  <Button
                    className="w-full"
                    onClick={() => choosePaid(plan.id as 'pro' | 'max')}
                    disabled={busy !== null || isCurrent}
                    data-testid={`onboarding-choose-${plan.id}`}
                  >
                    {busy === plan.id
                      ? 'Redirecting…'
                      : isCurrent
                        ? 'Current plan'
                        : `Choose ${plan.name}`}
                  </Button>
                )
              }
            />
          )
        })}
      </div>
      <button
        type="button"
        onClick={onContinueFree}
        className="text-muted-foreground hover:text-foreground mx-auto block text-xs underline-offset-4 hover:underline"
      >
        Skip — I'll decide later
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cloud — anonymous                                                   */
/* ------------------------------------------------------------------ */

function SignInToConnect() {
  return (
    <div className="space-y-7">
      <WelcomeHeader
        title="Monitor your ClickHouse"
        subtitle="Sign in to connect your own ClickHouse cluster — query performance, merges, replication, cluster health and an AI agent, all in one place."
      />

      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-5 shadow-sm">
        {ClerkSignInButton ? (
          <ClerkSignInButton>
            <Button size="lg" className="w-full" data-testid="welcome-sign-in">
              <KeyRound className="size-4" />
              Sign in to get started
            </Button>
          </ClerkSignInButton>
        ) : (
          <Button size="lg" className="w-full" disabled>
            Sign in unavailable
          </Button>
        )}
        <p className="text-center text-xs text-muted-foreground">
          Free to start. Your credentials are encrypted and scoped to your
          account.
        </p>
      </div>

      <DocsFooter
        links={[
          { slug: 'getting-started', label: 'Getting started' },
          { slug: 'features/overview', label: 'What you get' },
        ]}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Self-hosted (OSS)                                                   */
/* ------------------------------------------------------------------ */

function SelfHostedSetup({ onAddHost }: { onAddHost: () => void }) {
  return (
    <div className="space-y-7">
      <WelcomeHeader
        title="Connect a ClickHouse host to get started"
        subtitle="No ClickHouse hosts are configured yet. Set them once via environment variables, or add one from your browser."
      />

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Terminal className="size-4 text-muted-foreground" />
          Environment variables
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Set these and restart the app (comma-separated for multiple hosts):
        </p>
        <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-[12px] leading-relaxed">
          <code>{`CLICKHOUSE_HOST=https://host:8443
CLICKHOUSE_USER=monitoring
CLICKHOUSE_PASSWORD=••••••••`}</code>
        </pre>

        <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <Button
          className="w-full"
          variant="outline"
          onClick={onAddHost}
          data-testid="welcome-add-host"
        >
          <PlugZap className="size-4" />
          Add a host from this browser
        </Button>
      </div>

      <DocsFooter
        links={[
          { slug: 'getting-started', label: 'Getting started' },
          {
            slug: 'reference/environment-variables',
            label: 'Environment variables',
          },
          {
            slug: 'guides/connection-errors',
            label: 'Connection troubleshooting',
          },
        ]}
      />
    </div>
  )
}
