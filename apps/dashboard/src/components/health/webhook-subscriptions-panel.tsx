/**
 * Webhook subscriptions panel (plan 44).
 *
 * Lets a signed-in user subscribe a URL to one or more event types and see
 * delivery history / dead-letters. Lives as a tab in `HealthSettingsDialog`
 * alongside Thresholds/Alerts, but — unlike those two (batched, saved via the
 * dialog's footer "Save" button, localStorage-backed) — every action here is
 * an immediate server call (create/toggle/delete), same as the existing
 * "Send test" buttons in the Alerts tab. Server-backed (D1 + Clerk), so it is
 * a no-op panel with an explanatory note on self-hosted/signed-out — the
 * dialog's other tabs keep working unaffected either way.
 */

import { toast } from 'sonner'

import type { WebhookSubscriptionInfo } from '@/lib/hooks/use-webhook-subscriptions'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { EMITTABLE_EVENT_TYPES } from '@/lib/events/event-types'
import {
  useWebhookDeliveries,
  useWebhookSubscriptions,
  useWebhookSubscriptionsMutations,
} from '@/lib/hooks/use-webhook-subscriptions'
import { describeError } from '@/lib/swr/fetch-error'
import { cn } from '@/lib/utils'

function deliveryStatusVariant(
  status: string
): 'default' | 'secondary' | 'destructive' {
  if (status === 'delivered') return 'default'
  if (status === 'dead') return 'destructive'
  return 'secondary'
}

function DeliveriesList({ subscriptionId }: { subscriptionId: string }) {
  const { deliveries, isLoading } = useWebhookDeliveries(subscriptionId)

  if (isLoading) {
    return <p className="px-3 pb-3 text-xs text-muted-foreground">Loading…</p>
  }
  if (deliveries.length === 0) {
    return (
      <p className="px-3 pb-3 text-xs text-muted-foreground">
        No deliveries yet.
      </p>
    )
  }

  return (
    <ul className="flex flex-col gap-1.5 px-3 pb-3">
      {deliveries.map((d) => (
        <li
          key={d.id}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="flex items-center gap-2">
            <Badge variant={deliveryStatusVariant(d.status)}>{d.status}</Badge>
            <span className="text-muted-foreground">{d.eventType}</span>
          </span>
          <span className="text-muted-foreground">
            {d.attempts} attempt{d.attempts === 1 ? '' : 's'}
            {d.lastStatusCode ? ` · HTTP ${d.lastStatusCode}` : ''} ·{' '}
            {new Date(d.eventTime).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  )
}

function SubscriptionRow({
  subscription,
  onDeleted,
  onToggled,
}: {
  subscription: WebhookSubscriptionInfo
  onDeleted: () => void
  onToggled: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const { deleteSubscription, updateSubscription, sendTestPing } =
    useWebhookSubscriptionsMutations()

  const handleToggle = async (checked: boolean) => {
    setBusy(true)
    try {
      await updateSubscription(subscription.id, { enabled: checked })
      onToggled()
    } catch (err) {
      toast.error('Failed to update subscription', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      await deleteSubscription(subscription.id)
      onDeleted()
    } catch (err) {
      toast.error('Failed to delete subscription', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    try {
      const outcome = await sendTestPing(subscription.id)
      if (outcome.status === 'delivered') {
        toast.success('Test webhook delivered')
      } else {
        toast.error('Test webhook failed', {
          description: outcome.lastError ?? `status ${outcome.status}`,
        })
      }
    } catch (err) {
      toast.error('Failed to send test webhook', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between gap-2 p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate text-sm font-medium">
            {subscription.url}
          </span>
          <div className="flex flex-wrap gap-1">
            {subscription.eventTypes.map((t) => (
              <Badge key={t} variant="outline">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'Hide' : 'Deliveries'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={handleTest}
          >
            Send test
          </Button>
          <Switch
            checked={subscription.enabled}
            disabled={busy}
            onCheckedChange={handleToggle}
          />
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
      {expanded && (
        <>
          <Separator />
          <DeliveriesList subscriptionId={subscription.id} />
        </>
      )}
    </div>
  )
}

function AddSubscriptionForm({ onCreated }: { onCreated: () => void }) {
  const [url, setUrl] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const { createSubscription } = useWebhookSubscriptionsMutations()

  const toggleType = (type: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(type)
      else next.delete(type)
      return next
    })
  }

  const handleSubmit = async () => {
    if (!url.trim() || selected.size === 0) {
      toast.error('Enter a URL and select at least one event type')
      return
    }
    setBusy(true)
    try {
      const created = await createSubscription({
        url: url.trim(),
        eventTypes: Array.from(selected),
      })
      toast.success('Subscription created', {
        description: `Secret (shown once): ${created.secret}`,
        duration: 15_000,
      })
      setUrl('')
      setSelected(new Set())
      onCreated()
    } catch (err) {
      toast.error('Failed to create subscription', {
        description: describeError(err),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">Add subscription</Label>
      <Input
        placeholder="https://example.com/webhooks/chmonitor"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <div className="flex flex-wrap gap-3">
        {EMITTABLE_EVENT_TYPES.map((type) => (
          <label
            key={type}
            className="flex items-center gap-1.5 text-sm"
            htmlFor={`event-type-${type}`}
          >
            <Checkbox
              id={`event-type-${type}`}
              checked={selected.has(type)}
              onCheckedChange={(checked) => toggleType(type, checked === true)}
            />
            {type}
          </label>
        ))}
      </div>
      <Button
        size="sm"
        className="self-start"
        disabled={busy}
        onClick={handleSubmit}
      >
        Add
      </Button>
    </div>
  )
}

export function WebhookSubscriptionsPanel({
  className,
}: {
  className?: string
}) {
  const { subscriptions, isLoading, featureEnabled, isSignedIn, refetch } =
    useWebhookSubscriptions()

  if (!featureEnabled) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Webhook subscriptions require Clerk sign-in and a configured database
        backend (cloud deployments, or self-hosted with Clerk + D1 configured).
        Not available on this deployment.
      </p>
    )
  }

  if (!isSignedIn) {
    return (
      <p className={cn('text-sm text-muted-foreground', className)}>
        Sign in to manage webhook subscriptions.
      </p>
    )
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <p className="text-xs text-muted-foreground">
        Subscribe a URL to specific event types. Every delivery is HMAC-signed (
        <code>X-Chmonitor-Signature</code>) and retried with bounded backoff;
        persistent failures are recorded below.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && subscriptions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No webhook subscriptions yet.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {subscriptions.map((s) => (
          <SubscriptionRow
            key={s.id}
            subscription={s}
            onDeleted={refetch}
            onToggled={refetch}
          />
        ))}
      </div>

      <AddSubscriptionForm onCreated={refetch} />
    </div>
  )
}
