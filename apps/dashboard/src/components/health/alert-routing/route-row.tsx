import { toast } from 'sonner'

import type { AlertRouteInfo } from '@/lib/hooks/use-alert-routes'

import { TEST_ALERT } from './types'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fireNtfyTest, fireWebhook } from '@/lib/health/alert-dispatcher'
import { useAlertRoutesMutations } from '@/lib/hooks/use-alert-routes'
import { describeError } from '@/lib/swr/fetch-error'

export function RouteRow({
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
      const ok = await fireWebhook(TEST_ALERT, route.channelUrl)
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
          {route.minSeverity && (
            <Badge variant="outline">
              {route.minSeverity === 'critical' ? 'critical only' : 'warning+'}
            </Badge>
          )}
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
