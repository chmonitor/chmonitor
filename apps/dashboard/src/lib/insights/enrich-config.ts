/**
 * Env-driven knobs for insight LLM enrichment. Dependency-free on purpose: the
 * health sweep imports it without linking the AI SDK.
 */

import type { GenerateInsightsOptions } from './generate-insights'

import { parseBool } from '../config/parse-bool'

/** Output cap for one enrichment call; same convention as the agent. */
export const DEFAULT_ENRICH_MAX_OUTPUT_TOKENS = 4096

/** Ceiling for `INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS`; larger values are clamped. */
export const MAX_ENRICH_MAX_OUTPUT_TOKENS = 16384

/**
 * `INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS`: a positive integer, clamped to
 * {@link MAX_ENRICH_MAX_OUTPUT_TOKENS}. Unset, empty, non-numeric, fractional
 * or non-positive values fall back to the default.
 */
export function resolveEnrichMaxOutputTokens(
  raw: string | undefined = process.env.INSIGHTS_ENRICH_MAX_OUTPUT_TOKENS
): number {
  const text = raw?.trim()
  if (!text || !/^\d+$/.test(text)) return DEFAULT_ENRICH_MAX_OUTPUT_TOKENS
  const n = Number(text)
  if (!Number.isSafeInteger(n) || n <= 0) {
    return DEFAULT_ENRICH_MAX_OUTPUT_TOKENS
  }
  return Math.min(n, MAX_ENRICH_MAX_OUTPUT_TOKENS)
}

/** `INSIGHTS_SWEEP_ENRICH`: defaults to true; only a false value turns it off. */
export function isSweepEnrichEnabled(
  raw: string | undefined = process.env.INSIGHTS_SWEEP_ENRICH
): boolean {
  return parseBool(raw) ?? true
}

/**
 * Options the health sweep passes to `generateInsights`. When sweep enrichment
 * is off the sweep stores the deterministic text only, like the UI auto path.
 */
export function sweepInsightOptions(): GenerateInsightsOptions {
  return isSweepEnrichEnabled() ? {} : { enrich: false }
}
