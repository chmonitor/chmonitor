/**
 * Characterization tests for GET /api/cron/retention-prune — the CRON_SECRET
 * auth gate (fail-closed 503 / 401) and the per-user prune loop (D1-unbound
 * no-op, delete-with-cutoff, enterprise skip, resolution-error skip). Exercises
 * the real handler via the test-only `__handlerForTests` export so a regression
 * that bypasses auth or inverts the cutoff comparison (`<` → `>`, deleting
 * *recent* data instead of old data) fails a test instead of shipping green.
 *
 * `cloudflare:workers` is stubbed to `{ env: {} }` so `import { env } from
 * 'cloudflare:workers'` resolves under bun and the route falls through to the
 * `process.env.CRON_SECRET` fallback it already supports — CRON_SECRET is
 * driven entirely via `process.env` here (set in `beforeEach`, restored in
 * `afterEach` since `bun test` runs every file in one process).
 *
 * `@chm/platform` and `@/lib/billing/retention-owner` are mocked (mirrors the
 * stable-wrapper-delegating-to-a-per-test-`let`-binding style in
 * routes/api/v1/webhooks/polar.test.ts); `@/lib/billing/entitlements`
 * (`retentionCutoffMs`) is used for real — both to exercise the real cutoff
 * arithmetic and so the cutoff-bound assertions never hardcode the day-math
 * constant. `createFileRoute` is left un-mocked, matching the rest of the
 * repo's route tests.
 *
 * The fake D1 only implements the two statement shapes retention-prune.ts
 * actually issues: `SELECT DISTINCT user_id ...` (`.prepare(sql).all()`) and
 * `DELETE ... WHERE user_id = ?1 AND updated_at < ?2` (`.prepare(sql).bind(...).run()`),
 * recording each DELETE's SQL text + bound args so tests can assert the
 * comparison operator and cutoff value directly rather than trusting the fake.
 */

import type { Plan } from '@/lib/billing/plans'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { retentionCutoffMs } from '@/lib/billing/entitlements'
import { getPlan } from '@/lib/billing/plans'

mock.module('cloudflare:workers', () => ({ env: {} }))

// --- fake D1 -----------------------------------------------------------------

interface DeleteCall {
  sql: string
  userId: string
  cutoff: number
}

function makeFakeD1(opts: {
  userIds: string[]
  deletedByUser?: Record<string, number>
}) {
  const deleteCalls: DeleteCall[] = []
  const db = {
    prepare(sql: string) {
      return {
        all: async () => ({
          results: opts.userIds.map((user_id) => ({ user_id })),
        }),
        bind: (...args: unknown[]) => ({
          run: async () => {
            const [userId, cutoff] = args as [string, number]
            deleteCalls.push({ sql, userId, cutoff })
            return { meta: { changes: opts.deletedByUser?.[userId] ?? 0 } }
          },
        }),
      }
    },
  }
  return { db, deleteCalls }
}

// --- @chm/platform: mutable per-test D1 binding via a stable wrapper --------

let getD1Database = mock((_name: string): unknown => null)
mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: (name: string) => getD1Database(name),
  }),
}))

// --- @/lib/billing/retention-owner: mutable per-test plan resolver ---------

let resolveRetentionPlanForUser = mock(
  async (_userId: string): Promise<Plan> => getPlan('free')
)
mock.module('@/lib/billing/retention-owner', () => ({
  resolveRetentionPlanForUser: (userId: string) =>
    resolveRetentionPlanForUser(userId),
  mostGenerousRetentionPlan: (plans: Plan[]) => plans[0],
}))

const { __handlerForTests: handler } = await import('../retention-prune')

function req(opts: { auth?: string; secret?: string } = {}): Request {
  const url = new URL('http://x/api/cron/retention-prune')
  if (opts.secret) url.searchParams.set('secret', opts.secret)
  return new Request(url, {
    headers: opts.auth ? { authorization: opts.auth } : undefined,
  })
}

beforeEach(() => {
  process.env.CRON_SECRET = 'test-secret'
  getD1Database = mock(() => null)
  resolveRetentionPlanForUser = mock(async () => getPlan('free'))
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/retention-prune — auth gate', () => {
  test('1. CRON_SECRET unset → 503 fail-closed, D1 never touched', async () => {
    delete process.env.CRON_SECRET

    const res = await handler(req())

    expect(res.status).toBe(503)
    expect((await res.json()) as { error: string }).toEqual({
      error: 'CRON_SECRET not configured',
    })
    expect(getD1Database).not.toHaveBeenCalled()
  })

  test('2. wrong Authorization header → 401', async () => {
    const res = await handler(req({ auth: 'Bearer wrong' }))

    expect(res.status).toBe(401)
    expect((await res.json()) as { error: string }).toEqual({
      error: 'Unauthorized',
    })
  })

  test('2. wrong ?secret= query param → 401', async () => {
    const res = await handler(req({ secret: 'wrong' }))

    expect(res.status).toBe(401)
    expect((await res.json()) as { error: string }).toEqual({
      error: 'Unauthorized',
    })
  })
})

