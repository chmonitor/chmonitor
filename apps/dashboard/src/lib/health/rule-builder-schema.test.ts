import { ZodError } from 'zod'

import {
  assertReadOnlySql,
  classifyCustomValue,
  compileCustomRule,
  customRuleInputSchema,
  METRIC_CATALOG,
} from './rule-builder-schema'
import { describe, expect, it } from 'bun:test'

describe('customRuleInputSchema', () => {
  it('accepts a valid catalog metric with numeric thresholds', () => {
    const parsed = customRuleInputSchema.parse({
      name: 'Too many stuck merges',
      metric: 'stuck-merges',
      op: '>=',
      warning: 1,
      critical: 3,
    })
    expect(parsed.metric).toBe('stuck-merges')
  })

  it('rejects an off-catalog metric', () => {
    expect(() =>
      customRuleInputSchema.parse({
        name: 'Nope',
        metric: 'not-a-real-metric',
        op: '>',
        warning: 1,
        critical: 2,
      })
    ).toThrow(ZodError)
  })

  it('rejects a non-numeric threshold', () => {
    expect(() =>
      customRuleInputSchema.parse({
        name: 'Nope',
        metric: 'active-mutations',
        op: '>',
        warning: 'a lot',
        critical: 2,
      })
    ).toThrow(ZodError)
  })

  it('rejects a non-finite threshold (Infinity/NaN)', () => {
    expect(() =>
      customRuleInputSchema.parse({
        name: 'Nope',
        metric: 'active-mutations',
        op: '>',
        warning: Number.POSITIVE_INFINITY,
        critical: 2,
      })
    ).toThrow(ZodError)
  })

  it('rejects an empty name', () => {
    expect(() =>
      customRuleInputSchema.parse({
        name: '',
        metric: 'active-mutations',
        op: '>',
        warning: 1,
        critical: 2,
      })
    ).toThrow(ZodError)
  })

  it('rejects a critical threshold less extreme than warning for a ">" op', () => {
    expect(() =>
      customRuleInputSchema.parse({
        name: 'Backwards',
        metric: 'active-mutations',
        op: '>',
        warning: 10,
        critical: 5,
      })
    ).toThrow(ZodError)
  })

  it('rejects a critical threshold less extreme than warning for a "<" op', () => {
    expect(() =>
      customRuleInputSchema.parse({
        name: 'Backwards',
        metric: 'active-mutations',
        op: '<',
        warning: 5,
        critical: 10,
      })
    ).toThrow(ZodError)
  })
})

describe('compileCustomRule', () => {
  it('produces SQL that is EXACTLY the catalog template (no interpolation)', () => {
    for (const [metric, entry] of Object.entries(METRIC_CATALOG)) {
      const compiled = compileCustomRule({
        name: `Test ${metric}`,
        metric: metric as keyof typeof METRIC_CATALOG,
        op: '>=',
        warning: 1,
        critical: 2,
      })
      expect(compiled.sql).toBe(entry.sql)
      expect(compiled.valueKey).toBe(entry.valueKey)
    }
  })

  it('sets a stable custom: id and type', () => {
    const compiled = compileCustomRule({
      name: 'Readonly replicas alert',
      metric: 'readonly-replicas',
      op: '>=',
      warning: 1,
      critical: 3,
    })
    expect(compiled.id.startsWith('custom:')).toBe(true)
    expect(compiled.type).toBe('custom')
    expect(compiled.defaults).toEqual({ warning: 1, critical: 3 })
  })

  it('throws (never crashes with a raw error) on invalid input', () => {
    expect(() =>
      compileCustomRule({
        // @ts-expect-error deliberately off-catalog
        metric: 'drop table system.mutations',
        name: 'Malicious',
        op: '>',
        warning: 1,
        critical: 2,
      })
    ).toThrow()
  })

  it('generated SQL passes the read-only deny-list', () => {
    for (const metric of Object.keys(METRIC_CATALOG)) {
      const compiled = compileCustomRule({
        name: `Test ${metric}`,
        metric: metric as keyof typeof METRIC_CATALOG,
        op: '>',
        warning: 1,
        critical: 2,
      })
      expect(() => assertReadOnlySql(compiled.sql as string)).not.toThrow()
    }
  })
})

describe('assertReadOnlySql (deny-list, defense-in-depth)', () => {
  it('accepts a plain read-only SELECT', () => {
    expect(() =>
      assertReadOnlySql('SELECT count() AS v FROM system.mutations')
    ).not.toThrow()
  })

  it('rejects multi-statement SQL', () => {
    expect(() =>
      assertReadOnlySql('SELECT 1; DROP TABLE system.mutations')
    ).toThrow()
  })

  it('rejects non-SELECT statements', () => {
    expect(() =>
      assertReadOnlySql('DELETE FROM system.mutations WHERE 1=1')
    ).toThrow()
  })

  it('rejects a SELECT that smuggles a forbidden keyword', () => {
    expect(() =>
      assertReadOnlySql(
        'SELECT count() AS v FROM system.mutations; ALTER TABLE x DROP COLUMN y'
      )
    ).toThrow()
  })
})

describe('classifyCustomValue', () => {
  const thresholds = { warning: 10, critical: 20 }

  it('">=" op: higher is worse', () => {
    expect(classifyCustomValue(5, '>=', thresholds)).toBe('ok')
    expect(classifyCustomValue(10, '>=', thresholds)).toBe('warning')
    expect(classifyCustomValue(20, '>=', thresholds)).toBe('critical')
  })

  it('"<=" op: lower is worse', () => {
    const lowerThresholds = { warning: 0.9, critical: 0.7 }
    expect(classifyCustomValue(0.95, '<=', lowerThresholds)).toBe('ok')
    expect(classifyCustomValue(0.9, '<=', lowerThresholds)).toBe('warning')
    expect(classifyCustomValue(0.5, '<=', lowerThresholds)).toBe('critical')
  })

  it('null/non-finite values classify as ok (never crash)', () => {
    expect(classifyCustomValue(null, '>=', thresholds)).toBe('ok')
    expect(classifyCustomValue(Number.NaN, '>=', thresholds)).toBe('ok')
  })
})
