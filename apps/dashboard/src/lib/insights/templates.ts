/**
 * AI Insights setting templates.
 *
 * One-click preset bundles that set enrichment + prompt style + window together,
 * so operators can "pick a vibe" instead of tuning each control. Templates keep
 * `model: null` (deployment default) so they work on any provider config. Pure
 * module — the settings UI maps these to icons.
 */

import type { InsightsSettings } from './settings'

export type InsightTemplateId = 'quick' | 'deep' | 'learn' | 'raw'

export interface InsightTemplate {
  readonly id: InsightTemplateId
  readonly label: string
  readonly icon: 'Zap' | 'FileText' | 'GraduationCap' | 'Activity'
  /** Short, scannable hint (<= ~24 chars). */
  readonly hint: string
  readonly settings: Pick<
    InsightsSettings,
    'enrich' | 'promptStyle' | 'model' | 'window'
  >
}

export const INSIGHT_TEMPLATES: readonly InsightTemplate[] = [
  {
    id: 'quick',
    label: 'Quick scan',
    icon: 'Zap',
    hint: 'Terse one-liners',
    settings: {
      enrich: true,
      promptStyle: 'concise',
      model: null,
      window: '6 HOUR',
    },
  },
  {
    id: 'deep',
    label: 'Deep dive',
    icon: 'FileText',
    hint: 'Root cause + fix',
    settings: {
      enrich: true,
      promptStyle: 'detailed',
      model: null,
      window: '24 HOUR',
    },
  },
  {
    id: 'learn',
    label: 'Learning',
    icon: 'GraduationCap',
    hint: 'Plain language',
    settings: {
      enrich: true,
      promptStyle: 'beginner',
      model: null,
      window: '24 HOUR',
    },
  },
  {
    id: 'raw',
    label: 'Raw signals',
    icon: 'Activity',
    hint: 'No AI, fastest',
    settings: {
      enrich: false,
      promptStyle: 'concise',
      model: null,
      window: '6 HOUR',
    },
  },
] as const

/**
 * The template whose bundle matches the current settings exactly, or null when
 * the user has a custom combination. Used to highlight the active template.
 */
export function matchTemplate(
  settings: Pick<
    InsightsSettings,
    'enrich' | 'promptStyle' | 'model' | 'window'
  >
): InsightTemplateId | null {
  const found = INSIGHT_TEMPLATES.find(
    (t) =>
      t.settings.enrich === settings.enrich &&
      t.settings.promptStyle === settings.promptStyle &&
      t.settings.model === settings.model &&
      t.settings.window === settings.window
  )
  return found?.id ?? null
}
