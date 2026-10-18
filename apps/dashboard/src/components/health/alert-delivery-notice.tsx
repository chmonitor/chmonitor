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
