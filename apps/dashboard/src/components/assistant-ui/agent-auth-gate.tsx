'use client'

import { LockKeyholeIcon } from 'lucide-react'

import { useClerkIsSignedIn as useClerkIsSignedInImpl } from './use-clerk-is-signed-in'
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useMemo,
  useState,
} from 'react'
import { ClerkSignInButton as ClerkSignInButtonImpl } from '@/components/clerk/clerk-sign-in-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { isCloudModeClient } from '@/lib/cloud/cloud-mode'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { AGENT_FEATURE_PERMISSION } from '@/lib/feature-permissions/permissions'
import { resolveFeatureState } from '@/lib/feature-permissions/shared'

/**
 * Clerk's `SignInButton` requires a mounted `<ClerkProvider />`. Gate it behind
 * the build-time `isClerkEnabled()` constant so it is only rendered when Clerk is
 * active; when Clerk is off the value is null and the dialog renders without a
 * sign-in action. The import is inert (the Clerk hook only runs on render), and a
 * static ESM import replaces `require()`, undefined in the Vite/ESM runtime.
 */
const ClerkSignInButton:
  | ((props: { children: ReactNode }) => ReactNode)
  | null = isClerkEnabled() ? ClerkSignInButtonImpl : null

/**
 * Runtime "is the user signed in?" check. Clerk's `useUser()` is the only source
 * of truth for this — the workerd config endpoint can't run `auth()`, so it always
 * reports an anonymous principal. Gated behind the same build-time constant: when
 * Clerk is off there is no sign-in, so the stub returns `true` and no prompt is
 * ever shown — the backend stays the security boundary.
 */
const useClerkIsSignedIn: () => boolean = isClerkEnabled()
  ? useClerkIsSignedInImpl
  : () => true

interface AgentAuthGateValue {
  /**
   * Call before an auth-requiring interaction (e.g. sending a message).
   * Returns true if the user may proceed; otherwise opens the sign-in dialog
   * and returns false so the caller can abort.
   */
  ensureAuthed: () => boolean
}

const AgentAuthGateContext = createContext<AgentAuthGateValue | null>(null)

/**
 * Renders the agent chat UI for everyone (the route is interaction-gated, see
 * `feature-route-gate.tsx`) and prompts for sign-in only when an
 * auth-requiring action is attempted.
 */
export function AgentAuthGate({ children }: { children: ReactNode }) {
  const { config, isLoading } = useFeaturePermissions()
  const signedIn = useClerkIsSignedIn()
  const [open, setOpen] = useState(false)

  // Does the agent feature actually require auth in this deployment? (operators
  // can set CHM_FEATURE_AGENT_ACCESS=public). `signedIn` already accounts for the
  // auth provider: it is always true when Clerk is disabled (none/proxy), so the
  // prompt only appears for a Clerk deployment whose visitor is not signed in.
  const requiresAuth =
    resolveFeatureState(AGENT_FEATURE_PERMISSION, config).access ===
    'authenticated'

  const cloudGuest = isCloudModeClient() && !signedIn

  const ensureAuthed = useCallback(() => {
    // Optimistic while the permission config loads — the server still enforces
    // auth on /api/v1/agent regardless.
    if (isLoading) return true
    // Cloud demo guests may chat (server guest allow + quota). OSS Clerk
    // deployments stay gated when access is authenticated.
    if (cloudGuest) return true
    if (!requiresAuth || signedIn) return true
    setOpen(true)
    return false
  }, [isLoading, requiresAuth, signedIn, cloudGuest])

  const value = useMemo<AgentAuthGateValue>(
    () => ({ ensureAuthed }),
    [ensureAuthed]
  )

  return (
    <AgentAuthGateContext.Provider value={value}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="bg-muted mb-2 flex size-12 items-center justify-center rounded-full">
              <LockKeyholeIcon className="text-muted-foreground size-5" />
            </div>
            <DialogTitle>Authentication required</DialogTitle>
            <DialogDescription>
              Sign in to chat with the AI agent. You can keep exploring the
              interface without an account.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep exploring
            </Button>
            {ClerkSignInButton ? (
              <ClerkSignInButton>
                <Button>Sign in</Button>
              </ClerkSignInButton>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AgentAuthGateContext.Provider>
  )
}

/**
 * Access the agent auth gate. Falls back to an always-allow gate when used
 * outside an `AgentAuthGate` (e.g. in isolated tests), so callers never crash.
 */
export function useAgentAuthGate(): AgentAuthGateValue {
  return use(AgentAuthGateContext) ?? { ensureAuthed: () => true }
}
