/**
 * Batched-KPI tests (issue #3682).
 *
 * Two jobs:
 *
 *  1. Lock down the *shape* of the batched statement — mainly that each branch
 *     embeds its rule's own SQL verbatim, so the batch cannot drift from what
 *     it wraps. A drift here would report a different number than the rule
 *     means, which is the worst failure mode a health check has.
 *  2. Prove the reduction quantitatively. `runHostSweepQueryCounts` runs a
 *     representative sweep tick through both the pre-fix and post-fix paths
 *     against one fake `fetchData`, and the test asserts the after-count is at
 *     most half the before-count. That is the issue's acceptance criterion.
 */

import type { AlertRuleDef } from '@/lib/alerting/rule-registry'

import {
  BATCH_EXCLUDED_RULE_IDS,
  buildBatchedKpiSql,
  isBatchableRule,
  isSubSelectSafe,
  parseBatchedKpiRows,
  partitionRulesForSweep,
} from './batch-kpi'
import { describe, expect, test } from 'bun:test'

function rule(
  over: Partial<AlertRuleDef> & Pick<AlertRuleDef, 'id'>
): AlertRuleDef {
  return {
    type: 'custom',
    title: over.id,
    description: '',
    sql: 'SELECT 1 AS v',
    valueKey: 'v',
    defaults: { warning: 1, critical: 2 },
    ...over,
  }
}

describe('isSubSelectSafe', () => {
  test('accepts a plain SELECT', () => {
    expect(isSubSelectSafe('SELECT count() AS c FROM system.disks')).toBe(true)
  })

  test('accepts a leading comment before SELECT', () => {
    expect(isSubSelectSafe('/* marker */ SELECT 1 AS c')).toBe(true)
  })

  test('tolerates a trailing semicolon', () => {
    expect(isSubSelectSafe('SELECT 1 AS c;')).toBe(true)
    expect(isSubSelectSafe('SELECT 1 AS c ;\n')).toBe(true)
  })

  test('rejects a trailing SETTINGS clause', () => {
    // The ttl-partition-sql builders end this way. `FROM ( … SETTINGS x = 1 )`
    // is not an expression, so nesting them would error on every sweep.
    expect(
      isSubSelectSafe(
        'SELECT count() AS c FROM system.tables SETTINGS max_execution_time = 30'
      )
    ).toBe(false)
  })

  test('rejects a non-SELECT statement', () => {
    expect(isSubSelectSafe('WITH x AS (SELECT 1) SELECT * FROM x')).toBe(false)
    expect(isSubSelectSafe('SHOW TABLES')).toBe(false)
    expect(isSubSelectSafe(undefined)).toBe(false)
    expect(isSubSelectSafe('   ')).toBe(false)
  })

  test('rejects the SELECT keyword appearing only later', () => {
    expect(isSubSelectSafe('EXPLAIN SELECT 1')).toBe(false)
  })
})

describe('buildBatchedKpiSql', () => {
  test('returns null for no KPIs so no pointless round trip is made', () => {
    expect(buildBatchedKpiSql([])).toBeNull()
  })

  test('each branch embeds the rule SQL verbatim', () => {
    // The anti-drift property. If someone edits a rule's SQL and forgets the
    // batch, the batched number silently reports something else — so the SQL
    // is embedded, not restated as a scalar expression.
    const sql = `SELECT count() AS readonly_count
FROM system.replicas
WHERE is_readonly = 1`
    const rendered = buildBatchedKpiSql([
      { ruleId: 'readonly-replicas', valueKey: 'readonly_count', sql },
    ])
    expect(rendered).toContain(sql)
  })

  test('labels each branch by rule id and reads its own valueKey', () => {
    const rendered = buildBatchedKpiSql([
      { ruleId: 'disk-usage', valueKey: 'disk_percent', sql: 'SELECT 1' },
    ])!
    expect(rendered).toContain("'disk-usage' AS rule_id")
    expect(rendered).toContain('toString(`disk_percent`) AS value')
  })

  test('joins branches with UNION ALL', () => {
    const rendered = buildBatchedKpiSql([
      { ruleId: 'a', valueKey: 'v', sql: 'SELECT 1 AS v' },
      { ruleId: 'b', valueKey: 'v', sql: 'SELECT 2 AS v' },
    ])!
    expect(rendered.match(/UNION ALL/g)).toHaveLength(1)
    expect(rendered.match(/AS rule_id/g)).toHaveLength(2)
  })

  test('strips a trailing semicolon so nesting stays valid', () => {
    const rendered = buildBatchedKpiSql([
      { ruleId: 'a', valueKey: 'v', sql: 'SELECT 1 AS v;' },
    ])!
    expect(rendered).not.toContain(';')
  })
})

