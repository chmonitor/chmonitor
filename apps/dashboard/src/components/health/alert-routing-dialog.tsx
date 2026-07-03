/**
 * Per-rule / per-host alert routing panel (plan 30).
 *
 * Lets an operator define routes that match a rule id/type and/or host (glob
 * or `*`) to a channel webhook URL — the sweep fans out to every matching
 * route, falling back to the legacy global webhook (Alerts tab) when nothing
 * matches. Lives as a tab in `HealthSettingsDialog` alongside
 * Thresholds/Alerts/History/Webhooks (mirrors `WebhookSubscriptionsPanel`'s
 * structure), but — unlike the Clerk-gated webhook-subscriptions panel —
 * this works with zero auth on self-hosted deployments too (see
 * `lib/health/alert-routing-auth.ts`).
 */

import { toast } from 'sonner'

import type { AlertRouteInfo } from '@/lib/hooks/use-alert-routes'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fireWebhook } from '@/lib/health/alert-dispatcher'
import {
  useAlertRoutes,
  useAlertRoutesMutations,
} from '@/lib/hooks/use-alert-routes'
import { cn } from '@/lib/utils'

function RouteRow({
  route,
  onDeleted,
}: {
  route: AlertRouteInfo
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const { deleteRoute } = useAlertRoutesMutations()

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteRoute(route.id)
      onDeleted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete route')
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      const ok = await fireWebhook(
        {
          checkId: 'test',
          title: 'Test Alert',
          severity: 'warning',
          value: 0,
          label: 'This is a test alert from chmonitor',
          hostId: 0,
        },
        route.channelUrl
      )
      if (ok) toast.success('Test alert sent')
      else toast.error('Webhook request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline">rule: {route.matchRule}</Badge>
          <Badge variant="outline">host: {route.matchHost}</Badge>
          {!route.enabled && <Badge variant="secondary">disabled</Badge>}
        </div>
        <span className="truncate text-sm text-muted-foreground">
          {route.channelUrl}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={handleTest}>
          Send test
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  )
}

function AddRouteForm({ onCreated }: { onCreated: () => void }) {
  const [matchRule, setMatchRule] = useState('*')
  const [matchHost, setMatchHost] = useState('*')
  const [channelUrl, setChannelUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const { createRoute } = useAlertRoutesMutations()

  const handleSubmit = async () => {
    if (!channelUrl.trim()) {
      toast.error('Enter a channel webhook URL')
      return
    }
    setBusy(true)
    try {
      await createRoute({
        matchRule: matchRule.trim() || '*',
        matchHost: matchHost.trim() || '*',
        channelUrl: channelUrl.trim(),
      })
      toast.success('Route created')
      setMatchRule('*')
      setMatchHost('*')
      setChannelUrl('')
      onCreated()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create route')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">Add route</Label>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="route-match-rule"
            className="text-xs text-muted-foreground"
          >
            Rule id / type (or *, glob)
          </Label>
          <Input
            id="route-match-rule"
            placeholder="disk-usage or disk-*"
            value={matchRule}
            onChange={(e) => setMatchRule(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label
            htmlFor="route-match-host"
            className="text-xs text-muted-foreground"
          >
            Host id / name (or *, glob)
          </Label>
          <Input
            id="route-match-host"
            placeholder="0 or prod-*"
            value={matchHost}
            onChange={(e) => setMatchHost(e.target.value)}
          />
        </div>
      </div>
      <Label
        htmlFor="route-channel-url"
        className="text-xs text-muted-foreground"
      >
        Channel webhook URL
      </Label>
      <Input
        id="route-channel-url"
        placeholder="https://hooks.slack.com/services/..."
        value={channelUrl}
        onChange={(e) => setChannelUrl(e.target.value)}
      />
      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={handleSubmit}
      >
        Add route
      </Button>
    </div>
  )
}

export function AlertRoutingPanel({ className }: { className?: string }) {
  const { routes, isLoading, refetch } = useAlertRoutes()

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        Route findings to different channels by rule or host — a finding
        matching one or more routes fans out to every matched channel. When
        nothing matches, the finding falls back to the global webhook configured
        in the Alerts tab.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && routes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No routes configured — every alert uses the global webhook.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {routes.map((route) => (
          <RouteRow key={route.id} route={route} onDeleted={refetch} />
        ))}
      </div>

      <AddRouteForm onCreated={refetch} />
    </div>
  )
}
