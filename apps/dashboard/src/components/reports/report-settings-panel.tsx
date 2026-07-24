/**
 * ReportSettingsPanel — /report-settings body (#2790).
 *
 * One card, three concerns, zero ceremony:
 *  - Schedule: cadence (off / monthly / weekly) + which hosts the report
 *    covers. Weekly shows a plan hint when the caller's plan doesn't allow it
 *    (server enforces it regardless).
 *  - Try it now: "Generate now" builds a fresh report and opens the HTML in a
 *    new tab (works on OSS with zero delivery config); "Send test report"
 *    delivers one immediately through the caller's configured alert channels.
 *  - Delivery goes to the channels configured in /alert-settings — linked, not
 *    duplicated here.
 */

import { DownloadIcon, FileTextIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { ReportCadence } from '@/lib/insights/report-subscription-store'

import { useCallback, useEffect, useState } from 'react'
import { AppLink } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { apiFetch, useHostId } from '@/lib/swr'
import { useHosts } from '@/lib/swr/use-hosts'
import { buildUrl } from '@/lib/url/url-builder'
import { cn } from '@/lib/utils'

interface SubscriptionResponse {
  success: boolean
  subscription: {
    cadence: ReportCadence
    hostIds: number[]
    lastSentAt: number | null
    lastStatus: string | null
  }
  weeklyAllowed: boolean
}

const CADENCE_OPTIONS: {
  value: ReportCadence
  label: string
  description: string
}[] = [
  { value: 'off', label: 'Off', description: 'No scheduled reports' },
  {
    value: 'monthly',
    label: 'Monthly',
    description: '1st of the month, 08:00 UTC — 30-day window',
  },
  {
    value: 'weekly',
    label: 'Weekly',
    description: 'Mondays, 08:00 UTC — 7-day window',
  },
]

export function ReportSettingsPanel() {
  const currentHostId = useHostId()
  const { hosts } = useHosts()

  const [cadence, setCadence] = useState<ReportCadence>('off')
  const [selectedHosts, setSelectedHosts] = useState<Set<number>>(new Set())
  const [weeklyAllowed, setWeeklyAllowed] = useState(true)
  const [lastStatus, setLastStatus] = useState<string | null>(null)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<'generate' | 'test' | 'pdf' | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/api/v1/reports/subscription')
      .then((res) => (res.ok ? res.json() : null))
      .then((raw) => {
        const data = raw as SubscriptionResponse | null
        if (cancelled || !data?.success) return
        setCadence(data.subscription.cadence)
        setSelectedHosts(new Set(data.subscription.hostIds))
        setWeeklyAllowed(data.weeklyAllowed)
        setLastStatus(data.subscription.lastStatus)
        setLastSentAt(data.subscription.lastSentAt)
      })
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const toggleHost = (id: number) => {
    setSelectedHosts((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const save = useCallback(async () => {
    setSaving(true)
    try {
      const res = await apiFetch('/api/v1/reports/subscription', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cadence,
          hostIds: [...selectedHosts],
        }),
      })
      if (res.ok) {
        toast.success(
          cadence === 'off' ? 'Scheduled reports turned off' : 'Schedule saved'
        )
      } else {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string }
        } | null
        toast.error(body?.error?.message ?? `Save failed (${res.status})`)
      }
    } finally {
      setSaving(false)
    }
  }, [cadence, selectedHosts])

  const generateNow = useCallback(async () => {
    setBusy('generate')
    try {
      const res = await apiFetch('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: currentHostId }),
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        html?: string
        error?: { message?: string }
      } | null
      if (!res.ok || !data?.success || !data.html) {
        toast.error(data?.error?.message ?? 'Report generation failed')
        return
      }
      const blob = new Blob([data.html], { type: 'text/html' })
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch {
      toast.error('Report generation failed')
    } finally {
      setBusy(null)
    }
  }, [currentHostId])

  const downloadPdf = useCallback(async () => {
    setBusy('pdf')
    try {
      const res = await apiFetch('/api/v1/reports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: currentHostId, format: 'pdf' }),
      })
      const contentType = res.headers.get('Content-Type') ?? ''
      if (res.ok && contentType.includes('application/pdf')) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `report-host-${currentHostId}.pdf`
        a.click()
        URL.revokeObjectURL(url)
        return
      }
      // Degraded — no Browser Rendering binding or render failed. The server
      // returns the HTML JSON with `X-Report-PDF: unavailable`; open the HTML.
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        html?: string
        error?: { message?: string }
      } | null
      if (!res.ok || !data?.success) {
        toast.error(data?.error?.message ?? 'PDF export unavailable')
        return
      }
      toast.warning('PDF rendering unavailable — opened HTML instead.')
      if (data.html) {
        const blob = new Blob([data.html], { type: 'text/html' })
        window.open(URL.createObjectURL(blob), '_blank', 'noopener')
      }
    } catch {
      toast.error('PDF export failed')
    } finally {
      setBusy(null)
    }
  }, [currentHostId])

  const sendTest = useCallback(async () => {
    setBusy('test')
    try {
      const res = await apiFetch('/api/v1/reports/test-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: currentHostId }),
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        channelConfigured?: boolean
        delivered?: boolean
        channels?: Record<string, boolean>
        error?: { message?: string }
      } | null
      if (!res.ok || !data?.success) {
        toast.error(data?.error?.message ?? 'Test send failed')
        return
      }
      if (!data.channelConfigured) {
        toast.warning('No alert channels configured — set one up first.')
        return
      }
      const parts = Object.entries(data.channels ?? {}).map(
        ([channel, ok]) => `${channel}: ${ok ? 'delivered' : 'failed'}`
      )
      if (data.delivered) {
        toast.success(`Test report sent — ${parts.join(', ')}`)
      } else {
        toast.error(`All channels failed — ${parts.join(', ')}`)
      }
    } finally {
      setBusy(null)
    }
  }, [currentHostId])

  return (
    <div className="space-y-8">
      {/* Schedule */}
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Schedule</h3>
          <p className="text-xs text-muted-foreground">
            Reports are delivered to the alert channels configured in{' '}
            <AppLink
              href={buildUrl('/alert-settings', { host: currentHostId })}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Alert settings
            </AppLink>
            .
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
          {CADENCE_OPTIONS.map((option) => {
            const locked = option.value === 'weekly' && !weeklyAllowed
            const selected = cadence === option.value
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!loaded || locked}
                onClick={() => setCadence(option.value)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left transition-colors',
                  selected
                    ? 'border-primary/50 bg-muted/40'
                    : 'hover:bg-muted/30',
                  locked && 'cursor-not-allowed opacity-60'
                )}
              >
                <span className="text-sm font-medium">
                  {option.label}
                  {locked ? (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Pro
                    </span>
                  ) : null}
                </span>
                <span className="text-xs text-muted-foreground">
                  {option.description}
                </span>
              </button>
            )
          })}
        </div>
      </section>

      {/* Hosts */}
      {cadence !== 'off' && hosts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-medium">Hosts covered</h3>
            <p className="text-xs text-muted-foreground">
              One report per selected host, per run.
            </p>
          </div>
          <div className="space-y-2">
            {hosts.map((host) => (
              <Label
                key={host.id}
                className="flex cursor-pointer items-center gap-2.5 text-sm"
              >
                <Checkbox
                  checked={selectedHosts.has(host.id)}
                  onCheckedChange={() => toggleHost(host.id)}
                />
                {host.name || host.host || `Host ${host.id}`}
              </Label>
            ))}
          </div>
        </section>
      ) : null}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!loaded || saving} size="sm">
          {saving ? 'Saving…' : 'Save schedule'}
        </Button>
        {lastSentAt ? (
          <span className="text-xs text-muted-foreground">
            Last sent {new Date(lastSentAt).toLocaleString()}
            {lastStatus ? ` · ${lastStatus}` : ''}
          </span>
        ) : null}
      </div>

      {/* Try it now */}
      <section className="space-y-3 border-t pt-6">
        <div>
          <h3 className="text-sm font-medium">Try it now</h3>
          <p className="text-xs text-muted-foreground">
            Uses the currently selected host — no schedule needed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={generateNow}
            disabled={busy !== null}
            className="gap-1.5"
          >
            <FileTextIcon className="size-3.5" />
            {busy === 'generate' ? 'Generating…' : 'Generate now'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={downloadPdf}
            disabled={busy !== null}
            className="gap-1.5"
          >
            <DownloadIcon className="size-3.5" />
            {busy === 'pdf' ? 'Rendering…' : 'Download PDF'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={sendTest}
            disabled={busy !== null}
            className="gap-1.5"
          >
            <SendIcon className="size-3.5" />
            {busy === 'test' ? 'Sending…' : 'Send test report'}
          </Button>
        </div>
      </section>
    </div>
  )
}
