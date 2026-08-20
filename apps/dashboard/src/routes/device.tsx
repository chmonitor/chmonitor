/**
 * Device authorization page for `chm auth login`.
 * Route: /device?user_code=ABCD-EFGH
 *
 * Cloud / Clerk / proxy: signed-in users approve; anonymous visitors are
 * pointed at /sign-in.
 *
 * Self-hosted device-only (`CHM_AUTH_PROVIDER=none` + `CHM_DEVICE_LOGIN=true`):
 * anyone who can reach this page may approve (trusted network).
 *
 * When device login is disabled (OSS default), show how to opt in or mint a key.
 */

import { createFileRoute, Link } from '@tanstack/react-router'
import { type FormEvent, useEffect, useState } from 'react'

import {
  keepHostSearch,
  validateSearch as validateRootSearch,
} from './-root-search'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type DeviceSearch = {
  host: number
  user_code?: string
}

type DeviceStatus = {
  enabled: boolean
  mode: string
  deviceOnly: boolean
  reason: string | null
  store?: string
  subject?: string
}

function validateDeviceSearch(search: Record<string, unknown>): DeviceSearch {
  const root = validateRootSearch(search)
  const raw = search.user_code
  if (typeof raw === 'string' && raw.trim()) {
    return { ...root, user_code: raw.trim().toUpperCase() }
  }
  return root
}

export const Route = createFileRoute('/device')({
  component: DeviceApprovePage,
  validateSearch: validateDeviceSearch,
  head: () => ({
    meta: [{ title: 'Approve device — chmonitor' }],
  }),
})

function DeviceApprovePage() {
  const { user_code: initialCode } = Route.useSearch()
  const [userCode, setUserCode] = useState(initialCode ?? '')
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>(
    'idle'
  )
  const [message, setMessage] = useState<string | null>(null)
  const [deviceStatus, setDeviceStatus] = useState<DeviceStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/v1/auth/device/status')
        const body = (await res.json().catch(() => ({}))) as {
          data?: DeviceStatus
          enabled?: boolean
          mode?: string
          deviceOnly?: boolean
          reason?: string | null
          store?: string
          subject?: string
        }
        if (cancelled) return
        const data = body.data ?? body
        setDeviceStatus({
          enabled: Boolean(data.enabled),
          mode: typeof data.mode === 'string' ? data.mode : 'auto',
          deviceOnly: Boolean(data.deviceOnly),
          reason: data.reason ?? null,
          store: data.store,
          subject: data.subject,
        })
      } catch {
        if (!cancelled) {
          setDeviceStatus({
            enabled: false,
            mode: 'auto',
            deviceOnly: false,
            reason: 'unavailable',
          })
        }
      } finally {
        if (!cancelled) setStatusLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const code = userCode.trim().toUpperCase()
    if (!code) {
      setStatus('error')
      setMessage('Enter the code shown in your terminal.')
      return
    }

    setStatus('loading')
    setMessage(null)
    try {
      const res = await fetch('/api/v1/auth/device/approve', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user_code: code }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        message?: string
      }
      if (!res.ok) {
        setStatus('error')
        if (res.status === 401) {
          setMessage('Sign in first, then approve this device.')
        } else if (res.status === 503) {
          setMessage(
            body.error ??
              'Device login is disabled on this deployment. See docs for CHM_DEVICE_LOGIN.'
          )
        } else {
          setMessage(
            body.message ?? body.error ?? `Approve failed (${res.status})`
          )
        }
        return
      }
      setStatus('ok')
      setMessage('Device approved. You can return to the CLI.')
    } catch {
      setStatus('error')
      setMessage('Network error — try again.')
    }
  }

  if (statusLoading) {
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-4 px-4 py-12">
        <p className="text-sm text-muted-foreground">Checking device login…</p>
      </main>
    )
  }

  if (deviceStatus && !deviceStatus.enabled) {
    const missingSecret = deviceStatus.reason === 'missing_api_key_secret'
    return (
      <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            Device login is off
          </h1>
          <p className="text-sm text-muted-foreground">
            {missingSecret
              ? 'Set CHM_API_KEY_SECRET on the server, then enable device login.'
              : 'Self-hosted deployments leave CLI device login disabled by default (trusted internal networks usually mint an API key once).'}
          </p>
        </div>
        <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Enable on self-hosted</p>
          <pre className="overflow-x-auto text-xs leading-relaxed">
            {`CHM_API_KEY_SECRET=…
CHM_DEVICE_LOGIN=true
# optional when CHM_AUTH_PROVIDER=none:
# CHM_DEVICE_LOGIN_SUBJECT=self-hosted`}
          </pre>
          <p className="text-muted-foreground">
            Or mint a key without device flow:{' '}
            <code className="text-xs">POST /api/v1/auth/api-key</code> with the
            signing secret as Bearer.
          </p>
        </div>
      </main>
    )
  }

  const deviceOnly = deviceStatus?.deviceOnly === true

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Approve CLI device
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter the code from <code className="text-xs">chm auth login</code> to
          authorize this device.
          {deviceOnly
            ? ' This deployment uses device-only tokens (no sign-in) — anyone who can reach this page can approve.'
            : ' You must be signed in.'}
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="user_code">
          Device code
        </label>
        <Input
          id="user_code"
          name="user_code"
          autoComplete="one-time-code"
          placeholder="ABCD-EFGH"
          value={userCode}
          onChange={(e) => setUserCode(e.target.value.toUpperCase())}
          className="font-mono tracking-widest"
        />
        <Button type="submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Approving…' : 'Approve'}
        </Button>
      </form>

      {message ? (
        <p
          className={
            status === 'ok'
              ? 'text-sm text-green-700 dark:text-green-400'
              : 'text-sm text-destructive'
          }
          role="status"
        >
          {message}
        </p>
      ) : null}

      {!deviceOnly ? (
        <p className="text-sm text-muted-foreground">
          Not signed in?{' '}
          <Link
            to="/sign-in"
            search={keepHostSearch}
            className="underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Tokens are bound to subject{' '}
          <code className="text-xs">
            {deviceStatus?.subject ?? 'self-hosted'}
          </code>
          .
        </p>
      )}
    </main>
  )
}
