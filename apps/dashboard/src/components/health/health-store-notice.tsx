/**
 * The one line an alert settings panel shows when its store cannot (or may
 * not yet be known to) persist writes (#3495). Pair it with
 * `canWriteHealthStore(availability)` on every write control: `unknown` and
 * `unavailable` both render the control disabled.
 */

import type { HealthStoreAvailability } from '@/lib/health/store-availability'

import { cn } from '@/lib/utils'

/** Only a positively-known backend enables a write affordance. */
export function canWriteHealthStore(
  availability: HealthStoreAvailability
): boolean {
  return availability === 'available'
}

export function healthStoreNoticeText(
  availability: HealthStoreAvailability,
  feature: string
): string | null {
  if (availability === 'unavailable')
    return `${feature} require a configured database backend (cloud deployments, or self-hosted with a D1 database or a Postgres DATABASE_URL). Not available on this deployment.`
  if (availability === 'unknown')
    return `Checking whether this deployment can save ${feature.toLowerCase()}… Editing is disabled until it answers.`
  return null
}

export function HealthStoreNotice({
  availability,
  feature,
  className,
}: {
  availability: HealthStoreAvailability
  /** Plural noun phrase, e.g. "Custom alert rules". */
  feature: string
  className?: string
}) {
  const text = healthStoreNoticeText(availability, feature)
  if (!text) return null
  return (
    <p
      className={cn('text-sm text-muted-foreground', className)}
      data-health-store={availability}
    >
      {text}
    </p>
  )
}
