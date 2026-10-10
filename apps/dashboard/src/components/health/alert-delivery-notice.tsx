/**
 * "Alerts cannot be delivered" notice (#3701).
 *
 * With `HEALTH_ALERT_ENABLED` unset the scheduled sweep (PeerDB cycle included)
 * runs dry-run, and with the sweep disabled it never runs — either way nothing
 * reaches a channel, yet every card still looks armed. This notice says so,
 * from the `delivery` field of `GET /api/v1/health/alert-config`.
 *
 * Renders nothing while loading, on error, or when the server does not report
 * the field: an unknown state is not a problem worth a banner.
 */

import { BellOff } from 'lucide-react'

import type { AlertDeliveryStatus } from '@/lib/hooks/use-alert-channel-config'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AppLink } from '@/components/ui/app-link'
import { useAlertChannelConfig } from '@/lib/hooks/use-alert-channel-config'
import { cn } from '@/lib/utils'

/** Why alerts cannot be delivered, or `null` when they can (or it is unknown). */
export function alertDeliveryProblem(
  delivery: AlertDeliveryStatus | null
): string | null {
  if (!delivery) return null
  if (!delivery.sweepEnabled) {
    return 'The scheduled health sweep is off (CHM_HEALTH_SWEEP_ENABLED is false or CRON_SECRET is unset), so no alert is evaluated or sent.'
  }
  if (!delivery.alertingEnabled) {
    return 'HEALTH_ALERT_ENABLED is not true, so the scheduled sweep runs dry-run: findings are recorded but no alert is sent to any channel.'
  }
  return null
}

export function AlertDeliveryNotice({
  className,
  hostId,
}: {
  className?: string
  /** Active host, kept on the settings link. */
  hostId?: number
}) {
  const { delivery } = useAlertChannelConfig()
  const problem = alertDeliveryProblem(delivery)
  if (!problem) return null

  const href =
    hostId === undefined ? '/alert-settings' : `/alert-settings?host=${hostId}`

  return (
    <Alert className={cn(className)}>
      <BellOff aria-hidden />
      <AlertTitle>Alerts cannot be delivered</AlertTitle>
      <AlertDescription>
        <p>
          {problem}{' '}
          <AppLink href={href} className="underline underline-offset-2">
            Alert settings
          </AppLink>
        </p>
      </AlertDescription>
    </Alert>
  )
}
