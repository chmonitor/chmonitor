import { afterAll, describe, expect, mock, test } from 'bun:test'

const realStore = { ...(await import('@/lib/insights/store/resolve-store')) }

let listed: unknown[] = []
let fail = false
const calls: Array<{ hostId: number; opts: unknown }> = []

mock.module('@/lib/insights/store/resolve-store', () => ({
  ...realStore,
  resolveInsightsStore: async () => {
    if (fail) throw new Error('no store')
    return {
      list: async (hostId: number, opts: unknown) => {
        calls.push({ hostId, opts })
        return listed
      },
    }
  },
}))

afterAll(() => {
  mock.module('@/lib/insights/store/resolve-store', () => ({ ...realStore }))
})

const { createOptimizationPlanTools } = await import(
  '../optimization-plan-tools'
)
const tool = (hostId = 0) =>
  (createOptimizationPlanTools(hostId) as any).build_optimization_plan

const finding = {
  event_time: '2026-10-23 10:00:00',
  host_id: '2',
  severity: 'info',
  category: 'storage',
  source: 'ai-insight',
  title: 't',
  detail: 'd',
  metric: 'usage:unused_projection:logs.raw.p_x',
  value: 1024 ** 3,
}

describe('build_optimization_plan', () => {
  test('reads stored findings for the resolved host and returns a NOT APPLIED plan', async () => {
    listed = [finding]
    fail = false
    calls.length = 0
    const r = await tool(2).execute({})
    expect(calls[0]?.hostId).toBe(2)
    expect(r.notApplied).toBe(true)
    expect(r.banner).toContain('NOT APPLIED')
    expect(r.items[0].ddl[0]).toBe(
      'ALTER TABLE `logs`.`raw` DROP PROJECTION `p_x`'
    )
    expect(r.items[0].needsOwnerApproval).toBe(true)
  })

  test('an unavailable store skips every collector with the reason', async () => {
    fail = true
    const r = await tool().execute({})
    expect(r.items).toEqual([])
    expect(r.skipped.some((s: any) => s.reason.includes('no store'))).toBe(true)
  })

  test('offers no write or apply input', () => {
    const keys = Object.keys(tool().inputSchema.shape).sort()
    expect(keys).toEqual(['hostId', 'rewriteMBps'])
  })
})
