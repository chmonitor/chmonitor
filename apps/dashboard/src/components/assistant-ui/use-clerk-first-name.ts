'use client'

import { useUser } from '@clerk/tanstack-react-start'

/**
 * IMPORTANT: This calls Clerk's `useUser()`, which throws when no
 * `<ClerkProvider />` is mounted. It MUST only be imported/invoked when
 * `isClerkEnabled()` is true. The consumer gates this behind a build-time
 * conditional `require` (see `agent-thread-page.tsx`), mirroring
 * `components/nav-user.tsx`.
 */
export function useClerkFirstName(): string | null {
  const { user } = useUser()
  return (
    user?.firstName ??
    (user?.fullName ? user.fullName.split(' ')[0] : null) ??
    null
  )
}
