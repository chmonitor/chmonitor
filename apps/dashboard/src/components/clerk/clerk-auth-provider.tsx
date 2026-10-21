import type { ReactNode } from 'react'

import { clerkAppearance } from './clerk-appearance'
import { ClerkProvider } from '@clerk/tanstack-react-start'
import {
  CLERK_PUBLISHABLE_KEY,
  isClerkClientEnabled,
} from '@/lib/clerk/clerk-client'

// Conditionally mounts Clerk's <ClerkProvider> ONLY when isClerkClientEnabled() is
// true. When disabled, children render untouched and <ClerkProvider> is never
// instantiated - so non-Clerk builds never reach into Clerk's runtime, and any
// Clerk hook (useUser/useClerk), which MUST be gated behind the same
// isClerkClientEnabled() flag at its call site, is never invoked outside a provider.
//
// isClerkClientEnabled() is a build-time constant (both inputs are import.meta.env),
// so a non-Clerk build tree-shakes this down to `return children`.
//
// NOTE: this is the ONLY place that should import @clerk/tanstack-react-start
// unconditionally. Every other Clerk hook/component import must sit behind a
// lazy require/dynamic import guarded by isClerkClientEnabled() (mirroring the Next
// app's nav-user.tsx / agent-thread-page.tsx pattern).
interface ClerkAuthProviderProps {
  children: ReactNode
}

export function ClerkAuthProvider({ children }: ClerkAuthProviderProps) {
  if (!isClerkClientEnabled()) {
    return children
  }

  // Pass the key explicitly so the gate's check and Clerk's init read the same
  // value. Clerk also auto-reads VITE_CLERK_PUBLISHABLE_KEY, but being explicit
  // keeps the contract self-documenting and decoupled from Clerk's lookup order.
  return (
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY}
      appearance={clerkAppearance}
    >
      {children}
    </ClerkProvider>
  )
}
