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
