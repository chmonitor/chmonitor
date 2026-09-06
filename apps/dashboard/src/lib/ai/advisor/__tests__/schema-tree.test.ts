import type { TuningFinding } from '../tuning/types'

import {
  applyAdvisorTreeControls,
  buildTableDetail,
  careKeySet,
  careKeysFromFindings,
  DEFAULT_ADVISOR_TREE_CONTROLS,
  findingTableKey,
  groupAdvisorTables,
  NEW_TABLE_TIPS,
  orderDatabases,
  tableAnalysisPrompt,
  tableKey,
} from '../schema-tree'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const TREE = [
  {
    database: 'analytics',
    name: 'events',
    engine: 'MergeTree',
    totalRows: 9,
  },
  {
    database: 'analytics',
    name: 'events_mv',
    engine: 'MaterializedView',
    totalRows: 0,
  },
  {
    database: 'analytics',
    name: 'sessions',
    engine: 'MergeTree',
    totalRows: 3,
  },
  {
    database: 'system',
    name: 'query_log',
    engine: 'MergeTree',
    totalRows: 1,
  },
]

function finding(
  overrides: Partial<TuningFinding> & Pick<TuningFinding, 'target' | 'title'>
): TuningFinding {
  return {
    ruleId: 'missing_ttl',
    category: 'schema',
    rationale: 'No TTL on a time-series table.',
    evidence: '0 TTL expression',
    estimatedBenefit: 'Estimated: cheaper historical drops.',
    estimatedBytesSaved: 0,
    severity: 'medium',
    ddl: 'ALTER TABLE analytics.events MODIFY TTL event_date + INTERVAL 90 DAY',
    risk: 'medium',
    riskNote: 'Recommend-only — review before running.',
    ...overrides,
  }
}

const FINDINGS: TuningFinding[] = [
  finding({
    title: 'Add TTL to events',
    target: 'analytics.events',
    severity: 'high',
  }),
  finding({
    title: 'Drop Nullable from events.user_id',
    target: 'analytics.events.user_id',
    ruleId: 'nullable_column',
    ddl: 'ALTER TABLE analytics.events MODIFY COLUMN `user_id` UInt64',
  }),
  finding({
    title: 'Tune max_bytes_before_external_group_by',
    target: 'max_bytes_before_external_group_by',
    category: 'settings',
    ruleId: 'setting_tuning',
    ddl: 'SET max_bytes_before_external_group_by = 0',
  }),
]

describe('care flags from findings', () => {
  test('maps schema targets to db.table and ignores settings', () => {
    expect(findingTableKey(FINDINGS[0]!)).toBe('analytics.events')
    expect(findingTableKey(FINDINGS[1]!)).toBe('analytics.events')
    expect(findingTableKey(FINDINGS[2]!)).toBeNull()
    const flags = careKeysFromFindings(FINDINGS)
    expect([...flags.keys()]).toEqual(['analytics.events'])
    expect(flags.get('analytics.events')).toEqual({
      count: 2,
      maxSeverity: 'high',
    })
  })
})