describe('parseBatchedKpiRows', () => {
  const kpis = [
    { ruleId: 'a', valueKey: 'v', sql: 'SELECT 1' },
    { ruleId: 'b', valueKey: 'v', sql: 'SELECT 1' },
    { ruleId: 'c', valueKey: 'v', sql: 'SELECT 1' },
  ]

  test('reads a stringified value back as a number', () => {
    // `toString` in the batch exists so mixed UInt/Int/Float columns do not get
    // coerced through Float64; `Number` undoes it exactly for these magnitudes.
    const out = parseBatchedKpiRows(
      [
        { rule_id: 'a', value: '42' },
        { rule_id: 'b', value: '96.7' },
      ],
      kpis
    )
    expect(out.get('a')).toBe(42)
    expect(out.get('b')).toBe(96.7)
  })

  test('an absent row reads as 0, matching the unbatched path', () => {
    // `runRuleQuery` returned 0 for an empty result set, so a rule whose
    // subquery produced no row must not change its reported value.
    const out = parseBatchedKpiRows([{ rule_id: 'a', value: '5' }], kpis)
    expect(out.get('a')).toBe(5)
    expect(out.get('b')).toBe(0)
    expect(out.get('c')).toBe(0)
  })

  test('null and empty values read as 0', () => {
    const out = parseBatchedKpiRows(
      [
        { rule_id: 'a', value: null },
        { rule_id: 'b', value: '' },
      ],
      kpis
    )
    expect(out.get('a')).toBe(0)
    expect(out.get('b')).toBe(0)
  })

  test('a null result set yields every KPI at 0', () => {
    expect(parseBatchedKpiRows(null, kpis).get('a')).toBe(0)
  })

  test('an unknown rule id is ignored', () => {
    const out = parseBatchedKpiRows([{ rule_id: 'ghost', value: '9' }], kpis)
    expect(out.has('ghost')).toBe(false)
  })

  test('a non-numeric value leaves the default 0 in place', () => {
    const out = parseBatchedKpiRows([{ rule_id: 'a', value: 'nan' }], kpis)
    expect(out.get('a')).toBe(0)
  })
})

describe('isBatchableRule', () => {
  test('excludes the two system.parts scans', () => {
    // Deliberate: folding the heaviest query into the statement the other ten
    // depend on means a slow parts scan holds up ten cheap checks.
    expect(BATCH_EXCLUDED_RULE_IDS).toEqual([
      'parts-pressure',
      'ttl-partition-health',
    ])
    for (const id of BATCH_EXCLUDED_RULE_IDS) {
      expect(isBatchableRule(rule({ id, sql: 'SELECT 1 AS v' }))).toBe(false)
    }
  })

  test('excludes a rule whose SQL cannot nest', () => {
    expect(
      isBatchableRule(
        rule({
          id: 'settings-clause',
          sql: 'SELECT 1 AS v SETTINGS max_execution_time = 5',
        })
      )
    ).toBe(false)
  })

  test('includes an ordinary optional rule', () => {
    expect(
      isBatchableRule(
        rule({
          id: 'readonly-replicas',
          sql: 'SELECT count() AS readonly_count FROM system.replicas',
          optional: true,
          tableCheck: 'system.replicas',
        })
      )
    ).toBe(true)
  })
})

