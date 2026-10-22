/**
 * Optional LLM enrichment for insight candidates.
 *
 * When a provider key is configured, candidates are passed through a single
 * `generateObject` call that tightens the wording and adds a one-line
 * recommendation. When no key is configured (or the call fails), candidates are
 * returned unchanged — this is the "if available" half of the feature, so the
 * panel always works without an LLM.
 */

import { z } from 'zod'

import type { InsightPromptStyle } from './prompts'
import type { InsightCandidate } from './types'

import {
  DEFAULT_MODEL,
  resolveAgentChatModel,
} from '../ai/agent/provider-chat-model'
import { isProviderConfigured, resolveProvider } from '../ai/providers'
import { resolveEnrichMaxOutputTokens } from './enrich-config'
import { promptSystemFor } from './prompts'
import { ErrorLogger } from '@chm/logger'
import { generateObject } from 'ai'

const COMPONENT = 'insights-enrich'

/** Per-request overrides for enrichment. */
export interface EnrichOptions {
  /** Validated `provider:model` id; falls back to `DEFAULT_MODEL` when unset. */
  readonly model?: string
  /** Tone of the rewrite (see `prompts.ts`). */
  readonly promptStyle?: InsightPromptStyle
}

/** True when the given model's provider has an API key on this deployment. */
export function isModelAvailable(model: string): boolean {
  try {
    return isProviderConfigured(resolveProvider(model).providerId)
  } catch {
    return false
  }
}

/** True when the default model's provider has an API key on this deployment. */
export function isLlmAvailable(): boolean {
  return isModelAvailable(DEFAULT_MODEL)
}

const EnrichedSchema = z.object({
  insights: z.array(
    z.object({
      title: z.string().describe('Concise, specific headline (<= 70 chars)'),
      detail: z
        .string()
        .describe('1-2 sentences: what it means and why it matters'),
      recommendation: z
        .string()
        .optional()
        .describe('One concrete next step, if any'),
    })
  ),
})

/**
 * Enrich candidates with the LLM. Returns candidates unchanged if the LLM is
 * unavailable or anything goes wrong. The numeric/severity/action fields from
 * the deterministic collector are always preserved — the model only rewrites
 * the human-facing copy.
 */
export async function enrichInsights(
  candidates: InsightCandidate[],
  opts: EnrichOptions = {}
): Promise<InsightCandidate[]> {
  if (candidates.length === 0) return candidates

  const effectiveModel = opts.model?.trim() || DEFAULT_MODEL
  if (!isModelAvailable(effectiveModel)) return candidates

  try {
    const { model } = resolveAgentChatModel({ model: effectiveModel })

    const { object } = await generateObject({
      model,
      schema: EnrichedSchema,
      maxRetries: 1,
      maxOutputTokens: resolveEnrichMaxOutputTokens(),
      abortSignal: AbortSignal.timeout(20_000),
      system: promptSystemFor(opts.promptStyle),
      prompt: JSON.stringify(
        candidates.map((c) => ({
          severity: c.severity,
          category: c.category,
          title: c.title,
          detail: c.detail,
          metric: c.metric,
          value: c.value,
        }))
      ),
    })

    // Map back positionally; fall back to the original when the model returns
    // a mismatched count.
    if (object.insights.length !== candidates.length) return candidates

    return candidates.map((candidate, i) => {
      const e = object.insights[i]
      const detail = e.recommendation
        ? `${e.detail} ${e.recommendation}`.trim()
        : e.detail
      return {
        ...candidate,
        title: e.title?.trim() || candidate.title,
        detail: detail?.trim() || candidate.detail,
      }
    })
  } catch (err) {
    ErrorLogger.logWarning(`[insights-enrich] enrichment failed: ${err}`, {
      component: COMPONENT,
    })
    return candidates
  }
}
