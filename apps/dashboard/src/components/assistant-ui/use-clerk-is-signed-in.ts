'use client'

import { useUser } from '@clerk/tanstack-react-start'

/**
 * IMPORTANT: this calls Clerk's `useUser()`, which throws unless a
 * `<ClerkProvider />` is mounted. It MUST only be imported/invoked when
 * `isClerkEnabled()` is true — the consumer gates it behind the build-time
 * constant (mirrors `use-clerk-first-name.ts`).
 */
export function useClerkIsSignedIn(): boolean {
  const { isSignedIn } = useUser()
  return Boolean(isSignedIn)
}
