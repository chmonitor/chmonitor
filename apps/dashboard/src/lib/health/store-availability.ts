/**
 * Can this deployment persist health/alert state? (#3495)
 *
 * One tri-state every alert surface asks, instead of each panel inventing its
 * own probe. Two inputs, combined by `resolveHealthStoreAvailability`:
 *
 * 1. `capabilities.health` from `GET /api/v1/config` — the server resolves it
 *    with the same `resolveHealthBackend()` call the stores use.
 * 2. An optional probe — a store read that came back `501 NOT_CONFIGURED`.
 *
 * Rules (the probe can only ever make the answer MORE restrictive, so the two
 * cannot disagree in the unsafe direction):
 * - a 501 probe ⇒ `unavailable`, whatever the capability says
 * - capability backend `'none'` ⇒ `unavailable`
 * - capability backend `'d1' | 'postgres'` ⇒ `available`
 * - config loading, config fetch failed, or an older server without the
 *   field ⇒ `unknown` — and `unknown` renders DISABLED, never enabled.
 */

import type {
  HealthCapabilityConfig,
  PublicFeaturePermissionConfig,
} from '@/lib/feature-permissions/types'
import type { FetchError } from '@/lib/swr/fetch-error'

import { useFeaturePermissions } from '@/lib/feature-permissions/context'

export type HealthStoreAvailability = 'unknown' | 'available' | 'unavailable'

/** Which capability field a store reads. */
export type HealthStoreKind = 'default' | 'maintenanceWindows'

/** True when an API error is the store's explicit `NOT_CONFIGURED` (HTTP 501). */
export function isNotConfiguredError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as FetchError).status === 501
  )
}

export function healthCapabilityFromConfig(
  config: PublicFeaturePermissionConfig | undefined
): HealthCapabilityConfig | undefined {
  return config?.capabilities?.health
}

export interface ResolveHealthStoreAvailabilityInput {
  capability: HealthCapabilityConfig | undefined
  /** True while `/api/v1/config` has not answered yet. */
  configLoading: boolean
  /** The error from a store read, if the caller has one. */
  probeError?: unknown
  store?: HealthStoreKind
}

export function resolveHealthStoreAvailability({
  capability,
  configLoading,
  probeError,
  store = 'default',
}: ResolveHealthStoreAvailabilityInput): HealthStoreAvailability {
  if (isNotConfiguredError(probeError)) return 'unavailable'
  if (configLoading || !capability) return 'unknown'
  const backend =
    store === 'maintenanceWindows'
      ? capability.maintenanceWindowsBackend
      : capability.backend
  if (backend === 'd1' || backend === 'postgres') return 'available'
  if (backend === 'none') return 'unavailable'
  return 'unknown'
}

export interface UseHealthStoreAvailabilityOptions {
  probeError?: unknown
  store?: HealthStoreKind
}

/**
 * The tri-state for a health/alert store. Pass the store read's `error` as
 * `probeError` when the panel already fetches one; a 501 then wins.
 */
export function useHealthStoreAvailability(
  options: UseHealthStoreAvailabilityOptions = {}
): HealthStoreAvailability {
  const { config, isLoading } = useFeaturePermissions()
  return resolveHealthStoreAvailability({
    capability: healthCapabilityFromConfig(config),
    configLoading: isLoading,
    probeError: options.probeError,
    store: options.store,
  })
}
