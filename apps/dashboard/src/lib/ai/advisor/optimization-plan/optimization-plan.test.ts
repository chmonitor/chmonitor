import type { FindingRow } from '@/lib/findings/findings-store'
import type { PlanCandidate } from './schema'

import { planFromFindings } from './build-plan'
import { candidateFromFinding, parseQualified } from './items'
import { planToMarkdown } from './markdown'
import { estimateHours, rankPlan } from './ranker'
import { planSchema } from './schema'
import { describe, expect, test } from 'bun:test'

const GIB = 1024 ** 3

function row(
  metric: string,
  value: number,
  extra: Partial<FindingRow> = {}
): FindingRow {
  return {
    event_time: '2026-10-23 10:00:00',
    host_id: '0',
    severity: 'info',
    category: 'storage',
    source: 'ai-insight',
    title: `title ${metric}`,
    detail: `detail ${metric}`,
    metric,
    value,
    ...extra,
  }
}

function cand(id: string, over: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    id,
    title: id,
    owner: 'db',
    source: 'usage',
    savedBytes: null,
    readBytesSavedPerDay: null,
    applyCost: {
      kind: 'none',
      rewriteBytes: null,
      freeDiskNeeded: null,
      estHours: null,
    },
    risk: 'low',
    reversible: true,
    ddl: [],
    verifySql: '',
    evidenceSql: '',
    evidence: '',
    dependsOn: [],
    needsOwnerApproval: false,
    ...over,
  }
}

describe('rankPlan', () => {
  test('ranks by gain over apply time, unmeasured gain last', () => {
    const { items } = rankPlan([
      cand('unknown'),
      cand('small', { savedBytes: 1 * GIB }),
      cand('slow-big', {
        savedBytes: 100 * GIB,
        applyCost: {
          kind: 'mutation',
          rewriteBytes: 0,
          freeDiskNeeded: 0,
          estHours: 999,
        },
      }),
      cand('big', { savedBytes: 50 * GIB }),
    ])
    expect(items.map((i) => i.id)).toEqual([
      'big',
      'small',
      'slow-big',
      'unknown',
    ])
    expect(items.map((i) => i.rank)).toEqual([1, 2, 3, 4])
  })

  test('a high-risk item stays listed and is gated behind owner approval', () => {
    const { items } = rankPlan([
      cand('risky', { risk: 'high', savedBytes: 9 * GIB }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].needsOwnerApproval).toBe(true)
  })

  test('dependsOn moves an item after its dependency', () => {
    const { items } = rankPlan([
      cand('first-by-gain', { savedBytes: 10 * GIB, dependsOn: ['prereq'] }),
      cand('prereq'),
    ])
    expect(items.map((i) => i.id)).toEqual(['prereq', 'first-by-gain'])
  })

  test('missing or circular dependencies are rejected, not dropped silently', () => {
    const { items, rejected } = rankPlan([
      cand('orphan', { dependsOn: ['nope'] }),
      cand('a', { dependsOn: ['b'] }),
      cand('b', { dependsOn: ['a'] }),
      cand('ok'),
    ])
    expect(items.map((i) => i.id)).toEqual(['ok'])
    expect(rejected.map((r) => r.item.id).sort()).toEqual(['a', 'b', 'orphan'])
  })

  test('estimateHours uses the configured throughput and keeps unknown unknown', () => {
    expect(estimateHours(180e9, 50)).toBe(1)
    expect(estimateHours(null)).toBeNull()
  })
})

describe('candidateFromFinding', () => {
  test('unused projection gets a quoted DROP PROJECTION behind the approval gate', () => {
    const c = candidateFromFinding(
      row('usage:unused_projection:logs.raw.p_x', 80 * GIB)
    )
    expect(c?.ddl).toEqual(['ALTER TABLE `logs`.`raw` DROP PROJECTION `p_x`'])
    expect(c?.savedBytes).toBe(80 * GIB)
    expect(c?.risk).toBe('high')
    expect(c?.needsOwnerApproval).toBe(true)
    expect(c?.owner).toBe('logs')
  })

  test('an ambiguous qualified name produces no DDL', () => {
    const c = candidateFromFinding(row('usage:unused_projection:a.b.c.d', GIB))
    expect(c?.ddl).toEqual([])
    expect(c?.owner).toBeNull()
    expect(parseQualified('a.`b`', 2)).toBeNull()
  })

  test('an unread table is an owner question, never a DROP TABLE', () => {
    const c = candidateFromFinding(row('usage:unread_table:logs.raw', 20 * GIB))
    expect(c?.ddl).toEqual([])
    expect(c?.needsOwnerApproval).toBe(true)
  })

  test('detached parts are review-only with no statement and no bytes', () => {
    for (const m of ['detached_parts', 'broken_detached_parts']) {
      const c = candidateFromFinding(row(m, 42))
      expect(c?.ddl).toEqual([])
      expect(c?.savedBytes).toBeNull()
      expect(c?.evidenceSql).toContain('system.detached_parts')
    }
  })

  test('a TTL rewrite ratio is never turned into bytes', () => {
    const c = candidateFromFinding(row('ttl_rewrite:logs.raw', 12.5))
    expect(c?.savedBytes).toBeNull()
    expect(c?.ddl[0]).toContain('MODIFY SETTING ttl_only_drop_parts = 1')
    expect(c?.rollbackSql).toContain('RESET SETTING ttl_only_drop_parts')
  })

  test('findings with no planned collector are ignored', () => {
    expect(candidateFromFinding(row('error_rate', 3))).toBeNull()
  })
})

describe('planFromFindings', () => {
  test('builds a schema-valid, not-applied plan with newest row per metric', () => {
    const plan = planFromFindings(
      0,
      [
        row('usage:unread_table:logs.raw', 10 * GIB, {
          event_time: '2026-10-23 09:00:00',
        }),
        row('usage:unread_table:logs.raw', 20 * GIB),
        row('detached_parts', 4),
        row('error_rate', 1),
      ],
      { now: new Date('2026-10-23T10:00:00Z') }
    )
    expect(planSchema.parse(plan).notApplied).toBe(true)
    expect(plan.items).toHaveLength(2)
    expect(plan.items[0].savedBytes).toBe(20 * GIB)
    expect(plan.skipped.map((s) => s.collector)).toEqual(['codec'])
  })

  test('no stored findings records every collector as skipped', () => {
    const plan = planFromFindings(0, [])
    expect(plan.items).toEqual([])
    expect(plan.collectorsRan).toEqual([])
    expect(plan.skipped.map((s) => s.collector)).toEqual([
      'codec',
      'usage',
      'detached',
      'ttl',
      'settings',
    ])
  })

  test('markdown carries the NOT APPLIED banner and fences evidence as data', () => {
    const plan = planFromFindings(0, [
      row('usage:unused_projection:logs.raw.p', GIB, {
        detail: 'evil ```sql DROP``` text',
      }),
    ])
    const md = planToMarkdown(plan)
    expect(md).toContain('NOT APPLIED')
    expect(md).toContain('DROP PROJECTION `p`')
    expect(md).not.toContain('evil ```')
  })
})