describe('GET /api/cron/retention-prune — D1 unbound no-op', () => {
  test('3. getD1Database throwing → 200 skipped, no DELETE (authorized via header)', async () => {
    getD1Database = mock(() => {
      throw new Error('not in a Cloudflare environment')
    })

    const res = await handler(req({ auth: 'Bearer test-secret' }))

    expect(res.status).toBe(200)
    expect((await res.json()) as { skipped: boolean; reason: string }).toEqual({
      skipped: true,
      reason: 'D1 not bound',
    })
  })

  test('3. getD1Database returning null → 200 skipped (authorized via ?secret=)', async () => {
    getD1Database = mock(() => null)

    const res = await handler(req({ secret: 'test-secret' }))

    expect(res.status).toBe(200)
    expect((await res.json()) as { skipped: boolean; reason: string }).toEqual({
      skipped: true,
      reason: 'D1 not bound',
    })
  })
})

describe('GET /api/cron/retention-prune — prune loop', () => {
  test('4. authorized: issues a per-user DELETE with the resolved cutoff bound', async () => {
    const { db, deleteCalls } = makeFakeD1({
      userIds: ['user_a', 'user_b'],
      deletedByUser: { user_a: 3, user_b: 2 },
    })
    getD1Database = mock(() => db)
    resolveRetentionPlanForUser = mock(async () => getPlan('free'))

    const before = Date.now()
    const res = await handler(req({ auth: 'Bearer test-secret' }))
    const after = Date.now()

    expect(res.status).toBe(200)
    expect(
      (await res.json()) as {
        usersProcessed: number
        usersSkipped: number
        totalDeleted: number
        errors: number
      }
    ).toEqual({
      usersProcessed: 2,
      usersSkipped: 0,
      totalDeleted: 5,
      errors: 0,
    })

    // Bounds computed from the REAL retentionCutoffMs so this never hardcodes
    // the free plan's retention-day math.
    const lowerBound = retentionCutoffMs(getPlan('free'), before)
    const upperBound = retentionCutoffMs(getPlan('free'), after)
    expect(deleteCalls).toHaveLength(2)
    for (const call of deleteCalls) {
      // Guards against a `<` → `>` inversion, which would prune recent data.
      expect(call.sql).toMatch(/updated_at < \?2/)
      expect(call.cutoff).toBeGreaterThanOrEqual(lowerBound as number)
      expect(call.cutoff).toBeLessThanOrEqual(upperBound as number)
    }
    expect(deleteCalls.map((c) => c.userId).sort()).toEqual([
      'user_a',
      'user_b',
    ])
  })

  test('5. enterprise plan (cutoff == null) is skipped, never deleted', async () => {
    const { db, deleteCalls } = makeFakeD1({ userIds: ['user_enterprise'] })
    getD1Database = mock(() => db)
    resolveRetentionPlanForUser = mock(async () => getPlan('enterprise'))

    const res = await handler(req({ auth: 'Bearer test-secret' }))

    expect(res.status).toBe(200)
    expect(
      (await res.json()) as {
        usersProcessed: number
        usersSkipped: number
        totalDeleted: number
        errors: number
      }
    ).toEqual({
      usersProcessed: 1,
      usersSkipped: 1,
      totalDeleted: 0,
      errors: 0,
    })
    expect(deleteCalls).toHaveLength(0)
  })

  test('6. plan-resolution error is counted, never deletes, and the loop continues', async () => {
    const { db, deleteCalls } = makeFakeD1({
      userIds: ['user_bad', 'user_good'],
      deletedByUser: { user_good: 1 },
    })
    getD1Database = mock(() => db)
    resolveRetentionPlanForUser = mock(async (userId: string) => {
      if (userId === 'user_bad') throw new Error('clerk enumeration failed')
      return getPlan('free')
    })

    const res = await handler(req({ auth: 'Bearer test-secret' }))

    expect(res.status).toBe(200)
    expect(
      (await res.json()) as {
        usersProcessed: number
        usersSkipped: number
        totalDeleted: number
        errors: number
      }
    ).toEqual({
      usersProcessed: 2,
      usersSkipped: 0,
      totalDeleted: 1,
      errors: 1,
    })
    expect(deleteCalls.map((c) => c.userId)).toEqual(['user_good'])
  })
})
