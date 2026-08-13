'use client'

/**
 * Sign in with AnyRouter — client side of the popup OAuth flow.
 *
 * The server routes under `/api/v1/agents/anyrouter/*` run the PKCE exchange
 * and hand back a short-lived AnyRouter token. That token is a spendable
 * credential, so it is deliberately kept **client-side only**: stored in
 * localStorage and replayed per request through the existing BYOK `apiKey`
 * body field (`lib/ai/agent/byok.ts`), which is never persisted server-side.
 *
 * This is additive — a deployment with `ANYROUTER_API_KEY` set works exactly
 * as before and never needs to sign in.
 */

import { useCallback, useEffect, useState } from 'react'

const TOKEN_STORAGE_KEY = 'clickhouse-monitor-anyrouter-token'
/** Fired on the window whenever the stored credential is set or cleared. */
export const ANYROUTER_TOKEN_CHANGE_EVENT =
  'clickhouse-monitor-anyrouter-token-changed'

/** Message posted by the callback page in the popup. */
const SIGNIN_MESSAGE_TYPE = 'chm:anyrouter-signin'

/** How often to check whether the user closed the popup. */
const POPUP_POLL_INTERVAL_MS = 500
/** Grace period after a close, so a just-posted success message still wins. */
const POPUP_CLOSE_GRACE_MS = 300

export interface AnyRouterCredential {
  token: string
  /** Unix ms expiry reported by AnyRouter, when known. */
  expiresAt?: number
}

function isExpired(credential: AnyRouterCredential): boolean {
  return (
    typeof credential.expiresAt === 'number' &&
    credential.expiresAt <= Date.now()
  )
}

/**
 * Read the stored AnyRouter credential.
 *
 * @returns The credential, or `null` when absent, unreadable, or expired
 */
export function getAnyRouterCredential(): AnyRouterCredential | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as AnyRouterCredential).token !== 'string'
    ) {
      return null
    }
    const credential = parsed as AnyRouterCredential
    if (isExpired(credential)) {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
      return null
    }
    return credential
  } catch {
    return null
  }
}

/** Bearer token to send as the per-request BYOK key, if signed in. */
export function getAnyRouterToken(): string | null {
  return getAnyRouterCredential()?.token ?? null
}

function storeCredential(credential: AnyRouterCredential | null): void {
  if (typeof window === 'undefined') return
  try {
    if (credential) {
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(credential))
    } else {
      localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // localStorage may be disabled — sign-in simply does not persist
  }
  window.dispatchEvent(new CustomEvent(ANYROUTER_TOKEN_CHANGE_EVENT))
}

interface SignInMessage {
  type: typeof SIGNIN_MESSAGE_TYPE
  ok: boolean
  token?: string
  expiresAt?: number
  error?: string
}

function isSignInMessage(data: unknown): data is SignInMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as SignInMessage).type === SIGNIN_MESSAGE_TYPE
  )
}

export interface UseAnyRouterTokenResult {
  credential: AnyRouterCredential | null
  isSignedIn: boolean
  /** True while the popup is open and we are awaiting the callback. */
  isSigningIn: boolean
  /** Last sign-in failure, cleared when a new attempt starts. */
  error: string | null
  signIn: () => void
  signOut: () => void
}

/**
 * Manage a browser-held AnyRouter credential obtained via the popup sign-in.
 *
 * Opens the popup, waits for the callback page's `postMessage`, and persists
 * the resulting token. Multiple components stay in sync via a window event.
 */
export function useAnyRouterToken(): UseAnyRouterTokenResult {
  const [credential, setCredential] = useState<AnyRouterCredential | null>(() =>
    getAnyRouterCredential()
  )
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setCredential(getAnyRouterCredential())
    window.addEventListener(ANYROUTER_TOKEN_CHANGE_EVENT, handler)
    return () =>
      window.removeEventListener(ANYROUTER_TOKEN_CHANGE_EVENT, handler)
  }, [])

  const signIn = useCallback(() => {
    if (typeof window === 'undefined') return

    setError(null)
    setIsSigningIn(true)

    // Open the popup synchronously — browsers block a window opened after an
    // await, since it no longer counts as a user gesture.
    const popup = window.open(
      '',
      'chm-anyrouter-signin',
      'width=520,height=720'
    )
    if (!popup) {
      setIsSigningIn(false)
      setError('Popup blocked — allow popups for this site and try again')
      return
    }

    // Watch for the user closing the popup without finishing: no message ever
    // arrives, so without this the button stays disabled until a reload.
    let closedPoll: ReturnType<typeof setInterval> | undefined
    const cleanup = () => {
      window.removeEventListener('message', onMessage)
      if (closedPoll !== undefined) clearInterval(closedPoll)
      setIsSigningIn(false)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      if (!isSignInMessage(event.data)) return

      cleanup()

      if (event.data.ok && event.data.token) {
        storeCredential({
          token: event.data.token,
          expiresAt: event.data.expiresAt,
        })
        return
      }
      setError(event.data.error ?? 'AnyRouter sign-in failed')
    }
    window.addEventListener('message', onMessage)

    closedPoll = setInterval(() => {
      if (!popup.closed) return
      if (closedPoll !== undefined) clearInterval(closedPoll)
      // The callback page posts its message and then closes itself, so give
      // that message a moment to land before calling this a cancellation.
      setTimeout(() => {
        if (getAnyRouterCredential()) {
          cleanup()
          return
        }
        cleanup()
        setError('Sign-in cancelled')
      }, POPUP_CLOSE_GRACE_MS)
    }, POPUP_POLL_INTERVAL_MS)

    void (async () => {
      try {
        const response = await fetch('/api/v1/agents/anyrouter/login')
        if (!response.ok) {
          throw new Error(`Sign-in unavailable (${response.status})`)
        }
        const data = (await response.json()) as { authorizeUrl?: string }
        if (!data.authorizeUrl) throw new Error('Sign-in unavailable')
        popup.location.href = data.authorizeUrl
      } catch (cause) {
        popup.close()
        cleanup()
        setError(cause instanceof Error ? cause.message : 'Sign-in failed')
      }
    })()
  }, [])

  const signOut = useCallback(() => {
    storeCredential(null)
    setError(null)
  }, [])

  return {
    credential,
    isSignedIn: credential !== null,
    isSigningIn,
    error,
    signIn,
    signOut,
  }
}
