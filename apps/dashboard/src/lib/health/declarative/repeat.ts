/**
 * Effective reminder pacing for the sweep (#4049): per-severity cooldown,
 * per-rule min delta, and the back-off cap, from `alerts.yaml` `repeat:` and
 * the `HEALTH_ALERT_*` env vars.
 *
 * Like thresholds there is no D1 layer, so the chain is `file > env > default`
 * per key. Specificity still comes first within a setting, as it always did
 * for env: a per-rule min delta (file, then env) beats the global min delta
 * (file, then env).
 */

import type { DeclarativeRepeat } from './schema'

import { readHealthConfigLayers, warnOnce } from './sources'

export interface ResolvedRepeatConfig {
  /** Per-severity re-notify cooldown in ms; only explicit overrides. */
  bySeverity: Partial<Record<'warning' | 'critical', number>>
  repeatMinDelta: {
    default: number | null
    byRule: Record<string, number | null>
  }
  /** Back-off cap in ms; `null` = off. */
  repeatBackoffMaxMs: number | null
}

export async function resolveRepeatConfig(
  ruleIds: readonly string[]
): Promise<ResolvedRepeatConfig> {
  // Lowest precedence first: env, then file.
  const layers: DeclarativeRepeat[] = []
  for (const layer of await readHealthConfigLayers({ ruleIds })) {
    if (layer.data.repeat) layers.push(layer.data.repeat)
  }
  const known = new Set(ruleIds)

  const bySeverity: ResolvedRepeatConfig['bySeverity'] = {}
  let globalDelta: number | null = null
  const ruleDelta: Record<string, number> = {}
  let backoffMinutes: number | null = null
  for (const repeat of layers) {
    const { warning, critical } = repeat.cooldownMinutes ?? {}
    if (warning !== undefined) bySeverity.warning = warning * 60_000
    if (critical !== undefined) bySeverity.critical = critical * 60_000
    if (repeat.minDelta !== undefined) globalDelta = repeat.minDelta
    for (const [rule, delta] of Object.entries(repeat.minDeltaByRule ?? {})) {
      if (!known.has(rule)) {
        warnOnce(
          `[health-config] Skipping repeat.minDeltaByRule.${rule}: no registered alert rule with that id`
        )
        continue
      }
      ruleDelta[rule] = delta
    }
    if (repeat.backoffMaxMinutes !== undefined)
      backoffMinutes = repeat.backoffMaxMinutes
  }

  const byRule: Record<string, number | null> = {}
  for (const id of ruleIds) byRule[id] = ruleDelta[id] ?? globalDelta
  return {
    bySeverity,
    repeatMinDelta: { default: globalDelta, byRule },
    repeatBackoffMaxMs:
      backoffMinutes === null ? null : backoffMinutes * 60_000,
  }
}
