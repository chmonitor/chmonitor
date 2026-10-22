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

import type { DeclarativeRepeat, HealthConfigEnvData } from './schema'

import { loadEnvCustomWebhookTargets } from '../custom-webhook-env'
import {
  getServerAlertCooldownConfig,
  getServerDigestWindowMinutes,
  getServerRepeatBackoffMaxMs,
  getServerRepeatMinDeltaConfig,
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
  const repeat = loadEnvRepeat(options.ruleIds ?? [])
  if (repeat) data.repeat = repeat
  return data
}

/**
 * Reminder pacing from env (#4049), in the declarative shape. Only values an
 * env var explicitly set appear, so the merge can tell "env says X" from
 * "nobody said anything". `undefined` when no pacing env var is set.
 */
function loadEnvRepeat(
  ruleIds: readonly string[]
): DeclarativeRepeat | undefined {
  const repeat: DeclarativeRepeat = {}
  const { bySeverity } = getServerAlertCooldownConfig([])
  const cooldownMinutes: NonNullable<DeclarativeRepeat['cooldownMinutes']> = {}
  if (bySeverity.warning !== undefined)
    cooldownMinutes.warning = bySeverity.warning / 60_000
  if (bySeverity.critical !== undefined)
    cooldownMinutes.critical = bySeverity.critical / 60_000
  if (Object.keys(cooldownMinutes).length > 0)
    repeat.cooldownMinutes = cooldownMinutes

  const minDelta = getServerRepeatMinDeltaConfig(ruleIds)
  if (minDelta.default !== null) repeat.minDelta = minDelta.default
  // `byRule` already folds in the global value; keep only real overrides.
  const minDeltaByRule: Record<string, number> = {}
  for (const [rule, delta] of Object.entries(minDelta.byRule)) {
    if (delta !== null && delta !== minDelta.default)
      minDeltaByRule[rule] = delta
  }
  if (Object.keys(minDeltaByRule).length > 0)
    repeat.minDeltaByRule = minDeltaByRule

  const backoffMs = getServerRepeatBackoffMaxMs()
  if (backoffMs !== null) repeat.backoffMaxMinutes = backoffMs / 60_000

  return Object.keys(repeat).length > 0 ? repeat : undefined
}
