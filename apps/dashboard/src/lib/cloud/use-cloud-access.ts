import { useClerk, useUser } from '@clerk/tanstack-react-start'
import { useEffect, useState } from 'react'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'

/**
 * Whether this visitor may read per-owner data.
 * - `open`: self-hosted, or signed in on cloud. Fetch as usual.
 * - `guest`: signed out on cloud. The API answers 401, so skip the read and
 *   show a sign-in prompt.
 * - `pending`: cloud, Clerk still loading. Fetch nothing and show no prompt,
 *   so a signed-in user never sees the prompt flash. Clerk that errors or
 *   stays loading past `CLERK_LOAD_TIMEOUT_MS` (blocked script, CDN failure)
 *   counts as `guest`, so the sign-in prompt shows instead of a blank page.
 */
export type CloudAccess = 'open' | 'guest' | 'pending'

export const CLERK_LOAD_TIMEOUT_MS = 8_000

function useClerkAccess(): CloudAccess {
  const { isLoaded, isSignedIn } = useUser()
  const { status } = useClerk()
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    if (isLoaded) {
      setTimedOut(false)
      return
    }
    const timer = setTimeout(() => setTimedOut(true), CLERK_LOAD_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isLoaded])
  if (isLoaded) return isSignedIn ? 'open' : 'guest'
  return timedOut || status === 'error' ? 'guest' : 'pending'
}

// Clerk's useUser() throws without a ClerkProvider, so a non-Clerk build never
// calls it; a cloud build without Clerk has no way to sign in.
const useCloudClerkAccess: () => CloudAccess = isClerkEnabled()
  ? useClerkAccess
  : () => 'guest'

export function useCloudAccess(): CloudAccess {
  const access = useCloudClerkAccess()
  return isCloudModeClient() ? access : 'open'
}