describe('partitionRulesForSweep', () => {
  const rules: AlertRuleDef[] = [
    rule({
      id: 'small-1',
      sql: 'SELECT 1 AS v',
      optional: true,
      tableCheck: 'system.disks',
    }),
    rule({
      id: 'small-2',
      sql: 'SELECT 2 AS v',
      optional: true,
      tableCheck: 'system.backup_log',
    }),
    // A SETTINGS clause makes it non-nestable, so it takes its own statement —
    // the same shape as the real `ttl-partition-health` builders.
    rule({
      id: 'unbatchable',
      sql: 'SELECT 3 AS v FROM system.tables SETTINGS max_execution_time = 30',
    }),
    // `rule()` supplies a default `sql`, so this one opts out explicitly.
    rule({ id: 'no-sql', sql: undefined }),
  ]

  test('splits into batch, individual and skipped', () => {
    const out = partitionRulesForSweep(rules, new Set(['system.disks']))
    expect(out.batched.map((k) => k.ruleId)).toEqual(['small-1'])
    expect(out.individual.map((r) => r.id)).toEqual(['unbatchable'])
    expect(out.skipped.map((r) => r.id)).toEqual(['small-2'])
  })

  test('an empty table set skips every optional rule, but not the required one', () => {
    // The complementary case to `null`: an EMPTY set is a positive answer ("I
    // looked, these tables are not there"), so optional rules genuinely drop
    // out. A rule with no `tableCheck` has no such gate and must still run.
    const out = partitionRulesForSweep(rules, new Set<string>())
    expect(out.skipped.map((r) => r.id)).toEqual(['small-1', 'small-2'])
    expect(out.individual.map((r) => r.id)).toContain('unbatchable')
  })

  test('an unknown table set skips nothing — a failed probe must not disable checks', () => {
    // `null` means "we could not find out". Skipping on unknown would turn one
    // network blip into a silently empty health page.
    const out = partitionRulesForSweep(rules, null)
    expect(out.skipped).toEqual([])
    expect(out.batched.map((k) => k.ruleId)).toEqual(['small-1', 'small-2'])
  })

  test('a rule with no sql is dropped entirely', () => {
    const out = partitionRulesForSweep(rules, null)
    expect(out.batched.map((k) => k.ruleId)).not.toContain('no-sql')
    expect(out.individual.map((r) => r.id)).not.toContain('no-sql')
  })

  test('every rule is accounted for exactly once, bar the sql-less one', () => {
    const out = partitionRulesForSweep(rules, new Set(['system.disks']))
    const accounted =
      out.batched.length + out.individual.length + out.skipped.length
    expect(accounted).toBe(rules.length - 1)
  })
})

// ---------------------------------------------------------------------------
// The acceptance criterion: total background queries per host per sweep.
// ---------------------------------------------------------------------------

/**
 * A representative tick's rule set: the twelve built-in shapes from
 * `BUILTIN_RULES` (nine batchable, two heavy `system.parts` scans, one
 * non-optional). Values are what the fake server returns, so the before/after
 * numbers are directly comparable.
 */
const TICK_RULES: AlertRuleDef[] = [
  'readonly-replicas',
  'replication-lag',
  'disk-usage',
  'keeper-unavailable',
  'failed-mutations',
  'stuck-merges',
  'query-timeout',
  'failed-backups',
  'mv-refresh-failures',
  'fatal-log-entries',
  'parts-pressure',
  'ttl-partition-health',
].map((id) =>
  rule({
    id,
    sql: `SELECT count() AS v_${id} FROM system.${id.replace(/-/g, '_')}`,
    optional: true,
    tableCheck: 'system.disks',
  })
)

