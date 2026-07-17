/**
 * Per-rule / per-host alert routing panel (plan 30, extended by plan 34).
 *
 * Lets an operator define routes that match a rule id/type and/or host (glob
 * or `*`) to a destination — either a channel webhook URL (`'webhook'`
 * provider: Slack/Discord/generic JSON) or a PagerDuty service's Events API
 * v2 routing key (`'pagerduty'` provider, plan 34), which lets PagerDuty's
 * own escalation policy + on-call schedule take over. The sweep fans out to
 * every matching route, falling back to the legacy global webhook / env
 * PagerDuty routing key (Alerts tab) when nothing matches. Lives as a tab in
 * `HealthSettingsDialog` alongside Thresholds/Alerts/History/Webhooks
 * (mirrors `WebhookSubscriptionsPanel`'s structure), but — unlike the
 * Clerk-gated webhook-subscriptions panel — this works with zero auth on
 * self-hosted deployments too (see `lib/health/alert-routing-auth.ts`).
 */

import { toast } from 'sonner'

import type {
  AlertRouteInfo,
  AlertRouteProvider,
} from '@/lib/hooks/use-alert-routes'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  fireNtfyTest,
  firePagerDutyTest,
  firePushoverTest,
  fireTelegramTest,
  fireWebhook,
} from '@/lib/health/alert-dispatcher'
import {
  useAlertRoutes,
  useAlertRoutesMutations,
  usePagerDutyServices,
} from '@/lib/hooks/use-alert-routes'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

