/**
 * AI Insights user settings — pure, isomorphic model.
 *
 * These are *per-user* preferences (persisted client-side in localStorage, like
 * dismissals and the agent model picker) that tune how insights are generated
 * and read:
 *
 * - `model`        — which LLM enriches the deterministic signals (null = the
 *                    deployment's server default).
 * - `promptStyle`  — the tone of the rewrite (see `prompts.ts`).
 * - `enrich`       — master switch for LLM enrichment; off = deterministic copy.
 * - `window`       — how far back the panel reads insights (maps to the read
 *                    endpoint's `since`).
 *
 * This module has no React or server-only imports so it can be used by the
 * client hook, the settings UI, and request-building helpers alike. The actual
 * model validation (against the configured providers) is server-only and lives
 * in `resolve-model.ts`.
 */

import {
  DEFAULT_PROMPT_STYLE,
  type InsightPromptStyle,
  isInsightPromptStyle,
} from './prompts'

export interface InsightsSettings {
  /** `provider:model` id, or null to use the deployment's server default. */
  readonly model: string | null
  /** Enrichment tone. */
  readonly promptStyle: InsightPromptStyle
  /** Master switch for LLM enrichment. */
  readonly enrich: boolean
  /** Read window (the panel's lookback), e.g. `6 HOUR`. */
  readonly window: string
}

interface WindowOption {
  readonly value: string
  readonly label: string
}

/** Selectable lookback windows for the panel. The first entry is the default. */
export const INSIGHT_WINDOWS: readonly WindowOption[] = [
  { value: '6 HOUR', label: 'Last 6 hours' },
  { value: '24 HOUR', label: 'Last 24 hours' },
  { value: '3 DAY', label: 'Last 3 days' },
  { value: '7 DAY', label: 'Last 7 days' },
] as const

const WINDOW_VALUES = new Set<string>(INSIGHT_WINDOWS.map((w) => w.value))

export const DEFAULT_INSIGHTS_SETTINGS: InsightsSettings = {
  model: null,
  promptStyle: DEFAULT_PROMPT_STYLE,
  enrich: true,
  window: INSIGHT_WINDOWS[0].value,
}

/** True when `value` is a selectable read window. */
export function isInsightWindow(value: unknown): value is string {
  return typeof value === 'string' && WINDOW_VALUES.has(value)
}

/**
 * Coerce arbitrary input (parsed localStorage, query params) into valid
 * settings. Unknown / malformed fields fall back to their defaults, so a
 * corrupt or partial payload never breaks generation.
 */
export function sanitizeInsightsSettings(
  input: Partial<Record<keyof InsightsSettings, unknown>> | null | undefined
): InsightsSettings {
  // Spread so a null/garbage input never hands back the shared default object
  // (callers must not be able to mutate the module-level constant).
  if (!input || typeof input !== 'object') {
    return { ...DEFAULT_INSIGHTS_SETTINGS }
  }

  const model =
    typeof input.model === 'string' && input.model.trim().length > 0
      ? input.model.trim()
      : null

  const promptStyle = isInsightPromptStyle(input.promptStyle)
    ? input.promptStyle
    : DEFAULT_PROMPT_STYLE

  // Accept real booleans and the string forms that arrive from query params.
  const enrich =
    typeof input.enrich === 'boolean'
      ? input.enrich
      : input.enrich === 'true'
        ? true
        : input.enrich === 'false'
          ? false
          : DEFAULT_INSIGHTS_SETTINGS.enrich

  const window = isInsightWindow(input.window)
    ? input.window
    : DEFAULT_INSIGHTS_SETTINGS.window

  return { model, promptStyle, enrich, window }
}

/**
 * Build the query string for `POST /api/v1/insights/generate` from settings.
 * Only includes parameters that differ from the server default, keeping URLs
 * clean and letting the server apply its own defaults when omitted.
 *
 * `force` maps to the `force=true` param that bypasses the server-side
 * min-interval regeneration throttle. Pass it for an explicit user "Refresh";
 * omit it for auto/background generation so the throttle can short-circuit.
 */
export function generateParamsFromSettings(
  hostId: number,
  settings: InsightsSettings,
  opts: { force?: boolean } = {}
): string {
  const params = new URLSearchParams({ host: String(hostId) })
  if (!settings.enrich) {
    params.set('enrich', 'false')
  } else {
    if (settings.model) params.set('model', settings.model)
    if (settings.promptStyle !== DEFAULT_PROMPT_STYLE) {
      params.set('promptStyle', settings.promptStyle)
    }
  }
  if (opts.force) params.set('force', 'true')
  return params.toString()
}
