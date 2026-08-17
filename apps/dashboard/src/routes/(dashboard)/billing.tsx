import { ExternalLinkIcon, SparklesIcon } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'

import type { LicenseTerm, PaidLicenseId } from '@chm/pricing'
import type { ReactNode } from 'react'

import {
  LICENSE_SKU_LIST,
  licenseHostsLabel,
  licensePriceUsd,
  PERSONAL_SELFHOST_HREF,
} from '@chm/pricing'
import { useState } from 'react'
import { useClerkIsSignedIn as useClerkIsSignedInImpl } from '@/components/assistant-ui/use-clerk-is-signed-in'
import { UsageSummary } from '@/components/billing/usage-summary'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
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
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { cn } from '@/lib/utils'

const useClerkIsSignedIn: () => boolean = isClerkEnabled()
  ? useClerkIsSignedInImpl
  : () => true
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

function licenseCheckoutHref(sku: PaidLicenseId, term: LicenseTerm): string {
  return `https://chmonitor.dev/license/register?sku=${sku}&term=${term}`
}

function BillingPage() {
  const signedIn = useClerkIsSignedIn()
  const [term, setTerm] = useState<LicenseTerm>('yearly')

  if (!signedIn) return <BillingSignedOut term={term} onTerm={setTerm} />

  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Hosted Cloud is free. Paid checkout is a self-host commercial license.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Hosted Cloud
            <Badge variant="secondary">Free</Badge>
          </CardTitle>
          <CardDescription>
            Connect your clusters on dash.chmonitor.dev. No host or seat cap. AI
            usage below is the only hosted meter.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UsageSummary />
        </CardContent>
      </Card>

      <LicenseSection term={term} onTerm={setTerm} />
    </div>
  )
}

function LicenseSection({
  term,
  onTerm,
}: {
  term: LicenseTerm
  onTerm: (term: LicenseTerm) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Self-host licenses
          </h2>
          <p className="text-muted-foreground text-sm">
            For teams that already run ClickHouse. Honor system — no license
            key. Invoice via Polar.
          </p>
        </div>
        <div className="bg-muted inline-flex rounded-lg p-0.5">
          {(['yearly', 'lifetime'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onTerm(value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium capitalize',
                term === value
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>

      <div className="grid items-stretch gap-4 md:grid-cols-3">
        {LICENSE_SKU_LIST.map((sku) => {
          const paid = sku.yearlyUsd > 0
          const price = licensePriceUsd(sku, term)
          return (
            <Card
              key={sku.id}
              className={cn(
                'flex flex-col',
                sku.highlight && 'ring-primary/30 ring-1'
              )}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {sku.displayName}
                  {sku.highlight ? (
                    <Badge variant="secondary">Popular</Badge>
                  ) : null}
                </CardTitle>
                <CardDescription>{sku.tagline}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <p className="text-2xl font-semibold tabular-nums tracking-tight">
                  {price === 0 ? '$0' : `$${price.toLocaleString()}`}
                  {price > 0 ? (
                    <span className="text-muted-foreground text-sm font-normal">
                      {term === 'lifetime' ? ' once' : ' / year'}
                    </span>
                  ) : null}
                </p>
                <p className="text-muted-foreground text-xs">
                  {licenseHostsLabel(sku)}
                </p>
                <ul className="text-muted-foreground flex-1 space-y-1.5 text-sm">
                  {sku.highlights.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {paid && sku.id !== 'personal' ? (
                  <Button
                    className="w-full"
                    render={
                      <a href={licenseCheckoutHref(sku.id, term)}>
                        Buy {sku.name}
                      </a>
                    }
                  />
                ) : (
                  <Button
                    variant="outline"
                    className="w-full"
                    render={
                      <a
                        href={PERSONAL_SELFHOST_HREF}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Self-host docs
                        <ExternalLinkIcon className="size-4" />
                      </a>
                    }
                  />
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
      <p className="text-muted-foreground text-center text-xs">
        After payment, register your company on{' '}
        <a
          href="https://chmonitor.dev/license/register"
          className="text-foreground underline underline-offset-2"
        >
          chmonitor.dev/license/register
        </a>
        . Need a PO?{' '}
        <a
          href="mailto:hello@chmonitor.dev"
          className="text-foreground underline underline-offset-2"
        >
          hello@chmonitor.dev
        </a>
      </p>
    </div>
  )
}

function BillingSignedOut({
  term,
  onTerm,
}: {
  term: LicenseTerm
  onTerm: (term: LicenseTerm) => void
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-8 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-muted-foreground text-sm">
          Hosted Cloud is free. Buy a license if you self-host.
        </p>
      </div>

      <Card className="overflow-hidden py-0">
        <div className="from-primary/[0.06] bg-gradient-to-b to-transparent">
          <CardContent className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="bg-primary/10 flex size-12 items-center justify-center rounded-full">
              <SparklesIcon className="text-primary size-5" strokeWidth={2} />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold tracking-tight">
                Sign in to use Cloud
              </h2>
              <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
                Create a free account to connect ClickHouse on the hosted
                dashboard. No card. Licenses below are for self-hosting.
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
                    href="https://docs.chmonitor.dev/operate/advanced/commercial-license"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    License docs <ExternalLinkIcon className="size-4" />
                  </a>
                }
              />
            </div>
          </CardContent>
        </div>
      </Card>

      <LicenseSection term={term} onTerm={onTerm} />
    </div>
  )
}

function BillingRoute() {
  if (!isCloudModeClient()) return <CloudOnlyNotice feature="Billing" />
  return <BillingPage />
}

export const Route = createFileRoute('/(dashboard)/billing')({
  component: BillingRoute,
})
