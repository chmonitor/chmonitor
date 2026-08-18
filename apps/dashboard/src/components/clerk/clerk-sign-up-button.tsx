import type { ReactNode } from 'react'

import { SignUpButton } from '@clerk/tanstack-react-start'

/**
 * Thin wrapper over Clerk's modal `SignUpButton`.
 *
 * IMPORTANT: `SignUpButton` requires a mounted `<ClerkProvider />`, so this
 * module MUST only be imported/rendered when `isClerkEnabled()` is true.
 */
export function ClerkSignUpButton({ children }: { children: ReactNode }) {
  return <SignUpButton mode="modal">{children}</SignUpButton>
}