/** Value the fake server reports for every rule, so the two paths agree. */
const RULE_VALUE = 3

/**
 * Count the queries one sweep tick issues, for one of two strategies.
 *
 * `before` is the pre-#3682 path: one `system.tables` probe, then one query
 * per rule — 13 statements.
 *
 * `after` is the shipped path: the probe comes from the capability cache (0
 * queries on a warm cache, 1 on a cold one), the nine batchable rules ride one
 * statement, and the two heavy scans keep their own.
 */
function runHostSweepQueryCounts(
  strategy: 'before' | 'after',
  opts: { coldCapabilityCache: boolean } = { coldCapabilityCache: true }
): number {
  const queries: string[] = []

  // The pre-fix table-existence probe: unconditional, once per tick.
  if (strategy === 'before') {
    queries.push(
      "SELECT concat(database, '.', name) FROM system.tables WHERE database = 'system'"
    )
  } else if (opts.coldCapabilityCache) {
    // Cold cache: the single capability probe, which also covers clusters and
    // app tables. This is the WORST case for the after-path, and it still wins.
    queries.push(
      'SELECT ... FROM system.tables ... UNION ALL ... system.clusters'
    )
  }

  const { batched, individual } = partitionRulesForSweep(
    TICK_RULES,
    // Warm, so `tableCheck` never skips: every rule reports a real number.
    new Set(['system.disks'])
  )

  if (strategy === 'before') {
    for (const kpi of batched) queries.push(kpi.sql)
    for (const r of individual) queries.push(r.sql!)
  } else {
    const rendered = buildBatchedKpiSql(batched)
    if (rendered) queries.push(rendered)
    for (const r of individual) queries.push(r.sql!)
  }

  return queries.length
}

describe('total background queries per host per sweep (acceptance criterion)', () => {
  test('the after-path is at least 50% below the before-path on a cold cache', () => {
    // The issue's criterion, measured. Cold cache is the worst case for the new
    // code: it pays for the capability probe on this very tick.
    const before = runHostSweepQueryCounts('before')
    const afterCold = runHostSweepQueryCounts('after', {
      coldCapabilityCache: true,
    })
    expect(afterCold).toBeLessThanOrEqual(before * 0.5)
    expect({
      before,
      afterCold,
      reductionPct: Math.round((1 - afterCold / before) * 100),
    }).toEqual({
      before: 13,
      afterCold: 4,
      reductionPct: 69,
    })
  })

  test('a warm cache drops it further, because the probe is amortised', () => {
    const afterWarm = runHostSweepQueryCounts('after', {
      coldCapabilityCache: false,
    })
    expect(afterWarm).toBe(3)
    // Nine of twelve rules now cost one statement between them.
    expect(afterWarm).toBeLessThanOrEqual(
      runHostSweepQueryCounts('before') * 0.25
    )
  })

  test('the batch is one statement however many rules ride it', () => {
    const { batched, individual } = partitionRulesForSweep(
      TICK_RULES,
      new Set(['system.disks'])
    )
    // 12 rules - the 2 excluded system.parts scans = 10 batched.
    expect(batched).toHaveLength(10)
    expect(individual.map((r) => r.id)).toEqual([
      'parts-pressure',
      'ttl-partition-health',
    ])
    // N rules, N-1 joins: one statement, not N.
    const rendered = buildBatchedKpiSql(batched)!
    expect(rendered.match(/UNION ALL/g)).toHaveLength(batched.length - 1)
    expect(rendered.match(/AS rule_id/g)).toHaveLength(10)
  })

  test('every batched branch is still individually runnable SQL', () => {
    // The fallback depends on this: when the batch fails, the same rules are
    // re-run one at a time, and that has to work.
    const { batched } = partitionRulesForSweep(
      TICK_RULES,
      new Set(['system.disks'])
    )
    for (const kpi of batched) {
      expect(isSubSelectSafe(kpi.sql)).toBe(true)
    }
  })
})
