import {
  DatabaseZap,
  FlaskConical,
  KeyRound,
  PlugZap,
  Server,
  ShieldCheck,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'

import type { ReactNode } from 'react'
import type { ConnectionPreset } from '@/components/connections/connection-presets'

import { useEffect, useState } from 'react'
import { PlanCard, PopularBadge } from '@/components/billing/plan-card'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { AddHostDialog } from '@/components/connections'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { WelcomeIllustration } from '@/components/illustrations/welcome-illustration'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { trackEvent } from '@/lib/analytics/analytics'
import { BILLING_PLAN_LIST } from '@/lib/billing/plans'
import {
  startCheckout,
  useBillingSubscription,
} from '@/lib/billing/use-billing'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { docsSiteUrl } from '@/lib/docs-site'
import { isFeatureEnabled } from '@/lib/feature-flags'
import { useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { cn } from '@/lib/utils'

/** Options for opening the Add-host dialog from a first-run CTA. */
type OpenAddHostOptions = {
  /** Prefill the read-only sample ClickHouse preset. */
  preset?: 'sample'
  /** Connection-type tab to open on (e.g. `'postgres'`). */
  engine?: ConnectionPreset
}

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
  const [addPreset, setAddPreset] = useState<'sample' | undefined>(undefined)
  const [addEngine, setAddEngine] = useState<ConnectionPreset>('self-hosted')

  // Every open sets preset + engine explicitly (including the defaults) — this
  // dialog instance is reused/toggled, not remounted per CTA, so leaving the
  // previous values in place would leak (e.g. "sample" or "postgres") into a
  // later plain "Connect ClickHouse" click.
  const openAddHost = (opts?: OpenAddHostOptions) => {
    setAddPreset(opts?.preset)
    setAddEngine(opts?.engine ?? 'self-hosted')
    setAddOpen(true)
  }

  let body: ReactNode
  if (cloudMode && isSignedIn) {
    body = <ConnectYourHost onAddHost={openAddHost} />
  } else if (cloudMode) {
    body = <SignInToConnect />
  } else {
    body = <SelfHostedSetup onAddHost={openAddHost} />
  }

  return (
    <>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16">
        <div className="w-full max-w-3xl">{body}</div>
      </div>
      <AddHostDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialPreset={addPreset}
        initialEngine={addEngine}
      />
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
      <WelcomeIllustration className="mb-4" />
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

/**
 * Two-engine chooser: "Connect ClickHouse" (primary) plus, when the Postgres
 * source flag is on, "Connect Postgres" (Beta). Each button opens the Add-host
 * dialog straight on the matching connection-type tab. Falls back to a single
 * full-width ClickHouse button when Postgres is disabled — zero visual change
 * for the ClickHouse-only build.
 */
function EngineChooser({
  onAddHost,
  allowPostgres,
  clickhouseLabel,
  className,
}: {
  onAddHost: (opts?: OpenAddHostOptions) => void
  allowPostgres: boolean
  clickhouseLabel: string
  className?: string
}) {
  return (
    <div
      className={cn('grid gap-2', allowPostgres && 'sm:grid-cols-2', className)}
    >
      <Button
        size="lg"
        onClick={() => onAddHost({ engine: 'self-hosted' })}
        data-testid="welcome-add-host"
      >
        <PlugZap className="size-4" />
        {clickhouseLabel}
      </Button>
      {allowPostgres && (
        <Button
          size="lg"
          variant="outline"
          onClick={() => onAddHost({ engine: 'postgres' })}
          data-testid="welcome-add-postgres"
        >
          <Server className="size-4" />
          Connect Postgres
          <Badge
            variant="secondary"
            className="ml-1 px-1.5 py-0 text-[10px] font-medium"
          >
            Beta
          </Badge>
        </Button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Cloud — signed in                                                   */
/* ------------------------------------------------------------------ */

function ConnectYourHost({
  onAddHost,
}: {
  onAddHost: (opts?: OpenAddHostOptions) => void
}) {
  const allowPostgres = isFeatureEnabled('postgresSource')
  const { data: sub } = useBillingSubscription()
  const currentPlanId = sub?.planId ?? 'free'
  // status 'none' = no subscription at all; the server requires an active one
  // (even the $0 Free plan) before the first host can be added, so onboarding
  // must route through plan selection first.
  const hasActiveSub = sub != null && sub.status !== 'none'
  // Onboarding: pick a plan first, then connect a host. Anyone with an active
  // subscription (including Free) skips straight to connect.
  const [step, setStep] = useState<'plan' | 'connect'>(
    hasActiveSub ? 'connect' : 'plan'
  )
  // The subscription loads async (and refreshes after the Polar redirect
  // returns) — advance to the connect step as soon as it turns up active.
  useEffect(() => {
    if (hasActiveSub) setStep('connect')
  }, [hasActiveSub])

  if (step === 'plan') {
    return (
      <div className="space-y-7">
        <WelcomeHeader
          title="Choose your plan"
          subtitle="Start free, or pick a paid plan for more hosts, seats and history. You can upgrade anytime — no card needed for Free."
        />
        <OnboardingPlans
          currentPlanId={currentPlanId}
          hasActiveSub={hasActiveSub}
          onContinueFree={() => setStep('connect')}
        />
      </div>
    )
  }

  return (
    <div className="space-y-7">
      <WelcomeHeader
        title={
          allowPostgres ? 'Connect your database' : 'Connect your ClickHouse'
        }
        subtitle={
          allowPostgres
            ? 'Your workspace is ready. Connect a ClickHouse or Postgres source to start monitoring queries, performance and health.'
            : 'Your workspace is ready. Add a ClickHouse host to start monitoring queries, merges, replication and cluster health.'
        }
      />

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        <ul className="space-y-4">
          <SetupStep
            icon={<DatabaseZap className="size-4" />}
            title="1. Have your connection details"
          >
            {allowPostgres ? (
              <>
                The endpoint or host (e.g.{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  https://host:8443
                </code>{' '}
                for ClickHouse,{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  host:5432
                </code>{' '}
                for Postgres), username and password.
              </>
            ) : (
              <>
                The HTTP(S) endpoint (e.g.{' '}
                <code className="rounded bg-muted px-1 text-[11px]">
                  https://host:8443
                </code>
                ), username and password.
              </>
            )}
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

        <EngineChooser
          className="mt-5"
          onAddHost={onAddHost}
          allowPostgres={allowPostgres}
          clickhouseLabel="Connect ClickHouse"
        />

        <Button
          className="mt-2 w-full"
          size="lg"
          variant="outline"
          onClick={() => onAddHost({ preset: 'sample' })}
          data-testid="welcome-try-sample"
        >
          <FlaskConical className="size-4" />
          Try with sample ClickHouse
        </Button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          A public, read-only demo — explore schema &amp; SQL, no setup
          required.
        </p>

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

/**
 * Onboarding plan picker. Every plan — including Free — goes through Polar
 * checkout so the account holds a real (possibly $0) subscription before the
 * first host; the free checkout collects no card and returns straight here.
 * When billing isn't configured (OSS/preview → checkout 501s) Free falls open
 * to plain continue, mirroring the server gate's fail-open behaviour.
 */
function OnboardingPlans({
  currentPlanId,
  hasActiveSub,
  onContinueFree,
}: {
  currentPlanId: string
  hasActiveSub: boolean
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

  async function chooseFree() {
    if (hasActiveSub) {
      onContinueFree()
      return
    }
    setBusy('free')
    try {
      await startCheckout('free', 'monthly', { returnPath: '/' })
    } catch (err) {
      setBusy(null)
      const message = err instanceof Error ? err.message : ''
      // 501 = billing not configured on this deployment — the server gate is
      // off too, so continuing without a subscription is correct here.
      if (/billing is not enabled|no polar product/i.test(message)) {
        onContinueFree()
        return
      }
      toast.error(message || 'Could not start the Free plan')
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
                    onClick={chooseFree}
                    disabled={busy !== null}
                    data-testid="onboarding-choose-free"
                  >
                    {busy === 'free'
                      ? 'Redirecting…'
                      : hasActiveSub
                        ? 'Continue with Free'
                        : 'Start Free — $0'}
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

function SelfHostedSetup({
  onAddHost,
}: {
  onAddHost: (opts?: OpenAddHostOptions) => void
}) {
  const allowPostgres = isFeatureEnabled('postgresSource')
  return (
    <div className="space-y-7">
      <WelcomeHeader
        title={
          allowPostgres
            ? 'Connect a database to get started'
            : 'Connect a ClickHouse host to get started'
        }
        subtitle={
          allowPostgres
            ? 'No sources are configured yet. Set ClickHouse hosts once via environment variables, or connect a ClickHouse or Postgres source from your browser.'
            : 'No ClickHouse hosts are configured yet. Set them once via environment variables, or add one from your browser.'
        }
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

        <EngineChooser
          onAddHost={onAddHost}
          allowPostgres={allowPostgres}
          clickhouseLabel="Connect ClickHouse"
        />

        <Button
          className="mt-2 w-full"
          variant="outline"
          onClick={() => onAddHost({ preset: 'sample' })}
          data-testid="welcome-try-sample"
        >
          <FlaskConical className="size-4" />
          Try with sample ClickHouse
        </Button>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          A public, read-only demo — explore schema &amp; SQL, no setup
          required.
        </p>
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
