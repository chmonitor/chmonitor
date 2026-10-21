/**
 * ClickHouse insights backend — the default.
 *
 * A thin adapter over the existing `lib/findings/findings-store.ts`, which owns
 * an app-created table on the monitored cluster. This preserves the original
 * behavior exactly (lazy CREATE TABLE, 30-day TTL, best-effort writes) while
 * fitting the pluggable `InsightsStore` interface. When `INSIGHTS_STORE_BACKEND`
 * is unset (`auto`), this is what `resolveInsightsStore` returns.
 */

import type {
  Finding,
  FindingRow,
  InsightsStore,
  ListFindingsOptions,
} from './types'

import { reservedInsightStoreEngine } from '../types'
import { ErrorLogger } from '@chm/logger'
import {
  listRecentFindings,
  recordFinding,
} from '@/lib/findings/findings-store'

// Engines already announced as unsupported, so the notice is logged once per
// process instead of once per sweep.
const declinedEngines = new Set<string>()

/**
 * PeerDB / Postgres insights are keyed by reserved host offsets that are not
 * ClickHouse host indexes; getClient() rejects them. Decline them here, once,
 * with the fix named, instead of failing on every sweep.
 */
function declinesReservedHost(hostId: number): boolean {
  const engine = reservedInsightStoreEngine(hostId)
  if (!engine) return false
  if (!declinedEngines.has(engine)) {
    declinedEngines.add(engine)
    ErrorLogger.logWarning(
      `[insights-clickhouse-store] ${engine} insights are not stored by the ClickHouse backend; set INSIGHTS_STORE_BACKEND=postgres|d1 to persist them`,
      { component: 'insights-clickhouse-store' }
    )
  }
  return true
}

export class ClickHouseInsightsStore implements InsightsStore {
  readonly backend = 'clickhouse' as const

  async record(hostId: number, findings: Finding[]): Promise<boolean> {
    if (findings.length === 0) return true
    if (declinesReservedHost(hostId)) return false
    try {
      // recordFinding is itself best-effort (returns false on read-only
      // clusters). Guard Promise.all anyway: a single unexpected rejection must
      // not propagate — the InsightsStore contract is no-throw.
      const results = await Promise.all(
        findings.map((f) => recordFinding(hostId, f))
      )
      return results.every(Boolean)
    } catch (err) {
      ErrorLogger.logWarning(
        `[insights-clickhouse-store] failed to record findings on host ${hostId}: ${err}`,
        { component: 'insights-clickhouse-store' }
      )
      return false
    }
  }

  async list(
    hostId: number,
    opts?: ListFindingsOptions
  ): Promise<FindingRow[]> {
    // listRecentFindings is best-effort (returns [] on error), but guard against
    // an unexpected throw to keep the no-throw contract.
    if (declinesReservedHost(hostId)) return []
    try {
      return await listRecentFindings(hostId, opts)
    } catch (err) {
      ErrorLogger.logWarning(
        `[insights-clickhouse-store] failed to list findings on host ${hostId}: ${err}`,
        { component: 'insights-clickhouse-store' }
      )
      return []
    }
  }
}
