/**
 * Shared feature-permission gate for system charts.
 *
 * Split out of system-charts.ts (#2898) since multiple system-chart slices
 * (cpu, memory, disk, ...) reference the same `metrics` permission.
 */

import type { FeaturePermission } from '@/lib/feature-permissions/types'

export const METRICS_PERMISSION = {
  feature: 'metrics',
} satisfies FeaturePermission
