/**
 * Alert Rule Registry Tests
 *
 * For every built-in rule: asserts it fires (warning/critical) AND clears (ok).
 * Also tests registry CRUD and classifyValue boundaries.
 */

import type { RemediationAction } from '../rule-registry'

import { BUILTIN_RULES, registerBuiltinRules } from '../builtin-rules'
import {
  AlertRuleRegistry,
  assertReadOnlyAction,
  classifyValue,
  ruleRegistry,
} from '../rule-registry'
import { beforeEach, describe, expect, test } from 'bun:test'

// ---------------------------------------------------------------------------
// classifyValue (pure, no side effects)
// ---------------------------------------------------------------------------

describe('classifyValue', () => {
  const thresholds = { warning: 10, critical: 100 }

  test('null value → ok', () => {
    expect(classifyValue(null, thresholds)).toBe('ok')
  })

  test('NaN / Infinity → ok', () => {
    expect(classifyValue(Number.NaN, thresholds)).toBe('ok')
    expect(classifyValue(Number.POSITIVE_INFINITY, thresholds)).toBe('ok')
  })

  test('below warning → ok', () => {
    expect(classifyValue(0, thresholds)).toBe('ok')
    expect(classifyValue(9, thresholds)).toBe('ok')
  })

  test('at warning boundary → warning', () => {
    expect(classifyValue(10, thresholds)).toBe('warning')
  })

  test('between warning and critical → warning', () => {
    expect(classifyValue(50, thresholds)).toBe('warning')
    expect(classifyValue(99, thresholds)).toBe('warning')
  })

  test('at critical boundary → critical', () => {
    expect(classifyValue(100, thresholds)).toBe('critical')
  })

  test('above critical → critical', () => {
    expect(classifyValue(999, thresholds)).toBe('critical')
  })
})

// ---------------------------------------------------------------------------
// AlertRuleRegistry CRUD
// ---------------------------------------------------------------------------

describe('AlertRuleRegistry', () => {
  let registry: AlertRuleRegistry

  beforeEach(() => {
    registry = new AlertRuleRegistry()
  })

  test('starts empty', () => {
    expect(registry.size()).toBe(0)
    expect(registry.getAll()).toEqual([])
  })

  test('register and retrieve', () => {
    const rule = {
      id: 'test-rule',
      type: 'custom' as const,
      title: 'Test',
      description: 'desc',
      valueKey: 'val',
      defaults: { warning: 1, critical: 5 },
    }
    registry.register(rule)
    expect(registry.has('test-rule')).toBe(true)
    expect(registry.get('test-rule')).toEqual(rule)
    expect(registry.size()).toBe(1)
  })

  test('register overwrites same id', () => {
    const base = {
      id: 'r',
      type: 'custom' as const,
      title: 'A',
      description: '',
      valueKey: 'v',
      defaults: { warning: 1, critical: 5 },
    }
    registry.register(base)
    registry.register({ ...base, title: 'B' })
    expect(registry.get('r')?.title).toBe('B')
    expect(registry.size()).toBe(1)
  })

  test('unregister removes rule', () => {
    registry.register({
      id: 'x',
      type: 'custom' as const,
      title: 'X',
      description: '',
      valueKey: 'v',
      defaults: { warning: 1, critical: 5 },
    })
    registry.unregister('x')
    expect(registry.has('x')).toBe(false)
    expect(registry.size()).toBe(0)
  })

  test('getAll returns all registered rules', () => {
    for (const id of ['a', 'b', 'c']) {
      registry.register({
        id,
        type: 'custom' as const,
        title: id,
        description: '',
        valueKey: 'v',
        defaults: { warning: 1, critical: 5 },
      })
    }
    expect(
      registry
        .getAll()
        .map((r) => r.id)
        .sort()
    ).toEqual(['a', 'b', 'c'])
  })
})

// ---------------------------------------------------------------------------
// registerBuiltinRules populates the global registry
// ---------------------------------------------------------------------------

describe('registerBuiltinRules', () => {
  test('registers all BUILTIN_RULES into the singleton', () => {
    registerBuiltinRules()
    for (const rule of BUILTIN_RULES) {
      expect(ruleRegistry.has(rule.id)).toBe(true)
    }
  })

  test('all built-in rules have required fields', () => {
    for (const rule of BUILTIN_RULES) {
      expect(typeof rule.id).toBe('string')
      expect(rule.id.length).toBeGreaterThan(0)
      expect(typeof rule.title).toBe('string')
      expect(typeof rule.valueKey).toBe('string')
      expect(typeof rule.defaults.warning).toBe('number')
      expect(typeof rule.defaults.critical).toBe('number')
      expect(rule.defaults.warning).toBeLessThanOrEqual(rule.defaults.critical)
    }
  })
})

// ---------------------------------------------------------------------------
// Per-rule trigger / clear tests
// ---------------------------------------------------------------------------

describe('readonly-replicas rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'readonly-replicas')!

  test('fires warning at threshold', () => {
    expect(classifyValue(rule.defaults.warning, rule.defaults)).toBe('warning')
  })

  test('fires critical at threshold', () => {
    expect(classifyValue(rule.defaults.critical, rule.defaults)).toBe(
      'critical'
    )
  })

  test('clears when value is 0', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('clears on null', () => {
    expect(classifyValue(null, rule.defaults)).toBe('ok')
  })
})

describe('replication-lag rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'replication-lag')!

  test('clears below warning (29s)', () => {
    expect(classifyValue(29, rule.defaults)).toBe('ok')
  })

  test('fires warning at 30s', () => {
    expect(classifyValue(30, rule.defaults)).toBe('warning')
  })

  test('fires critical at 300s', () => {
    expect(classifyValue(300, rule.defaults)).toBe('critical')
  })

  test('fires critical above 300s', () => {
    expect(classifyValue(600, rule.defaults)).toBe('critical')
  })
})

