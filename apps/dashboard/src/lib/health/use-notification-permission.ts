'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Live browser notification permission.
 *
 * The "Browser notifications" toggle used to reflect only the stored preference
 * (`browserNotificationsEnabled`, which defaults to `true`), so a fresh install
 * showed the switch ON while `Notification.permission` was still `'default'` and
 * nothing was ever delivered. This hook reads the real permission and keeps it
 * in sync, so the card can render the true state.
 *
 * Effect-only — never touches `Notification` during render, because the app
 * prerenders its pages on the server.
 *
 * Sync sources, in order of reliability:
 * 1. `navigator.permissions.query({ name: 'notifications' })` → `onchange`,
 *    which fires when the user flips the site permission in browser UI.
 * 2. `visibilitychange` / `focus` re-reads, as the Safari fallback (Safari has
 *    no `permissions` entry for notifications).
 */
export type NotificationPermissionState =
  /** The browser has no Notification API at all. */
  | 'unsupported'
  /** Supported, permission not asked for yet. */
  | 'default'
  | 'granted'
  | 'denied'

export interface NotificationPermissionInfo {
  state: NotificationPermissionState
  /** Delivery can actually happen right now. */
  canNotify: boolean
  /** The user blocked notifications — only browser settings can undo it. */
  isBlocked: boolean
  /** Ask the browser for permission. Resolves to the resulting state. */
  request: () => Promise<NotificationPermissionState>
}

function readPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported'
  }
  return Notification.permission as NotificationPermissionState
}

export function useNotificationPermission(): NotificationPermissionInfo {
  // Start at 'default' so server and first client render agree; the effect
  // below immediately corrects it to the real value.
  const [state, setState] = useState<NotificationPermissionState>('default')

  useEffect(() => {
    let cancelled = false
    let status: PermissionStatus | undefined

    const sync = () => {
      if (!cancelled) setState(readPermission())
    }

    sync()

    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)

    // Not every browser exposes a 'notifications' permission descriptor
    // (Safari), and querying an unknown name throws — hence the catch.
    navigator.permissions
      ?.query({ name: 'notifications' as PermissionName })
      .then((result) => {
        if (cancelled) return
        status = result
        result.onchange = sync
        sync()
      })
      .catch(() => {
        /* fall back to the focus/visibility listeners above */
      })

    return () => {
      cancelled = true
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
      if (status) status.onchange = null
    }
  }, [])

  const request = useCallback(async () => {
    if (readPermission() === 'unsupported') return 'unsupported' as const
    try {
      const result =
        (await Notification.requestPermission()) as NotificationPermissionState
      setState(result)
      return result
    } catch {
      const current = readPermission()
      setState(current)
      return current
    }
  }, [])

  return {
    state,
    canNotify: state === 'granted',
    isBlocked: state === 'denied',
    request,
  }
}
