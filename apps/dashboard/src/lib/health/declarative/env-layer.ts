/**
 * The `env` layer of the declarative health config (#3496), split out of
 * `loader.ts` (#3497) so the stores can read it without the loader's
 * node:fs/yaml imports: env is available on every runtime, the file layer is
 * not. `loader.ts` re-exports these names unchanged.
 *
 * Imports only types from `./schema`: `schema.ts` imports a store module for
 * a constant, and the stores import this module, so a value import here
 * would be an evaluation-order cycle.
 */

import type { HealthConfigEnvData } from './schema'

import { loadEnvCustomWebhookTargets } from '../custom-webhook-env'
import {
  getServerDigestWindowMinutes,
  getServerThresholdOverrides,
} from '../server-alert-config'

export interface HealthConfigEnvOptions {
  /** Rule ids to probe for `HEALTH_THRESHOLD_<RULE>_WARNING|CRITICAL`. */
  ruleIds?: readonly string[]
}

/**
 * The env layer, built from the existing parsers so env semantics stay
 * defined in one place: `getServerThresholdOverrides`,
 * `loadEnvCustomWebhookTargets` (`HEALTH_ALERT_WEBHOOK_TARGETS`), and
 * `getServerDigestWindowMinutes` (`HEALTH_ALERT_DIGEST_MINUTES`). Settings
 * with no env form yet stay empty.
 */
export function loadHealthConfigEnv(
  options: HealthConfigEnvOptions = {}
): HealthConfigEnvData {
  const env = typeof process !== 'undefined' ? process.env : {}
  const data: HealthConfigEnvData = {
    customRules: {},
    thresholds: {},
    peerdbRules: {},
    routes: {},
    channels: {},
    webhookTargets: {},
    quietHours: {},
    maintenanceWindows: {},
  }

  for (const [rule, override] of Object.entries(
    getServerThresholdOverrides(options.ruleIds ?? [])
  )) {
    data.thresholds[rule] = override
  }
  for (const target of loadEnvCustomWebhookTargets(env)) {
    data.webhookTargets[target.id] = target
  }
  if (env.HEALTH_ALERT_DIGEST_MINUTES?.trim()) {
    const windowMinutes = getServerDigestWindowMinutes()
    data.digest = { enabled: windowMinutes > 0, windowMinutes }
  }
  return data
}
