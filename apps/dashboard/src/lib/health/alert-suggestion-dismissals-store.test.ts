/**
 * Tests for the D1-backed alert-suggestion dismissal store (issue #2667).
 *
 * A behavioral fake of D1Database (prepare/bind/run/all) injected via a mocked
 * @chm/platform exercises the real SQL: dismissal persists per owner+key,
 * survives a re-list, is idempotent (ON CONFLICT DO NOTHING), stays owner
 * scoped, the READ path fails OPEN (empty set, never throws) when no binding is
 * present, and the WRITE path fails LOUD (throws NOT_CONFIGURED) so a no-op
 * dismissal can't silently resurrect a card. Mirrors `baseline-store.test.ts`.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { beforeEach, describe, expect, test } from 'bun:test'

interface FakeDismissalRow {
  owner_id: string
  suggestion_key: string
  dismissed_at: number
}

function makeFakeD1() {
  const rows = new Map<string, FakeDismissalRow>()
  const keyFor = (owner: string, key: string) => `${owner}::${key}`

  function prepare(sql: string) {
    const isInsert = /INSERT INTO/i.test(sql)
    return {
      // The lazy migration runs `.run()` directly off prepare() (no bind()).
      async run() {
        return { meta: { changes: 0 } }
      },
      bind(...args: unknown[]) {
        return {
          async run() {
            if (isInsert) {
              const [owner, key, at] = args as [string, string, number]
              const k = keyFor(owner, key)
              if (!rows.has(k)) {
                rows.set(k, {
                  owner_id: owner,
                  suggestion_key: key,
                  dismissed_at: at,
                })
              }
            }
            return { meta: { changes: 1 } }
          },
          async all<T>(): Promise<{ results: T[] }> {
            const [owner] = args as [string]
            const out = [...rows.values()].filter((r) => r.owner_id === owner)
            return { results: out as unknown as T[] }
          },
        }
      },
    }
  }

  return { prepare, _rows: rows }
}

let currentDb: ReturnType<typeof makeFakeD1> | null = null

installHealthPlatformMock(() => currentDb)

const {
  listDismissedSuggestionKeys,
  dismissSuggestion,
  SuggestionDismissalStoreError,
  _resetSuggestionDismissalMigration,
} = await import('./alert-suggestion-dismissals-store')

beforeEach(() => {
  currentDb = makeFakeD1()
  _resetSuggestionDismissalMigration()
})

describe('alert-suggestion-dismissals-store', () => {
  test('dismiss then list round-trips the key, owner-scoped', async () => {
    await dismissSuggestion('oss', 'disk-usage-percent:host:0')
    const keys = await listDismissedSuggestionKeys('oss')
    expect(keys.has('disk-usage-percent:host:0')).toBe(true)

    // A different owner sees nothing.
    expect((await listDismissedSuggestionKeys('other')).size).toBe(0)
  })

  test('dismiss is idempotent (no duplicate rows)', async () => {
    await dismissSuggestion('oss', 'stuck-merges:host:1')
    await dismissSuggestion('oss', 'stuck-merges:host:1')
    const keys = await listDismissedSuggestionKeys('oss')
    expect([...keys]).toEqual(['stuck-merges:host:1'])
  })

  test('list returns an empty set for an owner with no dismissals', async () => {
    expect((await listDismissedSuggestionKeys('oss')).size).toBe(0)
  })

  test('read fails OPEN (empty set) when no D1 binding is present', async () => {
    currentDb = null
    expect((await listDismissedSuggestionKeys('oss')).size).toBe(0)
  })

  test('write fails LOUD (NOT_CONFIGURED) when no D1 binding is present', async () => {
    currentDb = null
    let thrown: unknown
    try {
      await dismissSuggestion('oss', 'x:host:0')
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(SuggestionDismissalStoreError)
    expect(
      (thrown as InstanceType<typeof SuggestionDismissalStoreError>).code
    ).toBe('NOT_CONFIGURED')
  })
})
