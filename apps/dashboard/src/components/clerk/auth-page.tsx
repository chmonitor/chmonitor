import { KeyRound } from 'lucide-react'

import type { ReactNode } from 'react'

import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { ClerkSignUpButton as ClerkSignUpButtonImpl } from '@/components/clerk/clerk-sign-up-button'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
import { WelcomeIllustration } from '@/components/illustrations/welcome-illustration'
import { Button } from '@/components/ui/button'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'

/**
 * Clerk's modal buttons need a mounted `<ClerkProvider />`. Gate them behind
 * the build-time `isClerkEnabled()` constant so non-Clerk (self-hosted) builds
 * render the HTML fallback instead.
 */
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

const ClerkSignUpButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignUpButtonImpl : null

export type AuthPageMode = 'sign-in' | 'sign-up'

/**
 * Human auth entry at `/sign-in` and `/sign-up`.
 *
 * Cloud (Clerk on): the same modal sign-in/up UI used in the sidebar.
 * OSS / Clerk off: explicit HTML pointing at the dashboard Sign in control.
 * This page must stay `text/html` — agent markdown lives at `/auth.md`.
 */
export function AuthPage({ mode }: { mode: AuthPageMode }) {
  const isSignIn = mode === 'sign-in'
  const title = isSignIn ? 'Sign in' : 'Create an account'
  const subtitle = isSignIn
    ? 'Sign in to connect your ClickHouse cluster and save your hosts.'
    : 'Create an account to connect your ClickHouse cluster and save your hosts.'
  const ClerkButton = isSignIn ? ClerkSignInButton : ClerkSignUpButton
  const cta = isSignIn ? 'Sign in' : 'Sign up'
  const altHref = isSignIn ? '/sign-up' : '/sign-in'
  const altLabel = isSignIn
    ? 'Need an account? Sign up'
    : 'Already have an account? Sign in'

  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center px-4 py-16"
      data-testid={isSignIn ? 'sign-in-page' : 'sign-up-page'}
    >
      <div className="w-full max-w-md space-y-7">
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

        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-5 shadow-sm">
          {ClerkButton ? (
            <ClerkButton>
              <Button
                size="lg"
                className="w-full"
                data-testid={`${mode}-submit`}
              >
                <KeyRound className="size-4" />
                {cta}
              </Button>
            </ClerkButton>
          ) : (
            <p
              className="text-center text-sm text-muted-foreground"
              data-testid="auth-page-fallback"
            >
              Use the Sign in control in the dashboard sidebar.
            </p>
          )}
          {ClerkButton ? (
            <a
              href={altHref}
              className="text-center text-xs text-muted-foreground hover:text-foreground"
            >
              {altLabel}
            </a>
          ) : null}
          <a
            href="/overview?host=0"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-[13px] font-medium hover:bg-muted"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  )
}
