import type { DispatchFindingParams } from './dispatch'

import { BUILTIN_RULES } from '../../alerting/builtin-rules'
import { ruleRegistry } from '../../alerting/rule-registry'
import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test'

const config = {
  id: 0,
  host: 'https://example.org/',
  user: 'default',
  password: '',
}
const realClient = { ...(await import('@chm/clickhouse-client')) }
const realInsights = { ...(await import('@/lib/insights/generate-insights')) }
const realStore = { ...(await import('../merge-progress-store')) }
let failMergeRead = false
let truncatedMergeRead = false
mock.module('@chm/clickhouse-client', () => ({
  ...realClient,
  getClickHouseConfigs: () => [config],
  fetchData: async ({ query }: { query: string }) => {
    if (query.includes("'table' AS kind"))
      return { data: [{ kind: 'table', name: 'system.merges' }] }
    if (query.includes('AS rule_id'))
      return { data: [{ rule_id: 'stuck-merges', value: '50' }] }
    if (query.includes('rows_read'))
      return {
        data: [],
        metadata: {
          rows_before_limit_at_least: truncatedMergeRead ? 1 : undefined,
        },
        error: failMergeRead ? { message: 'unavailable' } : undefined,
      }
    return { data: [{ stuck_count: 50 }] }
  },
}))
mock.module('@/lib/insights/generate-insights', () => ({
  ...realInsights,
  generateInsights: async () => [],
}))
const modes: string[] = []
mock.module('../merge-progress-store', () => ({
  ...realStore,
  healthDbMergeProgressStore: {
    load: async (_host: string, mode: string) => {
      modes.push(mode)
      return { version: 1, updatedAtMs: Date.now() - 600_000, samples: [] }
    },
    save: async () => true,
  },
}))
const { runHostSweep } = await import('./run-host')
const { getCurrentFindings } = await import('../current-findings')
const { resetHostCapabilities } = await import('../capability-cache')
const duration = BUILTIN_RULES.find((r) => r.id === 'stuck-merges')!
const stalled = BUILTIN_RULES.find((r) => r.id === 'stalled-merges')!
const registrySpy = spyOn(ruleRegistry, 'getAll').mockImplementation(() => [
  duration,
  stalled,
])
afterAll(() => {
  registrySpy.mockRestore()
  mock.module('@chm/clickhouse-client', () => ({ ...realClient }))
  mock.module('@/lib/insights/generate-insights', () => ({ ...realInsights }))
  mock.module('../merge-progress-store', () => ({ ...realStore }))
})
beforeEach(() => {
  failMergeRead = false
  truncatedMergeRead = false
  modes.length = 0
  resetHostCapabilities()
})
const ctx = {
  alertingEnabled: true,
  rules: [duration, stalled],
  thresholdOverrides: {},
  orderedCompoundRules: [],
  notifyRules: [],
} as unknown as Parameters<typeof runHostSweep>[1]

test('Active Alerts and sweep honor the same warning-only classifier; findings only read samples', async () => {
  const dispatched: DispatchFindingParams[] = []
  const sweep = await runHostSweep(config, ctx, async (p) => {
    dispatched.push(p)
  })
  expect(sweep.findings.map((f) => [f.checkId, f.severity])).toEqual([
    ['stuck-merges', 'warning'],
  ])
  expect(dispatched.find((d) => d.ruleId === 'stuck-merges')?.signalOnly).toBe(
    true
  )
  expect(modes).toEqual(['observe'])
  const findings = await getCurrentFindings()
  expect(findings.map((f) => [f.ruleId, f.severity])).toEqual([
    ['stuck-merges', 'warning'],
  ])
  expect(modes).toEqual(['observe', 'read'])
})
test('a failed stateful query dispatches neither firing nor recovery', async () => {
  failMergeRead = true
  const dispatched: DispatchFindingParams[] = []
  await runHostSweep(config, ctx, async (p) => {
    dispatched.push(p)
  })
  expect(dispatched.filter((d) => d.ruleId === 'stalled-merges')).toEqual([])
  expect(dispatched.find((d) => d.ruleId === 'stuck-merges')?.severity).toBe(
    'warning'
  )
})
test('a truncated stateful result dispatches no recovery', async () => {
  truncatedMergeRead = true
  const dispatched: DispatchFindingParams[] = []
  await runHostSweep(config, ctx, async (p) => {
    dispatched.push(p)
  })
  expect(dispatched.filter((d) => d.ruleId === 'stalled-merges')).toEqual([])
})
