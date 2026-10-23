/**
 * Build an optimization plan from the findings the advisors already persisted.
 * Reads the insights store only: no ClickHouse scan, no write, no DDL run.
 */

import type { FindingRow } from '@/lib/findings/findings-store'
import type {
  Plan,
  PlanCandidate,
  PlanSource,
  SkippedCollector,
} from './schema'

import { candidateFromFinding, collectorOf } from './items'
import { rankPlan } from './ranker'
import { DEFAULT_REWRITE_MBPS, planSchema } from './schema'
import { resolveInsightsStore } from '@/lib/insights/store/resolve-store'
import { INSIGHT_SOURCES } from '@/lib/insights/types'

/** Findings older than this are not planned; the sweep re-inserts live ones. */
export const PLAN_FINDINGS_SINCE = '24 HOUR'
const PLAN_FINDINGS_LIMIT = 1000

/** Collectors that read persisted findings, and the advisor each one reads. */
export const PLAN_COLLECTORS: readonly PlanSource[] = [
  'usage',
  'detached',
  'ttl',
  'settings',
]

const NOT_BUILT: SkippedCollector = {
  collector: 'codec',
  reason:
    'The measured codec and type advisor (#4068) was closed without a collector, so there are no codec findings to plan.',
}

/** Pure part: rows in, plan out. Newest row wins per metric. */
export function planFromFindings(
  hostId: number,
  rows: readonly FindingRow[],
  opts: { rewriteMBps?: number; now?: Date } = {}
): Plan {
  const rewriteMBps = opts.rewriteMBps ?? DEFAULT_REWRITE_MBPS
  const skipped: SkippedCollector[] = [NOT_BUILT]
  const relevant = rows.filter((r) =>
    INSIGHT_SOURCES.includes(r.source as (typeof INSIGHT_SOURCES)[number])
  )
  if (relevant.length === 0) {
    for (const collector of PLAN_COLLECTORS)
      skipped.push({
        collector,
        reason: `No insights were stored for this host in the last ${PLAN_FINDINGS_SINCE.toLowerCase()}. Generate insights, then rebuild the plan.`,
      })
  }

  const newest = new Map<string, FindingRow>()
  for (const row of relevant) {
    if (!row.metric || !collectorOf(row)) continue
    const prev = newest.get(row.metric)
    if (!prev || row.event_time > prev.event_time) newest.set(row.metric, row)
  }

  const candidates: PlanCandidate[] = []
  for (const row of newest.values()) {
    const c = candidateFromFinding(row, rewriteMBps)
    if (c) candidates.push(c)
  }
  const { items, rejected } = rankPlan(candidates)

  return planSchema.parse({
    notApplied: true,
    hostId,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    findingsSince: PLAN_FINDINGS_SINCE,
    rewriteMBps,
    collectorsRan: relevant.length === 0 ? [] : [...PLAN_COLLECTORS],
    items,
    skipped,
    testedAndRejected: rejected,
  })
}

export async function buildOptimizationPlan(
  hostId: number,
  opts: { rewriteMBps?: number } = {}
): Promise<Plan> {
  let rows: FindingRow[]
  try {
    const store = await resolveInsightsStore()
    rows = await store.list(hostId, {
      since: PLAN_FINDINGS_SINCE,
      limit: PLAN_FINDINGS_LIMIT,
    })
  } catch (err) {
    const reason = `Insights store unavailable: ${err instanceof Error ? err.message : String(err)}`
    return planSchema.parse({
      notApplied: true,
      hostId,
      generatedAt: new Date().toISOString(),
      findingsSince: PLAN_FINDINGS_SINCE,
      rewriteMBps: opts.rewriteMBps ?? DEFAULT_REWRITE_MBPS,
      collectorsRan: [],
      items: [],
      skipped: [
        NOT_BUILT,
        ...PLAN_COLLECTORS.map((collector) => ({ collector, reason })),
      ],
      testedAndRejected: [],
    })
  }
  return planFromFindings(hostId, rows, opts)
}
