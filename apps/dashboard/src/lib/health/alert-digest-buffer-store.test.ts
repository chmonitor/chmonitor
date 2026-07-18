/**
 * Tests for the time-window digest buffer store (#2663).
 *
 * The buffer parks a finding's groupable delivery entries until a `flush_after`
 * deadline; a later sweep takes (reads + deletes) the due ones and groups them.
 * These tests exercise the real insert/select-due/delete SQL through a
 * behavioral D1 fake, the "only due rows" boundary, take-deletes-rows, and the
 * fail-open degrade with no / a throwing D1.
 */

import type { AlertPayload } from './adapters/types'
import type { BufferedDigestEntry } from './alert-digest-buffer-store'

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { beforeEach, describe, expect, test } from 'bun:test'

interface FakeBufferRow {
  id: string
  owner_id: string
  flush_after: number
  entry_json: string
  created_at: number
}

function makeFakeD1() {
  const rows: FakeBufferRow[] = []
  function prepare(sql: string) {
    const isInsert = /^\s*INSERT INTO/i.test(sql)
    const isSelect = /^\s*SELECT/i.test(sql)
    const isDelete = /^\s*DELETE/i.test(sql)
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            if (isInsert) {
              const [id, ownerId, flushAfter, entryJson, createdAt] = args as [
                string,
                string,
                number,
                string,
                number,
              ]
              rows.push({
                id,
                owner_id: ownerId,
                flush_after: flushAfter,
                entry_json: entryJson,
                created_at: createdAt,
              })
              return { meta: { changes: 1 } }
            }
            if (isDelete) {
              const ids = new Set(args as string[])
              const before = rows.length
              for (let i = rows.length - 1; i >= 0; i--) {
                if (ids.has(rows[i].id)) rows.splice(i, 1)
              }
              return { meta: { changes: before - rows.length } }
            }
            throw new Error('fake: run on unexpected sql')
          },
          async all<T>() {
            if (!isSelect) return { results: [] as T[] }
            const [ownerId, now] = args as [string, number]
            return {
              results: rows
                .filter((r) => r.owner_id === ownerId && r.flush_after <= now)
                .sort(
                  (a, b) => a.flush_after - b.flush_after
                ) as unknown as T[],
            }
          },
        }
      },
    }
  }
  return { prepare, _rows: rows }
}

function makeThrowingD1() {
  return {
    prepare() {
      throw new Error('boom: D1 unavailable')
    },
  }
}

let currentDb:
  | ReturnType<typeof makeFakeD1>
  | ReturnType<typeof makeThrowingD1>
  | null = null

installHealthPlatformMock(() => currentDb)

const { bufferDigestEntries, takeDueDigestEntries } = await import(
  './alert-digest-buffer-store'
)

function payload(over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    severity: 'warning',
    hostLabel: 'prod-ch',
    hostId: 0,
    metric: 'disk-usage',
    value: 82,
    title: 'Disk usage',
    label: '82% used',
    timestamp: '2026-07-18T00:00:00.000Z',
    ...over,
  }
}

const webhookEntry: BufferedDigestEntry = {
  kind: 'webhook',
  url: 'https://hooks.slack.com/services/T/B/X',
  text: '[WARNING] Disk usage — 82% used (host prod-ch)',
  payload: payload(),
}

beforeEach(() => {
  currentDb = makeFakeD1()
})

describe('alert-digest-buffer-store', () => {
  test('buffered entries become due only after flush_after', async () => {
    const ok = await bufferDigestEntries('', [webhookEntry], 1_000)
    expect(ok).toBe(true)

    // Not yet due.
    expect(await takeDueDigestEntries('', 999)).toEqual([])
    // Due at/after the deadline.
    const due = await takeDueDigestEntries('', 1_000)
    expect(due).toHaveLength(1)
    expect(due[0]).toMatchObject({ kind: 'webhook', url: webhookEntry.url })
  })

  test('take deletes the rows it returns (no re-flush)', async () => {
    await bufferDigestEntries('', [webhookEntry, webhookEntry], 500)
    const first = await takeDueDigestEntries('', 1_000)
    expect(first).toHaveLength(2)
    // Second take sees nothing — the rows were consumed.
    expect(await takeDueDigestEntries('', 1_000)).toEqual([])
  })

  test('take is owner-scoped', async () => {
    await bufferDigestEntries('owner-a', [webhookEntry], 500)
    await bufferDigestEntries('owner-b', [webhookEntry], 500)
    expect(await takeDueDigestEntries('owner-a', 1_000)).toHaveLength(1)
    expect(await takeDueDigestEntries('owner-b', 1_000)).toHaveLength(1)
  })

  test('buffering an empty list is a no-op (false)', async () => {
    expect(await bufferDigestEntries('', [], 1_000)).toBe(false)
  })

  test('fail-open: no D1 binding => false / []', async () => {
    currentDb = null
    expect(await bufferDigestEntries('', [webhookEntry], 1_000)).toBe(false)
    expect(await takeDueDigestEntries('', 1_000)).toEqual([])
  })

  test('fail-open: a throwing D1 never throws out of the store', async () => {
    currentDb = makeThrowingD1()
    expect(await bufferDigestEntries('', [webhookEntry], 1_000)).toBe(false)
    expect(await takeDueDigestEntries('', 1_000)).toEqual([])
  })
})
