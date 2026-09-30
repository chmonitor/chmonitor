/**
 * #3534 — maintainer decision: in-memory alert state is DISCARDED, not
 * migrated, when a metadata DB is attached later.
 *
 * Why it matters: without a DB, hysteresis streaks and incident timers live in
 * memory per worker. If the first hydrate against a newly attached DB merged
 * them in, the next flush would persist memory-only state (a half-built
 * streak, a `firstFiredAt` from before the DB existed) as if it were durable
 * history. The DB must start fresh instead.
 */

import type { AlertStateRecord } from './alert-state-store'

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { describe, expect, test } from 'bun:test'

interface Row {
  host_id: number
  rule_id: string
  severity: string
  updated_at: number
  notified_at: number
  first_fired_at: number | null
  pending_severity: string | null
  pending_count: number | null
}

/** Minimal fake D1: DDL is a no-op, SELECT returns `rows`, batch upserts. */
function makeFakeD1(rows: Row[]) {
  function prepare(sql: string) {
    let args: unknown[] = []
    const stmt = {
      sql,
      bind(...a: unknown[]) {
        args = a
        return stmt
      },
      async run() {
        return { success: true }
      },
      async all<T>() {
        return { results: rows as unknown as T[] }
      },
      get args() {
        return args
      },
    }
    return stmt
  }
  async function batch(stmts: ReturnType<typeof prepare>[]) {
    for (const s of stmts) {
      if (!s.sql.trim().startsWith('INSERT')) continue
      const [host_id, rule_id, severity, updated_at, notified_at, ff, ps, pc] =
        s.args as [number, string, string, number, number, null, null, null]
      rows.push({
        host_id,
        rule_id,
        severity,
        updated_at,
        notified_at,
        first_fired_at: ff,
        pending_severity: ps,
        pending_count: pc,
      })
    }
    return []
  }
  return { prepare, batch, rows }
}

let currentDb: ReturnType<typeof makeFakeD1> | null = null
installHealthPlatformMock(() => currentDb)

const { hydrateAlertState, flushAlertState } = await import(
  './alert-state-persist'
)
const { MemoryAlertStateStore, alertStateKey } = await import(
  './alert-state-store'
)

const memoryOnly: AlertStateRecord = {
  severity: 'warning',
  updatedAt: 1_000,
  notifiedAt: 0,
  firstFiredAt: 500,
  pendingSeverity: 'critical',
  pendingCount: 2,
}

describe('alert state on first metadata-DB attach (#3534: discard)', () => {
  test('memory state is kept without a DB, discarded on first attach, and never persisted', async () => {
    const store = new MemoryAlertStateStore()
    const memKey = alertStateKey(0, 'disk-usage')

    // No DB: hydrate/flush are no-ops, memory state survives across ticks.
    currentDb = null
    store.set(memKey, memoryOnly)
    await hydrateAlertState(store)
    await flushAlertState(store)
    expect(store.get(memKey)).toEqual(memoryOnly)

    // Operator attaches an empty DB. First hydrate discards memory state.
    const db = makeFakeD1([])
    currentDb = db
    await hydrateAlertState(store)
    expect(store.get(memKey)).toBeUndefined()

    // The following flush has nothing memory-only to migrate.
    await flushAlertState(store)
    expect(db.rows).toHaveLength(0)
  })

  test('after attach, a warm hydrate overlays the DB without clearing new records', async () => {
    const store = new MemoryAlertStateStore()
    const dbKey = alertStateKey(1, 'replication-lag')
    const freshKey = alertStateKey(1, 'parts')
    currentDb = makeFakeD1([
      {
        host_id: 1,
        rule_id: 'replication-lag',
        severity: 'critical',
        updated_at: 2_000,
        notified_at: 2_000,
        first_fired_at: 1_500,
        pending_severity: null,
        pending_count: null,
      },
    ])
    // A record committed this tick but not yet flushed must survive.
    store.set(freshKey, memoryOnly)
    await hydrateAlertState(store)
    expect(store.get(freshKey)).toEqual(memoryOnly)
    expect(store.get(dbKey)?.firstFiredAt).toBe(1_500)
  })
})
