/**
 * #4070: a rule shipped with `defaultEnabled: false` must not run anywhere
 * rules are evaluated unless `HEALTH_ALERT_ENABLE_RULES` opts it in. These
 * tests assert on the statements that reach ClickHouse, not on a mock return,
 * so a path that forgets the gate fails them.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

const queries: string[] = []
/** Value the fake server reports for the detached-parts-review rule. */
let reviewRatio = '2'

mock.module('@chm/clickhouse-client', () => ({
  fetchData: async ({ query }: { query: string }) => {
    queries.push(query)
    if (query.includes("'table' AS kind")) {
      return {
        data: [
          { kind: 'table', name: 'system.detached_parts' },
          { kind: 'table', name: 'system.disks' },
          { kind: 'table', name: 'system.replicas' },
        ],
        metadata: {},
        error: undefined,
      }
    }
    if (query.includes('AS rule_id')) {
      return {
        data: [{ rule_id: 'detached-parts-review', value: reviewRatio }],
        metadata: {},
        error: undefined,
      }
    }
    return {
      data: [{ review_ratio: reviewRatio }],
      metadata: {},
      error: undefined,
    }
  },
  getClickHouseConfigs: () => [
    { id: 0, host: 'test-host', user: 'default', password: '' },
  ],
}))
mock.module('@/lib/insights/generate-insights', () => ({
  generateInsights: async () => [],
}))
mock.module('@/lib/insights/generate-postgres-insights', () => ({
  generatePostgresInsights: async () => [],
}))
mock.module('@/lib/insights/generate-peerdb-insights', () => ({
  generatePeerDBInsights: async () => [],
}))

const { BUILTIN_RULES } = await import('@/lib/alerting/builtin-rules')
const { resetHostCapabilities } = await import('../capability-cache')
const { getCurrentFindings } = await import('../current-findings')
const { runHostSweep } = await import('./run-host')
const { isRuleEnabled, isSignalOnly } = await import('./suppression')

const config = { id: 0, host: 'test-host', user: 'default', password: '' }
const reviewRule = BUILTIN_RULES.find((r) => r.id === 'detached-parts-review')!
const SWEEP_MARK = "'detached-parts-review' AS rule_id"
const SNAPSHOT_MARK = 'review_ratio'

function sweepCtx(enabledRules?: string[]) {
  return {
    alertingEnabled: false,
    rules: [reviewRule],
    thresholdOverrides: {},
    orderedCompoundRules: [],
    enabledRules,
  } as unknown as Parameters<typeof runHostSweep>[1]
}

const noopDispatch = async () => {}

let savedEnv: string | undefined
beforeEach(() => {
  queries.length = 0
  reviewRatio = '2'
  resetHostCapabilities()
  savedEnv = process.env.HEALTH_ALERT_ENABLE_RULES
  delete process.env.HEALTH_ALERT_ENABLE_RULES
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.HEALTH_ALERT_ENABLE_RULES
  else process.env.HEALTH_ALERT_ENABLE_RULES = savedEnv
})

describe('isRuleEnabled', () => {
  test('a rule with no defaultEnabled field is enabled with an empty list', () => {
    expect(isRuleEnabled({ id: 'anything' })).toBe(true)
    expect(isRuleEnabled({ id: 'anything' }, [])).toBe(true)
  })

  test('every rule that existed before the field resolves as enabled', () => {
    const optedOut = BUILTIN_RULES.filter((r) => !isRuleEnabled(r, []))
    expect(optedOut.map((r) => r.id)).toEqual(['detached-parts-review'])
    for (const rule of BUILTIN_RULES) {
      if (rule.id === 'detached-parts-review') continue
      expect(rule.defaultEnabled).toBeUndefined()
      expect(isRuleEnabled(rule, [])).toBe(true)
    }
  })

  test('defaultEnabled: false is off with no opt-in', () => {
    expect(isRuleEnabled({ id: 'x', defaultEnabled: false })).toBe(false)
    expect(isRuleEnabled({ id: 'x', defaultEnabled: false }, [])).toBe(false)
  })

  test('opt-in by exact id, case-insensitive', () => {
    expect(isRuleEnabled({ id: 'x', defaultEnabled: false }, ['x'])).toBe(true)
    expect(isRuleEnabled({ id: 'x', defaultEnabled: false }, ['X'])).toBe(true)
    expect(isRuleEnabled({ id: 'x', defaultEnabled: false }, ['y'])).toBe(false)
  })

  test('opt-in by glob', () => {
    const rule = { id: 'detached-parts-review', defaultEnabled: false }
    expect(isRuleEnabled(rule, ['detached-*'])).toBe(true)
    expect(isRuleEnabled(rule, ['*-review'])).toBe(true)
    expect(isRuleEnabled(rule, ['detached-parts-revie?'])).toBe(true)
    expect(isRuleEnabled(rule, ['broken-*'])).toBe(false)
  })

  test('an opt-in list never disables an on-by-default rule', () => {
    expect(isRuleEnabled({ id: 'disk-usage' }, ['detached-parts-review'])).toBe(
      true
    )
  })
})