function RouteRow({
  route,
  onDeleted,
}: {
  route: AlertRouteInfo
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const { deleteRoute } = useAlertRoutesMutations()
  const isPagerDuty = route.provider === 'pagerduty'
  const isTelegram = route.provider === 'telegram'
  const isNtfy = route.provider === 'ntfy'
  const isPushover = route.provider === 'pushover'

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteRoute(route.id)
      onDeleted()
    } catch (err) {
      toast.error('Failed to delete route', { description: describeError(err) })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      const testAlert = {
        checkId: 'test',
        title: 'Test Alert',
        severity: 'warning' as const,
        value: 0,
        label: 'This is a test alert from chmonitor',
        hostId: 0,
      }
      // A PagerDuty route has no direct webhook URL to fire — its secret is
      // the routing key, never returned by the API (masked), so a real test
      // send must happen at creation time via `firePagerDutyTest` in the add
      // form instead (see `handleSendTest` below). Existing PagerDuty routes
      // can only be deleted + re-created to re-test, which is an acceptable
      // tradeoff for never exposing the raw key back to the client after
      // storage.
      if (isPagerDuty) {
        toast.info(
          'Re-create the route to send another PagerDuty test event (the routing key is never re-shown once saved).'
        )
        return
      }
      // Same tradeoff as PagerDuty above: a Telegram route's bot token is a
      // masked secret never returned to the client after storage, so an
      // existing route can only be re-tested by re-creating it.
      if (isTelegram) {
        toast.info(
          'Re-create the route to send another Telegram test message (the bot token is never re-shown once saved).'
        )
        return
      }
      // ntfy: the topic URL is not a secret, so an unprotected topic can be
      // re-tested directly. A token-protected topic can't — its token is never
      // re-shown once saved — so fall back to the re-create hint like Telegram.
      if (isNtfy) {
        if (route.ntfyTokenMasked) {
          toast.info(
            'Re-create the route to send another ntfy test to this protected topic (the token is never re-shown once saved).'
          )
          return
        }
        const okNtfy = await fireNtfyTest(route.ntfyUrl ?? '')
        if (okNtfy) toast.success('Test notification sent to ntfy')
        else toast.error('ntfy request failed')
        return
      }
      // Same tradeoff as PagerDuty/Telegram above: a Pushover route's
      // application token is a masked secret never returned to the client
      // after storage, so an existing route can only be re-tested by
      // re-creating it.
      if (isPushover) {
        toast.info(
          'Re-create the route to send another Pushover test notification (the token is never re-shown once saved).'
        )
        return
      }
      const ok = await fireWebhook(testAlert, route.channelUrl)
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
          {isPagerDuty && <Badge variant="default">PagerDuty</Badge>}
          {isTelegram && <Badge variant="default">Telegram</Badge>}
          {isNtfy && <Badge variant="default">ntfy</Badge>}
          {isPushover && <Badge variant="default">Pushover</Badge>}
          <Badge variant="outline">rule: {route.matchRule}</Badge>
          <Badge variant="outline">host: {route.matchHost}</Badge>
          {!route.enabled && <Badge variant="secondary">disabled</Badge>}
        </div>
        <span className="truncate text-sm text-muted-foreground">
          {isPagerDuty
            ? `${route.serviceName || 'PagerDuty service'} — ${route.routingKeyMasked}`
            : isTelegram
              ? `chat ${route.telegramChatId} — bot ${route.telegramBotTokenMasked}`
              : isNtfy
                ? `${route.ntfyUrl}${route.ntfyTokenMasked ? ` — token ${route.ntfyTokenMasked}` : ''}`
                : isPushover
                  ? `user ${route.pushoverUser} — token ${route.pushoverTokenMasked}`
                  : route.channelUrl}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={handleTest}>
          Send test
        </Button>
        {confirming ? (
          <div className="flex items-center gap-1">
            <span className="mr-1 text-xs text-destructive">Delete?</span>
            <Button
              variant="destructive"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={handleDelete}
            >
              Yes
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              No
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setConfirming(true)}
          >
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}

function AddRouteForm({ onCreated }: { onCreated: () => void }) {
  const [matchRule, setMatchRule] = useState('*')
  const [matchHost, setMatchHost] = useState('*')
  const [provider, setProvider] = useState<AlertRouteProvider>('webhook')
  const [channelUrl, setChannelUrl] = useState('')
  const [pdServiceId, setPdServiceId] = useState('')
  const [pdServiceName, setPdServiceName] = useState('')
  const [pdRoutingKey, setPdRoutingKey] = useState('')
  const [tgBotToken, setTgBotToken] = useState('')
  const [tgChatId, setTgChatId] = useState('')
  const [ntfyUrl, setNtfyUrl] = useState('')
  const [ntfyToken, setNtfyToken] = useState('')
  const [poToken, setPoToken] = useState('')
  const [poUser, setPoUser] = useState('')
  const [busy, setBusy] = useState(false)
  const { createRoute } = useAlertRoutesMutations()
  const { services: pdServices, isLoading: pdServicesLoading } =
    usePagerDutyServices(provider === 'pagerduty')

  const reset = () => {
    setMatchRule('*')
    setMatchHost('*')
    setChannelUrl('')
    setPdServiceId('')
    setPdServiceName('')
    setPdRoutingKey('')
    setTgBotToken('')
    setTgChatId('')
    setNtfyUrl('')
    setNtfyToken('')
    setPoToken('')
    setPoUser('')
  }

  const handleSubmit = async () => {
    if (provider === 'pagerduty') {
      if (!pdRoutingKey.trim()) {
        toast.error("Enter the service's PagerDuty routing/integration key")
        return
      }
    } else if (provider === 'telegram') {
      if (!tgBotToken.trim() || !tgChatId.trim()) {
        toast.error('Enter the Telegram bot token and chat id')
        return
      }
    } else if (provider === 'ntfy') {
      if (!ntfyUrl.trim()) {
        toast.error('Enter the ntfy topic URL')
        return
      }
    } else if (provider === 'pushover') {
      if (!poToken.trim() || !poUser.trim()) {
        toast.error('Enter the Pushover application token and user key')
        return
      }
    } else if (!channelUrl.trim()) {
      toast.error('Enter a channel webhook URL')
      return
    }

    setBusy(true)
    try {
      await createRoute({
        matchRule: matchRule.trim() || '*',
        matchHost: matchHost.trim() || '*',
        ...(provider === 'pagerduty'
          ? {
              provider: 'pagerduty',
              serviceName: pdServiceName.trim() || undefined,
              routingKey: pdRoutingKey.trim(),
            }
          : provider === 'telegram'
            ? {
                provider: 'telegram',
                telegramBotToken: tgBotToken.trim(),
                telegramChatId: tgChatId.trim(),
              }
            : provider === 'ntfy'
              ? {
                  provider: 'ntfy',
                  ntfyUrl: ntfyUrl.trim(),
                  ntfyToken: ntfyToken.trim() || undefined,
                }
              : provider === 'pushover'
                ? {
                    provider: 'pushover',
                    pushoverToken: poToken.trim(),
                    pushoverUser: poUser.trim(),
                  }
                : { channelUrl: channelUrl.trim() }),
      })
      toast.success('Route created')
      reset()
      onCreated()
    } catch (err) {
      toast.error('Failed to create route', { description: describeError(err) })
    } finally {
      setBusy(false)
    }
  }

  const handleSendTest = async () => {
    if (!pdRoutingKey.trim()) {
      toast.error("Enter the service's PagerDuty routing/integration key")
      return
    }
    setBusy(true)
    try {
      const ok = await firePagerDutyTest(
        {
          checkId: 'test',
          title: 'Test Alert',
          severity: 'warning',
          value: 0,
          label: 'This is a test alert from chmonitor',
          hostId: 0,
        },
        pdRoutingKey.trim()
      )
      if (ok) toast.success('Test event sent to PagerDuty')
      else toast.error('PagerDuty Events API request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendTelegramTest = async () => {
    if (!tgBotToken.trim() || !tgChatId.trim()) {
      toast.error('Enter the Telegram bot token and chat id')
      return
    }
    setBusy(true)
    try {
      const ok = await fireTelegramTest(
        {
          checkId: 'test',
          title: 'Test Alert',
          severity: 'warning',
          value: 0,
          label: 'This is a test alert from chmonitor',
          hostId: 0,
        },
        tgBotToken.trim(),
        tgChatId.trim()
      )
      if (ok) toast.success('Test message sent to Telegram')
      else toast.error('Telegram Bot API request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendNtfyTest = async () => {
    if (!ntfyUrl.trim()) {
      toast.error('Enter the ntfy topic URL')
      return
    }
    setBusy(true)
    try {
      const ok = await fireNtfyTest(
        ntfyUrl.trim(),
        ntfyToken.trim() || undefined
      )
      if (ok) toast.success('Test notification sent to ntfy')
      else toast.error('ntfy request failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendPushoverTest = async () => {
    if (!poToken.trim() || !poUser.trim()) {
      toast.error('Enter the Pushover application token and user key')
      return
    }
    setBusy(true)
    try {
      const ok = await firePushoverTest(poToken.trim(), poUser.trim())
      if (ok) toast.success('Test notification sent to Pushover')
      else toast.error('Pushover request failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">Add route</Label>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Destination</Label>
        <Select
          value={provider}
          onValueChange={(v) => setProvider(v as AlertRouteProvider)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webhook">
              Channel webhook (Slack/Discord/…)
            </SelectItem>
            <SelectItem value="pagerduty">PagerDuty service</SelectItem>
            <SelectItem value="telegram">Telegram chat</SelectItem>
            <SelectItem value="ntfy">ntfy topic</SelectItem>
            <SelectItem value="pushover">Pushover user</SelectItem>
          </SelectContent>
        </Select>
      </div>
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

      {provider === 'pagerduty' ? (
        <>
          <Label className="text-xs text-muted-foreground">
            PagerDuty service {pdServicesLoading && '(loading…)'}
          </Label>
          {pdServices.length > 0 && (
            <Select
              value={pdServiceId}
              onValueChange={(id) => {
                if (id == null) return
                setPdServiceId(id)
                const svc = pdServices.find((s) => s.id === id)
                setPdServiceName(svc?.name ?? '')
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a listed service…" />
              </SelectTrigger>
              <SelectContent>
                {pdServices.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Input
            placeholder="Service display name (optional)"
            value={pdServiceName}
            onChange={(e) => setPdServiceName(e.target.value)}
          />
          <Input
            placeholder="Service integration/routing key"
            value={pdRoutingKey}
            onChange={(e) => setPdRoutingKey(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={handleSendTest}
          >
            Send test event
          </Button>
        </>
      ) : provider === 'telegram' ? (
        <>
          <Label
            htmlFor="route-telegram-token"
            className="text-xs text-muted-foreground"
          >
            Bot token
          </Label>
          <Input
            id="route-telegram-token"
            placeholder="123456:ABC-DEF..."
            value={tgBotToken}
            onChange={(e) => setTgBotToken(e.target.value)}
          />
          <Label
            htmlFor="route-telegram-chat"
            className="text-xs text-muted-foreground"
          >
            Chat id
          </Label>
          <Input
            id="route-telegram-chat"
            placeholder="-1001234567890 or @channelname"
            value={tgChatId}
            onChange={(e) => setTgChatId(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={handleSendTelegramTest}
          >
            Send test message
          </Button>
        </>
      ) : provider === 'ntfy' ? (
        <>
          <Label
            htmlFor="route-ntfy-url"
            className="text-xs text-muted-foreground"
          >
            Topic URL
          </Label>
          <Input
            id="route-ntfy-url"
            placeholder="https://ntfy.sh/my-topic"
            value={ntfyUrl}
            onChange={(e) => setNtfyUrl(e.target.value)}
          />
          <Label
            htmlFor="route-ntfy-token"
            className="text-xs text-muted-foreground"
          >
            Access token (optional)
          </Label>
          <Input
            id="route-ntfy-token"
            placeholder="tk_… (only for protected topics)"
            value={ntfyToken}
            onChange={(e) => setNtfyToken(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={handleSendNtfyTest}
          >
            Send test notification
          </Button>
        </>
      ) : provider === 'pushover' ? (
        <>
          <Label
            htmlFor="route-pushover-token"
            className="text-xs text-muted-foreground"
          >
            Application API token
          </Label>
          <Input
            id="route-pushover-token"
            placeholder="a1b2c3..."
            value={poToken}
            onChange={(e) => setPoToken(e.target.value)}
          />
          <Label
            htmlFor="route-pushover-user"
            className="text-xs text-muted-foreground"
          >
            User (or group) key
          </Label>
          <Input
            id="route-pushover-user"
            placeholder="u1v2w3..."
            value={poUser}
            onChange={(e) => setPoUser(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={busy}
            onClick={handleSendPushoverTest}
          >
            Send test notification
          </Button>
        </>
      ) : (
        <>
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
        </>
      )}

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
        Route findings to different channels — or PagerDuty services — by rule
        or host. A finding matching one or more routes fans out to every matched
        destination, letting a PagerDuty route's service escalation policy +
        on-call schedule take over. When nothing matches, the finding falls back
        to the global webhook / PagerDuty routing key configured in the Alerts
        tab.
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
