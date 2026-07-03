/**
 * Compound Alert Rule Tests
 *
 * Covers the pure primitives: `topoSortCompound` (valid order, missing
 * dependency, cycle rejection), `atLeast`, the registry CRUD, and the two
 * built-in compound rules (`replica-split-brain`, `merge-pressure`) including
 * throwing-evaluate isolation semantics that `server-sweep.ts` relies on.
 */

import { BUILTIN_COMPOUND_RULES } from '../builtin-rules'
import {
  atLeast,
  CompoundAlertRuleRegistry,
  type CompoundRuleDef,
  type CompoundRuleInput,
  compoundRuleRegistry,
  topoSortCompound,
} from '../compound-rules'
import { beforeEach, describe, expect, test } from 'bun:test'

function makeRule(overrides: Partial<CompoundRuleDef> = {}): CompoundRuleDef {
  return {
    id: 'test-compound',
    title: 'Test Compound',
    description: 'test',
    depends: ['base-a', 'base-b'],
    evaluate: () => 'ok',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// atLeast
// ---------------------------------------------------------------------------

describe('atLeast', () => {
  test('ok < warning < critical', () => {
    expect(atLeast('ok', 'warning')).toBe(false)
    expect(atLeast('warning', 'warning')).toBe(true)
    expect(atLeast('critical', 'warning')).toBe(true)
    expect(atLeast('warning', 'critical')).toBe(false)
    expect(atLeast('critical', 'critical')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// topoSortCompound
// ---------------------------------------------------------------------------

describe('topoSortCompound', () => {
  const baseIds = ['base-a', 'base-b', 'base-c']

  test('valid order: base-only dependencies pass through unordered-safe', () => {
    const r1 = makeRule({ id: 'c1', depends: ['base-a', 'base-b'] })
    const r2 = makeRule({ id: 'c2', depends: ['base-b', 'base-c'] })
    const ordered = topoSortCompound([r1, r2], baseIds)
    expect(ordered.map((r) => r.id)).toEqual(['c1', 'c2'])
  })

  test('compound-on-compound: dependent rule ordered after its compound dependency', () => {
    const r1 = makeRule({ id: 'c1', depends: ['base-a'] })
    const r2 = makeRule({ id: 'c2', depends: ['c1', 'base-b'] })
    // Registered in reverse order — topo sort must still put c1 before c2.
    const ordered = topoSortCompound([r2, r1], baseIds)
    expect(ordered.map((r) => r.id)).toEqual(['c1', 'c2'])
  })

  test('missing dependency throws', () => {
    const r1 = makeRule({ id: 'c1', depends: ['base-a', 'does-not-exist'] })
    expect(() => topoSortCompound([r1], baseIds)).toThrow(/does-not-exist/)
  })

  test('cycle is rejected', () => {
    const r1 = makeRule({ id: 'c1', depends: ['c2'] })
    const r2 = makeRule({ id: 'c2', depends: ['c1'] })
    expect(() => topoSortCompound([r1, r2], baseIds)).toThrow(/Cycle/)
  })

  test('empty input returns empty order', () => {
    expect(topoSortCompound([], baseIds)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CompoundAlertRuleRegistry (CRUD, mirrors AlertRuleRegistry)
// ---------------------------------------------------------------------------

describe('CompoundAlertRuleRegistry', () => {
  let registry: CompoundAlertRuleRegistry

  beforeEach(() => {
    registry = new CompoundAlertRuleRegistry()
  })

  test('register + get + has + size', () => {
    const rule = makeRule()
    expect(registry.size()).toBe(0)
    registry.register(rule)
    expect(registry.has('test-compound')).toBe(true)
    expect(registry.get('test-compound')).toBe(rule)
    expect(registry.size()).toBe(1)
  })

  test('unregister removes the rule', () => {
    registry.register(makeRule())
    registry.unregister('test-compound')
    expect(registry.has('test-compound')).toBe(false)
  })

  test('getAll returns all registered rules', () => {
    registry.register(makeRule({ id: 'c1' }))
    registry.register(makeRule({ id: 'c2' }))
    expect(
      registry
        .getAll()
        .map((r) => r.id)
        .sort()
    ).toEqual(['c1', 'c2'])
  })

  test('register with same id overwrites (idempotent)', () => {
    registry.register(makeRule({ id: 'c1', title: 'first' }))
    registry.register(makeRule({ id: 'c1', title: 'second' }))
    expect(registry.size()).toBe(1)
    expect(registry.get('c1')?.title).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// Global singleton is empty until builtin-rules registers into it
// ---------------------------------------------------------------------------

describe('compoundRuleRegistry singleton', () => {
  test('is the module-level export', () => {
    expect(compoundRuleRegistry).toBeInstanceOf(CompoundAlertRuleRegistry)
  })
})

// ---------------------------------------------------------------------------
// Built-in compound rules
// ---------------------------------------------------------------------------

describe('BUILTIN_COMPOUND_RULES', () => {
  test('every compound rule depends on >= 2 base rules', () => {
    for (const rule of BUILTIN_COMPOUND_RULES) {
      expect(rule.depends.length).toBeGreaterThanOrEqual(2)
    }
  })

  test('ids are unique', () => {
    const ids = BUILTIN_COMPOUND_RULES.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  describe('replica-split-brain', () => {
    const rule = BUILTIN_COMPOUND_RULES.find(
      (r) => r.id === 'replica-split-brain'
    )!

    test('ok when neither input fires', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 0, severity: 'ok' },
        'readonly-replicas': { value: 0, severity: 'ok' },
      }
      expect(rule.evaluate(inputs)).toBe('ok')
    })

    test('ok when only lag fires (readonly still 0)', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 60, severity: 'warning' },
        'readonly-replicas': { value: 0, severity: 'ok' },
      }
      expect(rule.evaluate(inputs)).toBe('ok')
    })

    test('ok when only readonly fires (lag still ok)', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 5, severity: 'ok' },
        'readonly-replicas': { value: 1, severity: 'warning' },
      }
      expect(rule.evaluate(inputs)).toBe('ok')
    })

    test('warning when both fire at warning', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 60, severity: 'warning' },
        'readonly-replicas': { value: 1, severity: 'warning' },
      }
      expect(rule.evaluate(inputs)).toBe('warning')
    })

    test('critical when either input is critical', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 400, severity: 'critical' },
        'readonly-replicas': { value: 1, severity: 'warning' },
      }
      expect(rule.evaluate(inputs)).toBe('critical')
    })

    test('ok when a dependency is missing from inputs', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 400, severity: 'critical' },
      }
      expect(rule.evaluate(inputs)).toBe('ok')
    })

    test('formatLabel renders both values', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'replication-lag': { value: 120, severity: 'warning' },
        'readonly-replicas': { value: 2, severity: 'warning' },
      }
      expect(rule.formatLabel?.(inputs)).toContain('120')
      expect(rule.formatLabel?.(inputs)).toContain('2')
    })
  })

  describe('merge-pressure', () => {
    const rule = BUILTIN_COMPOUND_RULES.find((r) => r.id === 'merge-pressure')!

    test('ok when neither input fires', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'stuck-merges': { value: 0, severity: 'ok' },
        'disk-usage': { value: 50, severity: 'ok' },
      }
      expect(rule.evaluate(inputs)).toBe('ok')
    })

    test('warning when both fire at warning', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'stuck-merges': { value: 1, severity: 'warning' },
        'disk-usage': { value: 85, severity: 'warning' },
      }
      expect(rule.evaluate(inputs)).toBe('warning')
    })

    test('critical when disk-usage is critical', () => {
      const inputs: Record<string, CompoundRuleInput> = {
        'stuck-merges': { value: 1, severity: 'warning' },
        'disk-usage': { value: 97, severity: 'critical' },
      }
      expect(rule.evaluate(inputs)).toBe('critical')
    })
  })

  describe('fail-open: a throwing evaluate() is caught by the caller, not the rule itself', () => {
    test('a misbehaving compound rule can be constructed and its throw observed', () => {
      const throwing = makeRule({
        id: 'throws',
        evaluate: () => {
          throw new Error('boom')
        },
      })
      expect(() => throwing.evaluate({})).toThrow('boom')
      // server-sweep.ts wraps each compound.evaluate() call in try/catch so
      // this throw never propagates out of the host loop — see
      // server-sweep.test.ts for the integration-level proof.
    })
  })
})
