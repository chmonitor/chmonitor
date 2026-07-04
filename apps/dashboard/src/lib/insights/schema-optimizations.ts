/**
 * Schema-optimization insight mapping (pure).
 *
 * Turns the query advisor's ranked {@link Recommendation}s (skip index,
 * projection, partition key, PREWHERE rewrite) into insight candidates surfaced
 * on the `/insights` page under the "Optimization" category. The I/O — picking
 * representative slow queries and calling `analyzeQuery` per query — lives in
 * `collectors.ts`; this module is the pure classifier/mapper so it is
 * unit-tested without ClickHouse (mirrors `operational-checks.ts`).
 *
 * Determinism matters: the stable dismissal key is `host:category:metric:title`
 * (see `types.ts`). Both `metric` and `title` are derived only from the
 * recommendation kind, table, and title text — never from run-to-run impact
 * numbers (granulesSaved, bytes) — so a dismissed suggestion does not resurrect
 * on the next cron sweep when the estimate shifts. Impact numbers are carried in
 * `detail`/`value` only, which are not part of the key.
 */

import type { Recommendation } from '@/lib/ai/advisor/types'
import type { InsightCandidate } from './types'

/** A single query's advisor analysis, reduced to what the mapper needs. */
export interface AnalyzedQuery {
  readonly database: string
  readonly table: string
  readonly recommendations: readonly Recommendation[]
}

/** Cap on how many optimization cards the page surfaces at once. */
export const MAX_SCHEMA_OPTIMIZATIONS = 3

/** Slugify a recommendation title into a stable, key-safe metric fragment. */
export function metricSlug(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
}

/**
 * Build the deterministic machine metric for a recommendation. Distinct per
 * (kind, table, recommendation) so `collectInsights`' `${category}:${metric}`
 * dedup does not collapse several suggestions into one, and stable across runs
 * so dismissals stick.
 */
export function schemaOptMetric(
  database: string,
  table: string,
  rec: Recommendation
): string {
  return `schema_opt:${rec.kind}:${database}.${table}:${metricSlug(rec.title)}`
}

/**
 * Map advisor analysis results to schema-optimization insight candidates.
 *
 * - Keeps only recommendations with a *known* estimate (`!unknown`) so the card
 *   states a real figure rather than "unknown".
 * - De-duplicates by the deterministic metric (same suggestion on the same
 *   table appears once even if two sampled queries hit it).
 * - Ranks by estimated granules saved (desc) and caps at
 *   {@link MAX_SCHEMA_OPTIMIZATIONS}.
 *
 * All suggestions are `info` severity — they are recommend-only optimizations,
 * not incidents. The action deep-links to the agent so the operator can pull the
 * full DDL/rewrite (which the scalar findings store does not persist).
 */
export function selectSchemaOptimizations(
  results: readonly AnalyzedQuery[]
): InsightCandidate[] {
  const byMetric = new Map<
    string,
    { candidate: InsightCandidate; granulesSaved: number }
  >()

  for (const result of results) {
    for (const rec of result.recommendations) {
      if (rec.estImpact.unknown) continue

      const metric = schemaOptMetric(result.database, result.table, rec)
      if (byMetric.has(metric)) continue

      const table = `${result.database}.${result.table}`
      byMetric.set(metric, {
        granulesSaved: rec.estImpact.granulesSaved,
        candidate: {
          severity: 'info',
          category: 'optimization',
          metric,
          title: `${rec.title} on ${table}`,
          detail: `${rec.rationale} ${rec.estImpact.summary}`,
          value: rec.estImpact.granulesSaved,
          action: {
            label: 'Ask the agent',
            prompt: `Analyze ${table} and show the DDL for: ${rec.title}. Explain the estimated impact, risk, and how to validate it.`,
          },
        },
      })
    }
  }

  return [...byMetric.values()]
    .sort((a, b) => b.granulesSaved - a.granulesSaved)
    .slice(0, MAX_SCHEMA_OPTIMIZATIONS)
    .map((entry) => entry.candidate)
}