describe('runHostSweep', () => {
  test('does not query a default-off rule when nothing opts it in', async () => {
    for (const enabledRules of [undefined, [], ['broken-detached-parts']]) {
      queries.length = 0
      resetHostCapabilities()
      const { findings, summary } = await runHostSweep(
        config,
        sweepCtx(enabledRules),
        noopDispatch
      )
      expect(queries.some((q) => q.includes(SWEEP_MARK))).toBe(false)
      expect(queries.some((q) => q.includes(SNAPSHOT_MARK))).toBe(false)
      expect(findings).toEqual([])
      expect(summary.checksRun).toBe(0)
    }
  })

  test('queries it and reports a warning when opted in by id', async () => {
    const { findings, summary } = await runHostSweep(
      config,
      sweepCtx(['detached-parts-review']),
      noopDispatch
    )
    expect(queries.some((q) => q.includes(SWEEP_MARK))).toBe(true)
    expect(summary.checksRun).toBe(1)
    expect(findings).toHaveLength(1)
    expect(findings[0]?.checkId).toBe('detached-parts-review')
    expect(findings[0]?.severity).toBe('warning')
  })

  test('queries it when opted in by glob', async () => {
    await runHostSweep(config, sweepCtx(['detached-*']), noopDispatch)
    expect(queries.some((q) => q.includes(SWEEP_MARK))).toBe(true)
  })
})

describe('getCurrentFindings', () => {
  test('does not run a default-off rule by default', async () => {
    const findings = await getCurrentFindings()
    expect(queries.some((q) => q.includes(SNAPSHOT_MARK))).toBe(false)
    expect(findings.some((f) => f.ruleId === 'detached-parts-review')).toBe(
      false
    )
  })

  test('runs it when HEALTH_ALERT_ENABLE_RULES names it', async () => {
    process.env.HEALTH_ALERT_ENABLE_RULES = 'detached-parts-review'
    const findings = await getCurrentFindings()
    expect(queries.some((q) => q.includes(SNAPSHOT_MARK))).toBe(true)
    const found = findings.find((f) => f.ruleId === 'detached-parts-review')
    expect(found?.severity).toBe('warning')
  })
})

describe('isSignalOnly', () => {
  test('a rule without signalOnly is never signal-only', () => {
    expect(isSignalOnly({ id: 'x' }, [])).toBe(false)
  })

  test('a signalOnly rule stays signal-only unless HEALTH_ALERT_NOTIFY_RULES names it', () => {
    const rule = { id: 'long-running-queries', signalOnly: true }
    expect(isSignalOnly(rule)).toBe(true)
    expect(isSignalOnly(rule, ['heavy-query-memory'])).toBe(true)
    expect(isSignalOnly(rule, ['long-running-queries'])).toBe(false)
    expect(isSignalOnly(rule, ['*-QUERIES'])).toBe(false)
  })

  test('the built-in query signals ship signal-only', () => {
    for (const id of ['long-running-queries', 'heavy-query-memory']) {
      const rule = BUILTIN_RULES.find((r) => r.id === id)
      expect(rule && isSignalOnly(rule)).toBe(true)
    }
  })
})

describe('getServerNotifyRules', () => {
  test('parses HEALTH_ALERT_NOTIFY_RULES like the other rule lists', async () => {
    const { getServerNotifyRules } = await import('../server-alert-config')
    const saved = process.env.HEALTH_ALERT_NOTIFY_RULES
    try {
      delete process.env.HEALTH_ALERT_NOTIFY_RULES
      expect(getServerNotifyRules()).toEqual([])
      process.env.HEALTH_ALERT_NOTIFY_RULES = ' long-running-queries, ,heavy-* '
      expect(getServerNotifyRules()).toEqual([
        'long-running-queries',
        'heavy-*',
      ])
    } finally {
      if (saved === undefined) delete process.env.HEALTH_ALERT_NOTIFY_RULES
      else process.env.HEALTH_ALERT_NOTIFY_RULES = saved
    }
  })
})
