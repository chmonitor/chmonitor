/**
 * Canonical telemetry enum values shared between the dashboard client and the
 * telemetry collector worker. Keep in sync with
 * `apps/dashboard/src/lib/telemetry/environment.ts` types.
 */
export const DEPLOY_TARGETS = [
  'docker',
  'helm',
  'cf',
  'dev',
  'unknown',
] as const
export type DeployTarget = (typeof DEPLOY_TARGETS)[number]

export const CH_FLAVORS = ['oss', 'altinity', 'cloud', 'unknown'] as const
export type ChFlavor = (typeof CH_FLAVORS)[number]