describe('filter / sort / group / hide suggested', () => {
  const care = careKeySet(careKeysFromFindings(FINDINGS))

  test('name filter keeps matching tables', () => {
    const rows = applyAdvisorTreeControls(
      TREE,
      { ...DEFAULT_ADVISOR_TREE_CONTROLS, query: 'sess' },
      care
    )
    expect(rows.map((row) => row.name)).toEqual(['sessions'])
  })

  test('hide-care removes suggested tables', () => {
    const rows = applyAdvisorTreeControls(
      TREE,
      { ...DEFAULT_ADVISOR_TREE_CONTROLS, visibility: 'hide-care' },
      care
    )
    expect(rows.map((row) => `${row.database}.${row.name}`)).toEqual([
      'analytics.events_mv',
      'analytics.sessions',
      'system.query_log',
    ])
  })

  test('care visibility lists only suggested tables', () => {
    const rows = applyAdvisorTreeControls(
      TREE,
      { ...DEFAULT_ADVISOR_TREE_CONTROLS, visibility: 'care' },
      care
    )
    expect(rows.map((row) => row.name)).toEqual(['events'])
  })

  test('sort Z-A', () => {
    const analytics = TREE.filter((row) => row.database === 'analytics')
    const rows = applyAdvisorTreeControls(
      analytics,
      {
        ...DEFAULT_ADVISOR_TREE_CONTROLS,
        sort: 'name-desc',
        group: 'database',
      },
      care
    )
    expect(rows.map((row) => row.name)).toEqual([
      'sessions',
      'events_mv',
      'events',
    ])
  })

  test('care-first sort puts suggested tables first', () => {
    const analytics = TREE.filter((row) => row.database === 'analytics')
    const rows = applyAdvisorTreeControls(
      analytics,
      { ...DEFAULT_ADVISOR_TREE_CONTROLS, sort: 'care-first' },
      care
    )
    expect(rows[0]?.name).toBe('events')
  })

  test('group by care splits needs-attention vs looking-good', () => {
    const groups = groupAdvisorTables(
      TREE,
      { ...DEFAULT_ADVISOR_TREE_CONTROLS, group: 'care' },
      care
    )
    expect(groups.map((group) => group.id)).toEqual(['care', 'ok'])
    expect(groups[0]?.tables.map((row) => row.name)).toEqual(['events'])
    expect(groups[1]?.tables.some((row) => row.name === 'events')).toBe(false)
  })

  test('group by engine buckets MaterializedView separately', () => {
    const groups = groupAdvisorTables(
      TREE.filter((row) => row.database === 'analytics'),
      { ...DEFAULT_ADVISOR_TREE_CONTROLS, group: 'engine', sort: 'name-asc' },
      care
    )
    expect(groups.map((group) => group.id)).toEqual([
      'MaterializedView',
      'MergeTree',
    ])
  })

  test('orderDatabases puts databases with care tables first', () => {
    const ordered = orderDatabases(
      [{ name: 'system' }, { name: 'analytics' }],
      'care',
      care
    )
    expect(ordered.map((row) => row.name)).toEqual(['analytics', 'system'])
  })
})

describe('selected table detail', () => {
  test('yields recommendation fields for a care table', () => {
    const detail = buildTableDetail({
      database: 'analytics',
      table: 'events',
      engine: 'MergeTree',
      findings: FINDINGS,
    })
    expect(detail.needsCare).toBe(true)
    expect(detail.suggestions.length).toBe(2)
    expect(detail.suggestions[0]?.ddl).toContain('ALTER TABLE')
    expect(detail.suggestions[0]?.title).toBeTruthy()
    expect(detail.findings.every((row) => row.ddl)).toBe(true)
    expect(tableKey(detail.database, detail.table)).toBe('analytics.events')
  })

  test('healthy table has empty suggestions', () => {
    const detail = buildTableDetail({
      database: 'analytics',
      table: 'sessions',
      findings: FINDINGS,
    })
    expect(detail.needsCare).toBe(false)
    expect(detail.suggestions).toEqual([])
  })

  test('analysis prompt is recommend-only', () => {
    const prompt = tableAnalysisPrompt('analytics', 'events')
    expect(prompt).toContain('analytics.events')
    expect(prompt.toLowerCase()).toContain('do not apply')
  })

  test('new-table tips exist for the all-good state', () => {
    expect(NEW_TABLE_TIPS.length).toBeGreaterThanOrEqual(3)
    expect(NEW_TABLE_TIPS.some((tip) => /ORDER BY/i.test(tip.title))).toBe(true)
  })
})

describe('schema tab reuses Explorer DatabaseTree', () => {
  test('advisor schema UI imports DatabaseTree, not a forked tree', () => {
    const base = fileURLToPath(
      new URL('../../../../components/agents/advisor-schema/', import.meta.url)
    )
    const src = [
      'schema-sidebar.tsx',
      'advisor-schema-tab.tsx',
      'table-relations.tsx',
    ]
      .map((name) => readFileSync(`${base}${name}`, 'utf-8'))
      .join('\n')
    expect(src).toContain("from '@/components/explorer/tree'")
    expect(src).toContain('<DatabaseTree')
    expect(src).not.toMatch(/\bApply\b.*\bDDL\b/i)
    expect(src).not.toMatch(/\bexecuteDdl\b/)
    expect(src).not.toContain('onApply')
  })
})
