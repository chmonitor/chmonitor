/**
 * Prompt-style templates for AI insight enrichment.
 *
 * The deterministic collectors always produce a baseline title/detail. When LLM
 * enrichment runs, the operator can choose the *tone* of the rewrite. Each style
 * maps to a system prompt; the user prompt (the JSON candidate array) is the
 * same regardless of style. Keeping the styles here — rather than inline in
 * `llm-enrich.ts` — lets the settings UI list them and keeps the copy in one
 * place.
 */

export type InsightPromptStyle = 'concise' | 'detailed' | 'beginner'

/** The default style, matching the original inline prompt. */
export const DEFAULT_PROMPT_STYLE: InsightPromptStyle = 'concise'

interface PromptStyleDef {
  /** Stable id used in settings + the generate API. */
  readonly id: InsightPromptStyle
  readonly label: string
  readonly description: string
  /** System prompt sent to the model for this style. */
  readonly system: string
}

const SHARED_RULES =
  'Keep the same meaning and severity as each input signal. Be specific and avoid filler. Return exactly one entry per input, in order.'

export const INSIGHT_PROMPT_STYLES: readonly PromptStyleDef[] = [
  {
    id: 'concise',
    label: 'Concise',
    description: 'Crisp, scannable one-liners for experienced operators.',
    system: `You are a senior ClickHouse SRE. Rewrite each monitoring signal into a crisp, actionable insight for an operator. ${SHARED_RULES}`,
  },
  {
    id: 'detailed',
    label: 'Detailed',
    description:
      'Adds a likely root cause and a concrete next step for each signal.',
    system: `You are a senior ClickHouse SRE writing an incident note. For each monitoring signal, write a clear title and a detail that names the most likely root cause and its operational impact, then give one concrete next step as the recommendation. ${SHARED_RULES}`,
  },
  {
    id: 'beginner',
    label: 'Beginner-friendly',
    description:
      'Plain language that explains the ClickHouse concept for newcomers.',
    system: `You are a friendly ClickHouse mentor. Rewrite each monitoring signal in plain language for someone new to ClickHouse: explain what the metric means and why it matters before the recommendation, avoiding unexplained jargon. ${SHARED_RULES}`,
  },
] as const

const STYLE_IDS = new Set<string>(INSIGHT_PROMPT_STYLES.map((s) => s.id))

export function isInsightPromptStyle(
  value: unknown
): value is InsightPromptStyle {
  return typeof value === 'string' && STYLE_IDS.has(value)
}

/** Resolve a style id to its definition, falling back to the default. */
export function resolvePromptStyle(
  style: string | null | undefined
): PromptStyleDef {
  return (
    INSIGHT_PROMPT_STYLES.find((s) => s.id === style) ??
    INSIGHT_PROMPT_STYLES.find((s) => s.id === DEFAULT_PROMPT_STYLE)!
  )
}

export function promptSystemFor(style: string | null | undefined): string {
  return resolvePromptStyle(style).system
}
