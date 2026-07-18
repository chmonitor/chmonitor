/**
 * Unit tests for event-store.ts.
 *
 * WHY under test: (1) a repeat of the same dedup_hash must upsert in place
 * (bump count/last_seen) rather than insert a duplicate row — the whole point
 * of dedup_hash; (2) every read/write degrades gracefully (empty/false/0, no
 * throw) when CHM_CLOUD_D1 is unbound, which is the normal state on
 * self-host/local dev.
 *
 * Uses a minimal in-memory D1 fake injected via the shared
 * `./__tests__/platform-mock` fixture (issue #2777) so the `@chm/platform`
 * mock doesn't leak across sibling event-bus test files.
 */

import type { NormalizedEvent } from './types'

import { installEventsPlatformMock } from './__tests__/platform-mock'
import { beforeEach, describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// In-memory D1 fake
// ---------------------------------------------------------------------------

interface Row {
  dedup_hash: string
  id: string
  source: string
  severity: string
  resource: string
  title: string
  body: string | null
  labels: string
  count: number
  received_at: number
  last_seen: number
}

function makeFakeD1(store: Map<string, Row>) {
  function prepare(sql: string) {
    const trimmed = sql.trim().toUpperCase()

    return {
      bind(...values: unknown[]) {
        return {
          async run() {
            if (trimmed.startsWith('INSERT')) {
              const [
                dedupHash,
                id,
                source,
                severity,
                resource,
                title,
                body,
                labels,
                receivedAt,
              ] = values as [
                string,
                string,
                string,
                string,
                string,
                string,
                string | null,
                string,
                number,
              ]
              const existing = store.get(dedupHash)
              if (existing) {
                existing.count += 1
                existing.last_seen = receivedAt
                existing.body = body
              } else {
                store.set(dedupHash, {
                  dedup_hash: dedupHash,
                  id,
                  source,
                  severity,
                  resource,
                  title,
                  body,
                  labels,
                  count: 1,
                  received_at: receivedAt,
                  last_seen: receivedAt,
                })
              }
              return { success: true, results: [], meta: {} }
            }

            if (trimmed.startsWith('DELETE')) {
              const [cutoff] = values as [number]
              let changes = 0
              for (const [key, row] of store) {
                if (row.last_seen < cutoff) {
                  store.delete(key)
                  changes += 1
                }
              }
              return { success: true, results: [], meta: { changes } }
            }

            return { success: true, results: [], meta: {} }
          },
          async all<T>() {
            if (!trimmed.startsWith('SELECT')) {
              return { results: [] as unknown as T[] }
            }
            let idx = 0
            const sinceMs = values[idx++] as number
            const wantsSource = sql.includes('source = ?')
            const wantsSeverity = sql.includes('severity = ?')
            const source = wantsSource ? (values[idx++] as string) : undefined
            const severity = wantsSeverity
              ? (values[idx++] as string)
              : undefined

            const rows = Array.from(store.values())
              .filter((r) => r.last_seen >= sinceMs)
              .filter((r) => !source || r.source === source)
              .filter((r) => !severity || r.severity === severity)
              .sort((a, b) => b.last_seen - a.last_seen)

            return { results: rows as unknown as T[] }
          },
        }
      },
    }
  }

  return { prepare }
}

// ---------------------------------------------------------------------------
// Inject via mocked platform (must happen before any import of the SUT)
// ---------------------------------------------------------------------------

let currentDb: ReturnType<typeof makeFakeD1> | null = null

installEventsPlatformMock(() => currentDb)

const { upsertEvent, listEvents, pruneEventsOlderThan, EVENT_RETENTION_MS } =
  await import('./event-store')

function makeEvent(overrides: Partial<NormalizedEvent> = {}): NormalizedEvent {
  return {
    id: 'occurrence-1',
    source: 'generic',
    severity: 'warning',
    resource: 'ch-node-1',
    title: 'Disk usage high',
    body: 'Disk usage at 90%',
    labels: { team: 'data-platform' },
    receivedAt: 1_000_000,
    dedupHash: 'hash-a',
    ...overrides,
  }
}

let store: Map<string, Row>

beforeEach(() => {
  store = new Map()
  currentDb = makeFakeD1(store)
})

describe('upsertEvent', () => {
  test('returns false and does nothing when D1 is unbound', async () => {
    currentDb = null
    const ok = await upsertEvent(makeEvent())
    expect(ok).toBe(false)
  })

  test('inserts a new row on first occurrence', async () => {
    const ok = await upsertEvent(makeEvent())
    expect(ok).toBe(true)
    expect(store.size).toBe(1)
    const row = store.get('hash-a')
    expect(row?.count).toBe(1)
    expect(row?.last_seen).toBe(1_000_000)
  })

  test('a repeat of the same dedup_hash bumps count/last_seen instead of duplicating', async () => {
    await upsertEvent(makeEvent({ receivedAt: 1_000_000 }))
    await upsertEvent(
      makeEvent({ receivedAt: 2_000_000, body: 'Disk usage at 95% now' })
    )

    expect(store.size).toBe(1) // no duplicate row
    const row = store.get('hash-a')
    expect(row?.count).toBe(2)
    expect(row?.last_seen).toBe(2_000_000)
    expect(row?.body).toBe('Disk usage at 95% now')
  })

  test('a different dedup_hash creates a separate row', async () => {
    await upsertEvent(makeEvent({ dedupHash: 'hash-a' }))
    await upsertEvent(makeEvent({ dedupHash: 'hash-b' }))
    expect(store.size).toBe(2)
  })
})

describe('listEvents', () => {
  test('returns an empty array when D1 is unbound', async () => {
    currentDb = null
    expect(await listEvents()).toEqual([])
  })

  test('returns stored events, most-recently-seen first', async () => {
    await upsertEvent(
      makeEvent({ dedupHash: 'hash-a', title: 'Older', receivedAt: 1_000 })
    )
    await upsertEvent(
      makeEvent({ dedupHash: 'hash-b', title: 'Newer', receivedAt: 2_000 })
    )
    const events = await listEvents({ sinceMs: 0 })
    expect(events.map((e) => e.title)).toEqual(['Newer', 'Older'])
    expect(events[0].labels).toEqual({ team: 'data-platform' })
  })

  test('filters by source and severity', async () => {
    await upsertEvent(
      makeEvent({
        dedupHash: 'hash-a',
        source: 'datadog',
        severity: 'critical',
        receivedAt: 1_000,
      })
    )
    await upsertEvent(
      makeEvent({
        dedupHash: 'hash-b',
        source: 'generic',
        severity: 'warning',
        receivedAt: 2_000,
      })
    )

    const critical = await listEvents({ sinceMs: 0, severity: 'critical' })
    expect(critical).toHaveLength(1)
    expect(critical[0].dedupHash).toBe('hash-a')

    const datadog = await listEvents({ sinceMs: 0, source: 'datadog' })
    expect(datadog).toHaveLength(1)
    expect(datadog[0].source).toBe('datadog')
  })

  test('defaults to the ~30d retention window, excluding stale rows', async () => {
    const now = Date.now()
    await upsertEvent(
      makeEvent({
        dedupHash: 'hash-old',
        receivedAt: now - EVENT_RETENTION_MS - 1,
      })
    )
    await upsertEvent(makeEvent({ dedupHash: 'hash-recent', receivedAt: now }))

    const events = await listEvents()
    expect(events.map((e) => e.dedupHash)).toEqual(['hash-recent'])
  })
})

describe('pruneEventsOlderThan', () => {
  test('returns 0 when D1 is unbound', async () => {
    currentDb = null
    expect(await pruneEventsOlderThan(Date.now())).toBe(0)
  })

  test('deletes only rows last seen before the cutoff', async () => {
    await upsertEvent(makeEvent({ dedupHash: 'hash-old', receivedAt: 1_000 }))
    await upsertEvent(makeEvent({ dedupHash: 'hash-new', receivedAt: 9_000 }))

    const deleted = await pruneEventsOlderThan(5_000)
    expect(deleted).toBe(1)
    expect(store.has('hash-old')).toBe(false)
    expect(store.has('hash-new')).toBe(true)
  })
})
