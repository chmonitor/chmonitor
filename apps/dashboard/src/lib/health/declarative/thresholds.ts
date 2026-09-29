/**
 * Effective per-rule threshold overrides for the server paths (#3538): the
 * sweep and `current-findings`.
 *
 * Thresholds have no D1 layer (the UI keeps them in browser storage), so the
 * chain is `file > env > built-in default`, merged per rule and field by field
 * through the shared `mergeSources` helper: a file that sets only `warning`
 * for a rule keeps the env `critical` for it.
 */

import type { ThresholdOverride } from '../server-alert-config'
import type { SourceLayer } from './merge'

import { mergeSources } from './merge'
import { readHealthConfigLayers, warnOnce } from './sources'

interface ThresholdEntry extends ThresholdOverride {
  rule: string
}

export async function resolveThresholdOverrides(
  ruleIds: readonly string[]
): Promise<Record<string, ThresholdOverride>> {
  const known = new Set(ruleIds)
  const layers: SourceLayer<ThresholdEntry>[] = []
  for (const layer of await readHealthConfigLayers({ ruleIds })) {
    const entries: ThresholdEntry[] = []
    for (const [rule, override] of Object.entries(layer.data.thresholds)) {
      if (!known.has(rule)) {
        warnOnce(
          `[health-config] Skipping thresholds.${rule}: no registered alert rule with that id`
        )
        continue
      }
      entries.push({ rule, ...override })
    }
    layers.push({ source: layer.source, entries })
  }

  const out: Record<string, ThresholdOverride> = {}
  for (const { rule, source: _source, ...override } of mergeSources(
    layers,
    (e) => e.rule,
    'union'
  )) {
    out[rule] = override
  }
  return out
}
