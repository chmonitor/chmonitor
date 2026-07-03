'use client'

import { trackEvent } from './analytics'
import { useUser } from '@clerk/tanstack-react-start'
import { useEffect, useRef } from 'react'

// A freshly created Clerk account is treated as "signup" if the session
// starts within this window of account creation — distinguishes a brand-new
// signup from a returning sign-in without needing a server-side webhook hop.
// Approximate by design; fine for a funnel signal.
const RECENT_SIGNUP_WINDOW_MS = 2 * 60 * 1000
const SESSION_FLAG = 'chm_signup_tracked'

/**
 * Fires the `signup` funnel event once per browser session when a Clerk user
 * whose account was JUST created loads the app — i.e. this is their first
 * session, not a returning sign-in.
 *
 * IMPORTANT: calls Clerk's `useUser()`, which requires a mounted
 * `<ClerkProvider />`. Only render this when `isClerkClientEnabled()` is true
 * (mirrors `UserConnectionsCacheGuard` in __root.tsx).
 */
export function SignupAnalyticsTracker() {
  const { isSignedIn, user } = useUser()
  const checked = useRef(false)

  useEffect(() => {
    if (!isSignedIn || !user?.createdAt || checked.current) return
    checked.current = true

    if (sessionStorage.getItem(SESSION_FLAG)) return

    const age = Date.now() - user.createdAt.getTime()
    if (age >= 0 && age < RECENT_SIGNUP_WINDOW_MS) {
      trackEvent('signup')
    }
    sessionStorage.setItem(SESSION_FLAG, '1')
  }, [isSignedIn, user])

  return null
}
