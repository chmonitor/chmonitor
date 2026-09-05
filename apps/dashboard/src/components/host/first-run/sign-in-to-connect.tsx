import { KeyRound } from 'lucide-react'

import type { ReactNode } from 'react'

import { DocsFooter } from './docs-footer'
import { WelcomeHeader } from './welcome-header'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { Button } from '@/components/ui/button'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'

// Clerk's SignInButton needs a mounted <ClerkProvider>. Gate it behind the
// build-time constant so non-Clerk (self-hosted) builds render null instead.
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

export function SignInToConnect() {
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
