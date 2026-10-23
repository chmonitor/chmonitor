/**
 * Pure ranker for the optimization plan. No I/O.
 *
 * Order: items with a measured gain first, by gain over apply time
 * (`gain / (1 + estHours)`), then items whose gain is not measured, by risk.
 * A high-risk item is never hidden: it is listed in rank order with
 * `needsOwnerApproval: true`. `dependsOn` is honoured on top of that order, and
 * an item whose dependency is missing or circular goes to `testedAndRejected`.
 */

import type { PlanCandidate, PlanItem, PlanRisk, RejectedItem } from './schema'

import { DEFAULT_REWRITE_MBPS } from './schema'

/** Days of read savings counted against a one-off saving. */
export const READ_SAVINGS_DAYS = 30

const RISK_ORDER: Record<PlanRisk, number> = { low: 0, medium: 1, high: 2 }

/** Hours to rewrite `bytes` at `mbps` MB/s; null when bytes are unknown. */
export function estimateHours(
  bytes: number | null,
  mbps: number = DEFAULT_REWRITE_MBPS
): number | null {
  if (bytes == null) return null
  return Math.round((bytes / (mbps * 1e6) / 3600) * 100) / 100
}

/** Measured gain in bytes, or null when neither saving is known. */
export function gainOf(c: PlanCandidate): number | null {
  if (c.savedBytes == null && c.readBytesSavedPerDay == null) return null
  return (c.savedBytes ?? 0) + (c.readBytesSavedPerDay ?? 0) * READ_SAVINGS_DAYS
}

function compare(a: PlanCandidate, b: PlanCandidate): number {
  const ga = gainOf(a)
  const gb = gainOf(b)
  if ((ga == null) !== (gb == null)) return ga == null ? 1 : -1
  if (ga != null && gb != null) {
    const sa = ga / (1 + (a.applyCost.estHours ?? 0))
    const sb = gb / (1 + (b.applyCost.estHours ?? 0))
    if (sa !== sb) return sb - sa
  }
  const byRisk = RISK_ORDER[a.risk] - RISK_ORDER[b.risk]
  if (byRisk !== 0) return byRisk
  return a.id.localeCompare(b.id)
}

export function rankPlan(candidates: readonly PlanCandidate[]): {
  items: PlanItem[]
  rejected: RejectedItem[]
} {
  const rejected: RejectedItem[] = []
  const byId = new Map<string, PlanCandidate>()
  for (const c of candidates) {
    if (byId.has(c.id)) {
      rejected.push({ item: c, reason: `Duplicate item id ${c.id}.` })
      continue
    }
    byId.set(c.id, c)
  }

  // Drop items with a missing dependency, transitively.
  let changed = true
  while (changed) {
    changed = false
    for (const [id, c] of byId) {
      const missing = c.dependsOn.find((d) => !byId.has(d))
      if (missing) {
        byId.delete(id)
        rejected.push({
          item: c,
          reason: `Depends on ${missing}, which is not in the plan.`,
        })
        changed = true
      }
    }
  }

  const sorted = [...byId.values()].sort(compare)
  const done = new Set<string>()
  const ordered: PlanCandidate[] = []
  let progress = true
  while (progress) {
    progress = false
    const next = sorted.find(
      (c) => !done.has(c.id) && c.dependsOn.every((d) => done.has(d))
    )
    if (next) {
      done.add(next.id)
      ordered.push(next)
      progress = true
    }
  }
  for (const c of sorted) {
    if (!done.has(c.id))
      rejected.push({ item: c, reason: 'Circular dependsOn.' })
  }

  const items = ordered.map((c, i) => ({
    ...c,
    rank: i + 1,
    needsOwnerApproval: c.needsOwnerApproval || c.risk === 'high',
  }))
  return { items, rejected }
}
