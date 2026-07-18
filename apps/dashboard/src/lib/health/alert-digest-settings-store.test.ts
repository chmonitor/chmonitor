/**
 * Tests for the time-window digest settings store (#2663).
 *
 * Digest on/off + window minutes are persisted as a reserved `__digest__` row
 * in the shared `alert_channel_config` table. These tests exercise the real
 * upsert/read SQL through a behavioral D1 fake, plus the env-fallback
 * resolution and the fail-open (no D1 / throwing D1) degrade.
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

interface FakeConfigRow {
  owner_id: string
  channel: string
  enabled: number
  target_json: string | null
  updated_at: number
}

function makeFakeD1() {
  const rows: FakeConfigRow[] = []
  function prepare(sql: string) {
    const isInsert = /^\s*INSERT INTO/i.test(sql)
    const isSelect = /^\s*SELECT/i.test(sql)
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            if (!isInsert) throw new Error('fake: run on non-insert')
            const [ownerId, channel, enabled, targetJson, updatedAt] = args as [
              string,
              string,
              number,
              string,
              number,
            ]
            const existing = rows.find(
              (r) => r.owner_id === ownerId && r.channel === channel
            )
            if (existing) {
              existing.enabled = enabled
              existing.target_json = targetJson
              existing.updated_at = updatedAt
            } else {
              rows.push({
                owner_id: ownerId,
                channel,
                enabled,
                target_json: targetJson,
                updated_at: updatedAt,
              })
            }
            return { meta: { changes: 1 } }
          },
          async all<T>() {
            if (!isSelect) return { results: [] as T[] }
            const [ownerId, channel] = args as [string, string]
            return {
              results: rows.filter(
                (r) => r.owner_id === ownerId && r.channel === channel
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

const { getDigestSettings, setDigestSettings, resolveDigestWindowMinutes } =
  await import('./alert-digest-settings-store')

beforeEach(() => {
  currentDb = makeFakeD1()
  delete process.env.HEALTH_ALERT_DIGEST_MINUTES
})

afterEach(() => {
  delete process.env.HEALTH_ALERT_DIGEST_MINUTES
})

describe('alert-digest-settings-store', () => {
  test('set then get round-trips enabled + window minutes', async () => {
    const saved = await setDigestSettings('', {
      enabled: true,
      windowMinutes: 30,
    })
    expect(saved).toEqual({ enabled: true, windowMinutes: 30 })

    const got = await getDigestSettings('')
    expect(got).toEqual({ enabled: true, windowMinutes: 30 })
  })

  test('clamps an absurd window to the 1440-minute cap', async () => {
    const saved = await setDigestSettings('', {
      enabled: true,
      windowMinutes: 99_999,
    })
    expect(saved?.windowMinutes).toBe(1440)
  })

  test('getDigestSettings returns null when no row exists', async () => {
    expect(await getDigestSettings('')).toBeNull()
  })

  test('resolve: D1 row wins over env; disabled row => 0', async () => {
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '15'
    await setDigestSettings('', { enabled: true, windowMinutes: 45 })
    expect(await resolveDigestWindowMinutes('')).toBe(45)

    await setDigestSettings('', { enabled: false, windowMinutes: 45 })
    expect(await resolveDigestWindowMinutes('')).toBe(0)
  })

  test('resolve: falls back to env when no row', async () => {
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '20'
    expect(await resolveDigestWindowMinutes('')).toBe(20)
  })

  test('fail-open: no D1 binding => set null, get null, resolve uses env', async () => {
    currentDb = null
    process.env.HEALTH_ALERT_DIGEST_MINUTES = '10'
    expect(
      await setDigestSettings('', { enabled: true, windowMinutes: 5 })
    ).toBeNull()
    expect(await getDigestSettings('')).toBeNull()
    expect(await resolveDigestWindowMinutes('')).toBe(10)
  })

  test('fail-open: a throwing D1 never throws out of the store', async () => {
    currentDb = makeThrowingD1()
    expect(await getDigestSettings('')).toBeNull()
    expect(
      await setDigestSettings('', { enabled: true, windowMinutes: 5 })
    ).toBeNull()
  })
})
