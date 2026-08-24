/**
 * Pure helpers for the Advisor Schema tab: care flags from tuning findings,
 * sidebar filter / sort / group / hide-suggested, and the selected-table
 * detail payload. No I/O — unit-tested with fixtures.
 */

import type { TuningFinding } from '@/lib/ai/advisor/tuning/types'

export type AdvisorTreeTable = {
  database: string
  name: string
  engine: string
  totalRows?: number
}

export type AdvisorTreeSort = 'name-asc' | 'name-desc' | 'care-first'
export type AdvisorTreeGroup = 'database' | 'care' | 'engine'
export type AdvisorTreeVisibility = 'all' | 'care' | 'hide-care'

export interface AdvisorTreeControls {
  query: string
  sort: AdvisorTreeSort
  group: AdvisorTreeGroup
  visibility: AdvisorTreeVisibility
}

export const DEFAULT_ADVISOR_TREE_CONTROLS: AdvisorTreeControls = {
  query: '',
  sort: 'care-first',
  group: 'database',
  visibility: 'all',
}

export type CareSeverity = 'high' | 'medium' | 'low'

export type CareFlag = {
  count: number
  maxSeverity: CareSeverity
}

export type TableSuggestion = {
  title: string
  ddl: string
  rationale: string
  category: TuningFinding['category']
  severity: TuningFinding['severity']
}

export type TableDetailPayload = {
  database: string
  table: string
  engine?: string
  needsCare: boolean
  findings: TuningFinding[]
  suggestions: TableSuggestion[]
}

export const NEW_TABLE_TIPS: { title: string; body: string }[] = [
  {
    title: 'ORDER BY low-cardinality first',
    body: 'Put tenant, date, then high-cardinality ids. A leading UUID wrecks index locality. Align the prefix with the filters you actually use.',
  },
  {
    title: 'Partition monthly, not daily',
    body: 'Prefer `PARTITION BY toYYYYMM(event_date)`. Daily keys explode past ~1000 partitions and slow inserts and merges. TTL belongs on the table, not hand-dropped partitions.',
  },
  {
    title: 'Skip Nullable unless NULLs are real',
    body: 'Nullable adds a null-map and blocks some skip indexes and codecs. Use a documented sentinel (0, empty string, epoch) when the column is always present.',
  },
  {
    title: 'Right-size types and codecs',
    body: 'Narrow integers to the real range, LowCardinality(String) under ~10k distinct values, and ZSTD(3) (Delta/DoubleDelta on timestamps) as the default codec.',
  },
]

const SEVERITY_RANK: Record<CareSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export function tableKey(database: string, table: string): string {
  return `${database}.${table}`
}

/** Schema findings are `db.table` or `db.table.column`. Settings have no table. */
export function findingTableKey(finding: {
  category: string
  target: string
}): string | null {
  if (finding.category === 'settings') return null
  const parts = finding.target.split('.')
  if (parts.length < 2) return null
  return `${parts[0]}.${parts[1]}`
}

export function careKeysFromFindings(
  findings: ReadonlyArray<{
    category: string
    target: string
    severity: CareSeverity
  }>
): Map<string, CareFlag> {
  const map = new Map<string, CareFlag>()
  for (const finding of findings) {
    const key = findingTableKey(finding)
    if (!key) continue
    const prev = map.get(key)
    if (!prev) {
      map.set(key, { count: 1, maxSeverity: finding.severity })
      continue
    }
    prev.count += 1
    if (SEVERITY_RANK[finding.severity] > SEVERITY_RANK[prev.maxSeverity]) {
      prev.maxSeverity = finding.severity
    }
  }
  return map
}

export function careKeySet(flags: Map<string, CareFlag>): Set<string> {
  return new Set(flags.keys())
}

