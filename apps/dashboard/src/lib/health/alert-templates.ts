/**
 * Quick-start alerting templates.
 *
 * Setting alerts up from scratch means answering three questions at once — which
 * severity floor, which channels, and 16 pairs of thresholds. A template answers
 * all three in one click, and everything it writes stays fully editable
 * afterwards.
 *
 * Deliberately stores NO new state: a template only writes into the existing
 * {@link AlertSettings} fields and the existing {@link ThresholdsMap}, so
 * `loadAlertSettings`'s whitelist parser keeps round-tripping unchanged and a
 * template can never "half-persist".
 *
 * Pure — no `window`, no I/O.
 */

import type { AlertSettings } from './alert-settings-storage'
import type { ThresholdPresetId } from './threshold-presets'
import type { ThresholdsMap } from './thresholds-storage'

import { applyPresetToDefaults, THRESHOLD_PRESETS } from './threshold-presets'

export interface AlertTemplate {
  id: string
  name: string
  /** One-line pitch shown on the template card. */
  description: string
  /** Lucide icon name resolved by the picker — kept as data so this stays pure. */
  icon: 'shield' | 'siren' | 'layers' | 'moon'
  /** Global severity floor the template sets. */
  minSeverity: 'warning' | 'critical'
  /** Whether the template turns browser notifications on. */
  browserNotifications: boolean
  /** Sensitivity applied to the checks below. */
  preset: ThresholdPresetId
  /**
   * Checks the template tunes. `undefined` means every check — used by the
   * broad templates; the focused ones list only the checks they care about so
   * the rest keep their built-in defaults.
   */
  checkIds?: readonly string[]
  /** Human-readable summary of what the template changes. */
  highlights: readonly string[]
}

export const ALERT_TEMPLATES: readonly AlertTemplate[] = [
  {
    id: 'production',
    name: 'Production on-call',
    description:
      'Page only on genuine incidents — critical severity with the built-in thresholds.',
    icon: 'siren',
    minSeverity: 'critical',
    browserNotifications: true,
    preset: 'balanced',
    highlights: [
      'Critical severity only',
      'Balanced thresholds on every check',
      'Browser notifications on',
    ],
  },
  {
    id: 'early-warning',
    name: 'Early warning',
    description:
      'Catch degradation before it becomes an incident — warning severity, tighter thresholds.',
    icon: 'shield',
    minSeverity: 'warning',
    browserNotifications: true,
    preset: 'sensitive',
    highlights: [
      'Warning and critical severities',
      'Sensitive thresholds on every check',
      'Browser notifications on',
    ],
  },
  {
    id: 'ingestion',
    name: 'Ingestion focus',
    description:
      'For write-heavy clusters — tight thresholds on parts, merges and insert throttling.',
    icon: 'layers',
    minSeverity: 'warning',
    browserNotifications: true,
    preset: 'sensitive',
    checkIds: [
      'max-parts',
      'parts-pressure',
      'delayed-inserts',
      'stuck-merges',
      'failed-mutations',
    ],
    highlights: [
      'Warning and critical severities',
      'Sensitive thresholds on the ingestion checks',
      'Other checks keep their defaults',
    ],
  },
  {
    id: 'quiet',
    name: 'Quiet / staging',
    description:
      'Minimal noise for a non-production cluster — critical only, relaxed thresholds.',
    icon: 'moon',
    minSeverity: 'critical',
    browserNotifications: false,
    preset: 'relaxed',
    highlights: [
      'Critical severity only',
      'Relaxed thresholds on every check',
      'Browser notifications off',
    ],
  },
]

export interface TemplateApplication {
  alerts: AlertSettings
  thresholds: ThresholdsMap
}

/**
 * Apply a template on top of the current settings.
 *
 * Channel targets (webhook / healthchecks URLs) are never touched — a template
 * decides *when* to alert, the channel cards decide *where*. Thresholds for
 * checks the template does not list are left exactly as they were.
 */
export function applyTemplate(
  template: AlertTemplate,
  current: { alerts: AlertSettings; thresholds: ThresholdsMap },
  checks: readonly {
    id: string
    defaults: { warning: number; critical: number }
  }[]
): TemplateApplication {
  const factor =
    THRESHOLD_PRESETS.find((p) => p.id === template.preset)?.factor ?? 1

  const targeted = template.checkIds
    ? checks.filter((c) => template.checkIds?.includes(c.id))
    : checks

  const thresholds: ThresholdsMap = { ...current.thresholds }
  for (const check of targeted) {
    thresholds[check.id] = applyPresetToDefaults(check.defaults, factor)
  }

  return {
    alerts: {
      ...current.alerts,
      minSeverity: template.minSeverity,
      browserNotificationsEnabled: template.browserNotifications,
    },
    thresholds,
  }
}
