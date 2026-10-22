/**
 * #4070: `detached-parts-review` is a diagnostic prompt to review detached
 * parts. It is off by default, warns at 1% of total disk or 30 days, and
 * never says a part is safe or tells the operator to drop it.
 */

import { BUILTIN_RULES } from '../builtin-rules'
import { assertReadOnlyAction, classifyValue } from '../rule-registry'
import { describe, expect, test } from 'bun:test'

const rule = BUILTIN_RULES.find((r) => r.id === 'detached-parts-review')!

describe('detached-parts-review rule', () => {
  test('ships off by default and sits next to broken-detached-parts', () => {
    expect(rule.defaultEnabled).toBe(false)
    const ids = BUILTIN_RULES.map((r) => r.id)
    expect(ids.indexOf('detached-parts-review')).toBe(
      ids.indexOf('broken-detached-parts') + 1
    )
  })

  test('the neighbouring broken-detached-parts rule is untouched', () => {
    const broken = BUILTIN_RULES.find((r) => r.id === 'broken-detached-parts')!
    expect(broken.defaultEnabled).toBeUndefined()
    expect(broken.defaults).toEqual({ warning: 1, critical: 1 })
  })

  test('fails open when system.detached_parts is unreadable', () => {
    expect(rule.optional).toBe(true)
    expect(rule.tableCheck).toBe('system.detached_parts')
  })

  test('the value is a ratio against 1% of disk and 30 days', () => {
    // 1.0 must be exactly 1% of total disk space and exactly 30 days.
    expect(rule.sql).toContain('sum(bytes_on_disk) * 100.0')
    expect(rule.sql).toContain('sum(total_space) FROM system.disks')
    expect(rule.sql).toContain('/ 86400.0 / 30')
    expect(rule.sql).toContain('min(modification_time)')
    // min() over no rows is the epoch, so an empty table must short-circuit.
    expect(rule.sql).toContain('if(count() = 0, 0,')
    // No lambda aliases in a WITH clause (analyzer 0/1 differ on them).
    expect(rule.sql).not.toMatch(/\bWITH\b/i)
  })

  test('warns at the 1% / 30 day boundary and never goes critical', () => {
    const t = rule.defaults
    expect(classifyValue(0, t)).toBe('ok')
    expect(classifyValue(0.999, t)).toBe('ok')
    expect(classifyValue(1, t)).toBe('warning')
    expect(classifyValue(2.5, t)).toBe('warning')
    // 100 years of age is a ratio of ~1217; still a warning.
    expect(classifyValue(1217, t)).toBe('warning')
    expect(classifyValue(null, t)).toBe('ok')
  })

  test('the label names both limits', () => {
    expect(rule.formatLabel?.(2.5)).toBe(
      'detached parts at 2.50x the review limit (1% of disk or 30 days)'
    )
  })

  test('wording asks for review: no "safe", no DROP DETACHED', () => {
    const actions = rule.remediationActions ?? []
    const text = [
      rule.title,
      rule.description,
      rule.formatLabel?.(1) ?? '',
      ...actions.flatMap((a) => [a.label, a.description ?? '', a.sql ?? '']),
    ].join('\n')
    expect(text).not.toMatch(/\bsafe/i)
    expect(text).not.toMatch(/drop\s+detached/i)
    expect(text).not.toMatch(/\bdrop\b/i)
    expect(text).toMatch(/review/i)
    expect(text).toMatch(/per replica/i)
    expect(rule.description).toContain('/detached-parts-triage')
    expect(rule.description).toContain('HEALTH_ALERT_ENABLE_RULES')
  })

  test('every remediation action is a read-only diagnostic', () => {
    expect(rule.remediationActions?.length).toBeGreaterThan(0)
    for (const action of rule.remediationActions ?? []) {
      expect(action.kind).toBe('diagnostic')
      expect(() => assertReadOnlyAction(action)).not.toThrow()
    }
  })
})