describe('disk-usage rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'disk-usage')!

  test('ok at 79%', () => {
    expect(classifyValue(79, rule.defaults)).toBe('ok')
  })

  test('warning at 80%', () => {
    expect(classifyValue(80, rule.defaults)).toBe('warning')
  })

  test('critical at 95%', () => {
    expect(classifyValue(95, rule.defaults)).toBe('critical')
  })
})

describe('keeper-unavailable rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'keeper-unavailable')!

  test('ok at 0 exceptions', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('warning at 1 exception', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('critical at 20 exceptions', () => {
    expect(classifyValue(20, rule.defaults)).toBe('critical')
  })
})

describe('failed-mutations rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'failed-mutations')!

  test('ok when no failures', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('fires warning on first failure', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('fires critical at 5', () => {
    expect(classifyValue(5, rule.defaults)).toBe('critical')
  })

  test('clears on null (table absent)', () => {
    expect(classifyValue(null, rule.defaults)).toBe('ok')
  })
})

describe('stuck-merges rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'stuck-merges')!

  test('ok when no stuck merges', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('warning at 1 stuck merge', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('critical at 3 stuck merges', () => {
    expect(classifyValue(3, rule.defaults)).toBe('critical')
  })
})

describe('query-timeout rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'query-timeout')!

  test('ok at 0 timeouts', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('warning at 1 timeout', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('critical at 10 timeouts', () => {
    expect(classifyValue(10, rule.defaults)).toBe('critical')
  })
})

describe('failed-backups rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'failed-backups')!

  test('ok when no failures', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('warning at 1 failure', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('critical at 3 failures', () => {
    expect(classifyValue(3, rule.defaults)).toBe('critical')
  })
})

describe('mv-refresh-failures rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'mv-refresh-failures')!

  test('ok when no failures', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('warning at 1 failure', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('critical at 3 failures', () => {
    expect(classifyValue(3, rule.defaults)).toBe('critical')
  })

  test('clears on null (table absent)', () => {
    expect(classifyValue(null, rule.defaults)).toBe('ok')
  })
})

// ---------------------------------------------------------------------------
// assertReadOnlyAction — the invariant that remediation actions never
// auto-execute DDL or any destructive statement (plans/33-remediation-action-links.md)
// ---------------------------------------------------------------------------

describe('assertReadOnlyAction', () => {
  test('accepts a SELECT diagnostic', () => {
    expect(() =>
      assertReadOnlyAction({
        id: 'a',
        label: 'A',
        kind: 'diagnostic',
        sql: 'SELECT * FROM system.mutations',
      })
    ).not.toThrow()
  })

  test('accepts SHOW / EXPLAIN / DESCRIBE diagnostics', () => {
    for (const sql of [
      'SHOW TABLES',
      'EXPLAIN SELECT 1',
      'DESCRIBE system.mutations',
    ]) {
      expect(() =>
        assertReadOnlyAction({ id: 'a', label: 'A', kind: 'diagnostic', sql })
      ).not.toThrow()
    }
  })

  test('rejects DDL/mutation/SYSTEM statements', () => {
    const destructive = [
      'ALTER TABLE foo DELETE WHERE 1',
      'DROP TABLE foo',
      'DELETE FROM foo',
      'INSERT INTO foo VALUES (1)',
      'UPDATE foo SET x = 1',
      'TRUNCATE TABLE foo',
      'OPTIMIZE TABLE foo',
      'ATTACH TABLE foo',
      'DETACH TABLE foo',
      'CREATE TABLE foo (x Int32) ENGINE = Memory',
      'RENAME TABLE foo TO bar',
      'GRANT SELECT ON foo TO bar',
      'REVOKE SELECT ON foo FROM bar',
      'SYSTEM RELOAD DICTIONARY foo',
    ]
    for (const sql of destructive) {
      expect(() =>
        assertReadOnlyAction({ id: 'a', label: 'A', kind: 'diagnostic', sql })
      ).toThrow()
    }
  })

  test('rejects a query that does not start with an allowed keyword', () => {
    expect(() =>
      assertReadOnlyAction({
        id: 'a',
        label: 'A',
        kind: 'diagnostic',
        sql: 'WITH x AS (SELECT 1) SELECT * FROM x',
      })
    ).toThrow()
  })

  test('rejects a diagnostic with missing sql', () => {
    expect(() =>
      assertReadOnlyAction({ id: 'a', label: 'A', kind: 'diagnostic' })
    ).toThrow()
  })

  test('runbook actions always pass (nothing to execute)', () => {
    expect(() =>
      assertReadOnlyAction({
        id: 'a',
        label: 'A',
        kind: 'runbook',
        url: 'https://example.com',
      })
    ).not.toThrow()
  })

  test('every built-in diagnostic remediation action is read-only', () => {
    const actions: RemediationAction[] = BUILTIN_RULES.flatMap(
      (r) => r.remediationActions ?? []
    )
    const diagnostics = actions.filter((a) => a.kind === 'diagnostic')
    expect(diagnostics.length).toBeGreaterThan(0)
    for (const action of diagnostics) {
      expect(() => assertReadOnlyAction(action)).not.toThrow()
    }
  })

  test('at least 4 built-in rules declare a remediation action', () => {
    const rulesWithActions = BUILTIN_RULES.filter(
      (r) => (r.remediationActions?.length ?? 0) > 0
    )
    expect(rulesWithActions.length).toBeGreaterThanOrEqual(4)
  })
})
