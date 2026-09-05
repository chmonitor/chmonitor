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
 * the health settings page alongside Thresholds/Alerts/History/Webhooks
 * (mirrors `WebhookSubscriptionsPanel`'s structure), but — unlike the
 * Clerk-gated webhook-subscriptions panel — this works with zero auth on
 * self-hosted deployments too (see `lib/health/alert-routing-auth.ts`).
 */

import { AddRouteForm } from './add-route-form'
import { RouteRow } from './route-row'
import { useAlertRoutes } from '@/lib/hooks/use-alert-routes'
import { cn } from '@/lib/utils'

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
