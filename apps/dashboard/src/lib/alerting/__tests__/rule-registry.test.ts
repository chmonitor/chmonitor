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

  // A lone reconnect/re-election exception is routine and must not page.
  test('ok at 4 exceptions (below the sustained-exception threshold)', () => {
    expect(classifyValue(1, rule.defaults)).toBe('ok')
    expect(classifyValue(4, rule.defaults)).toBe('ok')
  })

  test('warning at 5 exceptions', () => {
    expect(classifyValue(5, rule.defaults)).toBe('warning')
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

  // latest_fail_time is a non-Nullable DateTime (1970-01-01 when there is no
  // failure), so isNotNull(latest_fail_time) counted every running mutation
  // as failed. A failure is a non-empty latest_fail_reason.
  test('counts a failure by latest_fail_reason, not latest_fail_time', () => {
    const diagnostic = rule.remediationActions?.find(
      (a) => a.id === 'failed-mutations-detail'
    )
    for (const sql of [rule.sql, diagnostic?.sql]) {
      expect(sql).toContain("is_done = 0 AND latest_fail_reason != ''")
      expect(sql).not.toContain('isNotNull(latest_fail_time)')
    }
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

describe('ttl-partition-health rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'ttl-partition-health')!

  test('ok when no tables are flagged', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
  })

  test('warning at 1 flagged table', () => {
    expect(classifyValue(1, rule.defaults)).toBe('warning')
  })

  test('critical at 5 flagged tables', () => {
    expect(classifyValue(5, rule.defaults)).toBe('critical')
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

// ---------------------------------------------------------------------------
// Replication, insert, memory and part-integrity rules
// ---------------------------------------------------------------------------

describe('new built-in rule ids', () => {
  const ids = BUILTIN_RULES.map((r) => r.id)

  test('are registered and unique', () => {
    for (const id of [
      'replication-queue-stuck',
      'replica-session-expired',
      'delayed-inserts',
      'rejected-inserts',
      'memory-pressure',
      'broken-detached-parts',
    ]) {
      expect(ids).toContain(id)
    }
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every diagnostic action is read-only', () => {
    for (const rule of BUILTIN_RULES) {
      for (const action of rule.remediationActions ?? []) {
        expect(() => assertReadOnlyAction(action)).not.toThrow()
      }
    }
  })
})

describe('replication-queue-stuck rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'replication-queue-stuck')!

  test('flags entries by retries or age', () => {
    expect(rule.sql).toContain('num_tries > 100')
    expect(rule.sql).toContain('create_time < now() - INTERVAL 1 HOUR')
    expect(rule.tableCheck).toBe('system.replication_queue')
    expect(rule.optional).toBe(true)
  })

  test('boundaries', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
    expect(classifyValue(1, rule.defaults)).toBe('warning')
    expect(classifyValue(9, rule.defaults)).toBe('warning')
    expect(classifyValue(10, rule.defaults)).toBe('critical')
  })
})

describe('replica-session-expired rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'replica-session-expired')!

  test('counts expired sessions from system.replicas', () => {
    expect(rule.sql).toContain('countIf(is_session_expired)')
    expect(rule.tableCheck).toBe('system.replicas')
  })

  test('boundaries', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
    expect(classifyValue(1, rule.defaults)).toBe('warning')
    expect(classifyValue(3, rule.defaults)).toBe('critical')
  })
})

describe('delayed-inserts rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'delayed-inserts')!

  test('reads the DelayedInserts gauge', () => {
    expect(rule.sql).toContain("metric = 'DelayedInserts'")
  })

  test('boundaries match the delayed-inserts health check', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
    expect(classifyValue(1, rule.defaults)).toBe('warning')
    expect(classifyValue(4, rule.defaults)).toBe('warning')
    expect(classifyValue(5, rule.defaults)).toBe('critical')
  })
})

describe('rejected-inserts rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'rejected-inserts')!

  // RejectedInserts in system.events is cumulative since server start; its
  // raw value would keep firing forever after one rejection.
  test('uses a 1h window, not the cumulative RejectedInserts counter', () => {
    expect(rule.sql).toContain('exception_code = 252')
    expect(rule.sql).toContain('INTERVAL 1 HOUR')
    expect(rule.sql).not.toContain('system.events')
  })

  test('any rejected insert is critical', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
    expect(classifyValue(1, rule.defaults)).toBe('critical')
  })
})

describe('memory-pressure rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'memory-pressure')!

  test('divides MemoryTracking by OSMemoryTotal', () => {
    expect(rule.sql).toContain("metric = 'MemoryTracking'")
    expect(rule.sql).toContain("metric = 'OSMemoryTotal'")
    expect(rule.sql).toContain('nullIf(')
  })

  test('boundaries', () => {
    expect(classifyValue(79.9, rule.defaults)).toBe('ok')
    expect(classifyValue(80, rule.defaults)).toBe('warning')
    expect(classifyValue(89.9, rule.defaults)).toBe('warning')
    expect(classifyValue(90, rule.defaults)).toBe('critical')
    expect(classifyValue(null, rule.defaults)).toBe('ok')
  })
})

describe('broken-detached-parts rule', () => {
  const rule = BUILTIN_RULES.find((r) => r.id === 'broken-detached-parts')!

  test('counts only broken detached parts', () => {
    expect(rule.sql).toContain("reason LIKE 'broken%'")
    expect(rule.tableCheck).toBe('system.detached_parts')
    const diagnostic = rule.remediationActions?.find(
      (a) => a.kind === 'diagnostic'
    )
    expect(diagnostic?.sql).toContain('database, table, name, reason')
  })

  test('critical at the first broken part', () => {
    expect(classifyValue(0, rule.defaults)).toBe('ok')
    expect(classifyValue(1, rule.defaults)).toBe('critical')
  })
})
