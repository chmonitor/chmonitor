import { LockKeyholeIcon } from 'lucide-react'

import type { ReactNode } from 'react'

import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { Button } from '@/components/ui/button'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'

// Clerk's SignInButton needs a mounted <ClerkProvider>; same build-time gate as
// SignInToConnect so non-Clerk builds render no sign-in action.
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

/** Shown when the PeerDB API answers 401: PeerDB is set up, the visitor is signed out. */
export function PeerDBSignInRequired() {
  return (
    <div
      className="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-lg border border-dashed p-10 text-center"
      data-testid="peerdb-sign-in-required"
    >
      <LockKeyholeIcon className="size-8 text-muted-foreground" />
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Sign in to view PeerDB</h2>
        <p className="text-sm text-muted-foreground">
          Mirrors and peers are shown to signed-in users. Sign in to continue.
        </p>
      </div>
      {ClerkSignInButton ? (
        <ClerkSignInButton>
          <Button>Sign in</Button>
        </ClerkSignInButton>
      ) : null}
    </div>
  )
}
