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
 *
 * When `agent.anyrouterSignin` is on (`GET /api/v1/config`), a user signed in
 * to chmonitor also gets the token saved to their account
 * (`/api/v1/agents/anyrouter/token`) so the agent can use it from any device.
 * That route answers 401 for guests, 404 when the flag is off and 503 when
 * storage is unavailable — every one of those just means "browser only".
 */

import { toast } from 'sonner'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ANYROUTER_TOKEN_EXPIRED_CODE } from '@/lib/ai/agent/errors'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'

const TOKEN_STORAGE_KEY = 'clickhouse-monitor-anyrouter-token'
/** Fired on the window whenever the stored credential is set or cleared. */
export const ANYROUTER_TOKEN_CHANGE_EVENT =
  'clickhouse-monitor-anyrouter-token-changed'

/** Message posted by the callback page in the popup. */
const SIGNIN_MESSAGE_TYPE = 'chm:anyrouter-signin'

/** Account-side token store for users signed in to chmonitor. */
const SERVER_TOKEN_URL = '/api/v1/agents/anyrouter/token'

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
  emitChange()
}

function emitChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ANYROUTER_TOKEN_CHANGE_EVENT))
}

/** What the account-side token route reports. The token itself never comes back. */
export interface AnyRouterServerStatus {
  connected: boolean
  /** Unix ms expiry, when known. */
  expiresAt: number | null
}

// Shared across every hook instance in the tab, like the localStorage token.
let serverStatus: AnyRouterServerStatus | null = null
let serverProbe: Promise<void> | null = null
let expiredNotice = false

/** Test-only: forget the shared account status between cases. */
export function resetAnyRouterServerStateForTests(): void {
  serverStatus = null
  serverProbe = null
  expiredNotice = false
}

function setServerStatus(next: AnyRouterServerStatus | null): void {
  serverStatus = next
  emitChange()
}

/**
 * Ask whether this chmonitor account has a stored AnyRouter token. Any
 * non-200 (guest, flag off, storage down, network) means "no".
 */
export async function fetchAnyRouterServerStatus(): Promise<void> {
  try {
    const response = await fetch(SERVER_TOKEN_URL, {
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response.ok) return setServerStatus(null)
    const data = (await response.json()) as Partial<AnyRouterServerStatus>
    setServerStatus(
      data.connected === true
        ? {
            connected: true,
            expiresAt:
              typeof data.expiresAt === 'number' ? data.expiresAt : null,
          }
        : null
    )
  } catch {
    setServerStatus(null)
  }
}

/** Save a fresh token to the account. Failures leave it browser-only. */
export async function saveAnyRouterTokenToServer(
  credential: AnyRouterCredential
): Promise<void> {
  try {
    const response = await fetch(SERVER_TOKEN_URL, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: credential.token,
        expiresAt: credential.expiresAt ?? null,
      }),
    })
    if (response.ok) {
      setServerStatus({
        connected: true,
        expiresAt: credential.expiresAt ?? null,
      })
    }
  } catch {
    // Network failure — the browser copy still works.
  }
}

/** Remove the account copy. Idempotent; a guest's 401 is fine. */
export async function deleteAnyRouterServerToken(): Promise<void> {
  setServerStatus(null)
  try {
    await fetch(SERVER_TOKEN_URL, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
  } catch {
    // Nothing to do — the next GET will tell the truth.
  }
}

/**
 * True for the agent route's `anyrouter_token_expired` error, in any shape the
 * runtime hands it over: the `AgentError` object, a `{ error: AgentError }`
 * body, or an `Error` whose message is that JSON body.
 */
export function isAnyRouterTokenExpiredError(value: unknown): boolean {
  if (value instanceof Error) {
    return value.message.includes(ANYROUTER_TOKEN_EXPIRED_CODE)
  }
  if (typeof value === 'string') {
    return value.includes(ANYROUTER_TOKEN_EXPIRED_CODE)
  }
  if (typeof value !== 'object' || value === null) return false
  const record = value as { code?: unknown; error?: unknown }
  if (record.code === ANYROUTER_TOKEN_EXPIRED_CODE) return true
  return (
    typeof record.error === 'object' &&
    record.error !== null &&
    (record.error as { code?: unknown }).code === ANYROUTER_TOKEN_EXPIRED_CODE
  )
}

/**
 * AnyRouter rejected the token: drop the browser and account copies so the
 * next message does not fail the same way, and ask the user to sign in again.
 */
export function handleAnyRouterTokenExpired(): void {
  if (expiredNotice) return
  expiredNotice = true
  storeCredential(null)
  void deleteAnyRouterServerToken()
  toast.error('Your AnyRouter sign-in expired', {
    id: 'anyrouter-token-expired',
    description: 'Sign in with AnyRouter again to keep using your credits.',
  })
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
  /** True with a browser token, or with a token stored on the account. */
  isSignedIn: boolean
  /** Where the active token lives. */
  connectedVia: 'browser' | 'account' | null
  /** Unix ms expiry of the active token, when known. */
  expiresAt: number | null
  /** AnyRouter rejected the last token — prompt to sign in again. */
  expired: boolean
  /** `agent.anyrouterSignin` from `/api/v1/config`. */
  signinEnabled: boolean
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
  const [server, setServer] = useState(serverStatus)
  const [expired, setExpired] = useState(expiredNotice)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const signinEnabled =
    useFeaturePermissions().config.agent?.anyrouterSignin === true
  const signinEnabledRef = useRef(signinEnabled)
  signinEnabledRef.current = signinEnabled

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      setCredential(getAnyRouterCredential())
      setServer(serverStatus)
      setExpired(expiredNotice)
    }
    window.addEventListener(ANYROUTER_TOKEN_CHANGE_EVENT, handler)
    return () =>
      window.removeEventListener(ANYROUTER_TOKEN_CHANGE_EVENT, handler)
  }, [])

  // No browser token: the account may still hold one (signed in on another
  // device). Ask once per tab; the token itself is never fetched — the agent
  // route reads it server-side.
  useEffect(() => {
    if (!signinEnabled || serverProbe || getAnyRouterCredential()) return
    serverProbe = fetchAnyRouterServerStatus()
  }, [signinEnabled])

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
        const next: AnyRouterCredential = {
          token: event.data.token,
          expiresAt: event.data.expiresAt,
        }
        expiredNotice = false
        storeCredential(next)
        if (signinEnabledRef.current) void saveAnyRouterTokenToServer(next)
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
    expiredNotice = false
    storeCredential(null)
    setError(null)
    if (signinEnabledRef.current || serverStatus) {
      void deleteAnyRouterServerToken()
    }
  }, [])

  const connectedVia = credential
    ? 'browser'
    : server?.connected
      ? 'account'
      : null

  return {
    credential,
    isSignedIn: connectedVia !== null,
    connectedVia,
    expiresAt:
      credential?.expiresAt ??
      (connectedVia === 'account' ? (server?.expiresAt ?? null) : null),
    expired,
    signinEnabled,
    isSigningIn,
    error,
    signIn,
    signOut,
  }
}