export function databaseHasCare(
  database: string,
  careKeys: ReadonlySet<string>
): boolean {
  const prefix = `${database}.`
  for (const key of careKeys) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

export function applyAdvisorTreeControls(
  tables: readonly AdvisorTreeTable[],
  controls: AdvisorTreeControls,
  careKeys: ReadonlySet<string>
): AdvisorTreeTable[] {
  const q = controls.query.trim().toLowerCase()
  let rows = q
    ? tables.filter(
        (table) =>
          table.name.toLowerCase().includes(q) ||
          table.database.toLowerCase().includes(q) ||
          table.engine.toLowerCase().includes(q)
      )
    : [...tables]

  const isCare = (table: AdvisorTreeTable) =>
    careKeys.has(tableKey(table.database, table.name))

  if (controls.visibility === 'care') {
    rows = rows.filter(isCare)
  } else if (controls.visibility === 'hide-care') {
    rows = rows.filter((table) => !isCare(table))
  }

  const nameCmp = (a: AdvisorTreeTable, b: AdvisorTreeTable) => {
    const n = a.name.localeCompare(b.name)
    return controls.sort === 'name-desc' ? -n : n
  }

  return rows.sort((a, b) => {
    if (controls.group === 'engine') {
      const engineCmp = a.engine.localeCompare(b.engine)
      if (engineCmp !== 0) return engineCmp
    }
    if (controls.group === 'care' || controls.sort === 'care-first') {
      const ac = isCare(a) ? 0 : 1
      const bc = isCare(b) ? 0 : 1
      if (ac !== bc) return ac - bc
    }
    const dbCmp = a.database.localeCompare(b.database)
    if (dbCmp !== 0 && controls.group !== 'engine') return dbCmp
    return nameCmp(a, b)
  })
}

export type AdvisorTreeGroupBucket = {
  id: string
  label: string
  tables: AdvisorTreeTable[]
}

export function groupAdvisorTables(
  tables: readonly AdvisorTreeTable[],
  controls: AdvisorTreeControls,
  careKeys: ReadonlySet<string>
): AdvisorTreeGroupBucket[] {
  const filtered = applyAdvisorTreeControls(tables, controls, careKeys)
  const isCare = (table: AdvisorTreeTable) =>
    careKeys.has(tableKey(table.database, table.name))

  if (controls.group === 'care') {
    return [
      {
        id: 'care',
        label: 'Needs attention',
        tables: filtered.filter(isCare),
      },
      {
        id: 'ok',
        label: 'Looking good',
        tables: filtered.filter((table) => !isCare(table)),
      },
    ].filter((group) => group.tables.length > 0)
  }

  if (controls.group === 'engine') {
    const byEngine = new Map<string, AdvisorTreeTable[]>()
    for (const table of filtered) {
      const list = byEngine.get(table.engine)
      if (list) list.push(table)
      else byEngine.set(table.engine, [table])
    }
    return [...byEngine.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([engine, groupTables]) => ({
        id: engine,
        label: engine,
        tables: groupTables,
      }))
  }

  const byDatabase = new Map<string, AdvisorTreeTable[]>()
  for (const table of filtered) {
    const list = byDatabase.get(table.database)
    if (list) list.push(table)
    else byDatabase.set(table.database, [table])
  }
  return [...byDatabase.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([database, groupTables]) => ({
      id: database,
      label: database,
      tables: groupTables,
    }))
}

export function orderDatabases<T extends { name: string }>(
  databases: readonly T[],
  group: AdvisorTreeGroup,
  careKeys: ReadonlySet<string>
): T[] {
  const rows = [...databases]
  if (group !== 'care') {
    return rows
  }
  return rows.sort((a, b) => {
    const ac = databaseHasCare(a.name, careKeys) ? 0 : 1
    const bc = databaseHasCare(b.name, careKeys) ? 0 : 1
    if (ac !== bc) return ac - bc
    return a.name.localeCompare(b.name)
  })
}

export function buildTableDetail(args: {
  database: string
  table: string
  engine?: string
  findings: readonly TuningFinding[]
}): TableDetailPayload {
  const key = tableKey(args.database, args.table)
  const findings = args.findings.filter(
    (finding) => findingTableKey(finding) === key
  )
  return {
    database: args.database,
    table: args.table,
    engine: args.engine,
    needsCare: findings.length > 0,
    findings,
    suggestions: findings.map((finding) => ({
      title: finding.title,
      ddl: finding.ddl,
      rationale: finding.rationale,
      category: finding.category,
      severity: finding.severity,
    })),
  }
}

export function tableAnalysisPrompt(database: string, table: string): string {
  return `Analyze ClickHouse table \`${database}.${table}\` for schema, TTL, partitioning, codecs, materialized views, and data-related issues. Recommend copyable DDL only — do not apply or execute changes.`
}
