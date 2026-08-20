/**
 * Device authorization page for `chm auth login`.
 * Route: /device?user_code=ABCD-EFGH
 *
 * Signed-in users submit the code to POST /api/v1/auth/device/approve.
 * Anonymous visitors are pointed at /sign-in.
 */

import { createFileRoute, Link } from '@tanstack/react-router'

import {
  keepHostSearch,
  validateSearch as validateRootSearch,
} from './-root-search'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type DeviceSearch = {
  host: number
  user_code?: string
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

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center gap-6 px-4 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Approve CLI device
        </h1>
        <p className="text-sm text-muted-foreground">
          Enter the code from <code className="text-xs">chm auth login</code> to
          authorize this device. You must be signed in.
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
    </main>
  )
}
