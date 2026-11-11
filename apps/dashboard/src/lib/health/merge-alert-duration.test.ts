import { BUILTIN_RULES } from '../alerting/builtin-rules'
import { classifyValue } from '../alerting/rule-registry'
import { computeCheckStatus } from './health-status'
import { expect, test } from 'bun:test'
import { HEALTH_CHECKS } from '@/components/health/health-checks'

test('merge age alone stays warning in the rule and duration chart', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'stuck-merges')!
  expect(
    rule.classify
      ? rule.classify(50, rule.defaults)
      : classifyValue(50, rule.defaults)
  ).toBe('warning')
  expect(rule.signalOnly).toBe(true)
  const check = HEALTH_CHECKS.find((c) => c.id === 'stuck-merges')!
  expect(
    computeCheckStatus(
      check,
      { warning: 1, critical: 3 },
      { data: [{ stuck_count: 50 }] },
      false
    ).status
  ).toBe('warning')
})
