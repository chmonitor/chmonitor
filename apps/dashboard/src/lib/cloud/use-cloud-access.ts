import { useUser } from '@clerk/tanstack-react-start'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'

/**
 * Whether this visitor may read per-owner data.
 * - `open`: self-hosted, or signed in on cloud. Fetch as usual.
 * - `guest`: signed out on cloud. The API answers 401, so skip the read and
 *   show a sign-in prompt.
 * - `pending`: cloud, Clerk still loading. Fetch nothing and show no prompt,
 *   so a signed-in user never sees the prompt flash.
 */
export type CloudAccess = 'open' | 'guest' | 'pending'

function useClerkAccess(): CloudAccess {
  const { isLoaded, isSignedIn } = useUser()
  if (!isLoaded) return 'pending'
  return isSignedIn ? 'open' : 'guest'
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
