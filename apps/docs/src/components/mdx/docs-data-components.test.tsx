import { describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'

// The components import `@/generated/docs-data/*.json`, which sync-docs.mjs
// copies from docs/content/_data. Do the same copy so the test does not need a
// prior docs build.
const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '../../../../../docs/content/_data')
const DEST = join(HERE, '../../generated/docs-data')
mkdirSync(DEST, { recursive: true })
for (const name of readdirSync(SRC).filter((n) => n.endsWith('.json'))) {
  copyFileSync(join(SRC, name), join(DEST, name))
}
const read = (name: string) => JSON.parse(readFileSync(join(SRC, name), 'utf8'))

const { EnvVarTable, envCategories, filterEnvVars } = await import(
  './env-var-table'
)
const { ToolCatalog, filterTools, toolCategories } = await import(
  './tool-catalog'
)
const { AlertRuleList, groupRules } = await import('./alert-rule-list')
const { VersionMatrix, sinceColumns } = await import('./version-matrix')

describe('EnvVarTable', () => {
  const vars = read('env-vars.json').vars

  test('category chips come from the name prefix', () => {
    const cats = envCategories(vars)
    expect(cats).toContain('CHM')
    expect(cats).toContain('CLICKHOUSE')
    expect(cats).toEqual([...cats].sort())
  })

  test('search is case-insensitive and composes with the category', () => {
    const hits = filterEnvVars(vars, 'clickhouse_host', null)
    expect(hits.map((v: { name: string }) => v.name)).toContain(
      'CLICKHOUSE_HOST'
    )
    expect(filterEnvVars(vars, 'clickhouse_host', 'CHM')).toEqual([])
  })

  test('renders every variable with a copy button', () => {
    const html = renderToStaticMarkup(<EnvVarTable />)
    for (const v of vars) expect(html).toContain(`Copy ${v.name}`)
  })
})

describe('ToolCatalog', () => {
  const tools = read('agent-tools.json').tools

  test('filters by catalog category', () => {
    const cats = toolCategories(tools)
    expect(cats.length).toBeGreaterThan(1)
    for (const t of filterTools(tools, cats[0])) {
      expect(t.category ?? 'uncategorized').toBe(cats[0])
    }
    expect(filterTools(tools, null)).toHaveLength(tools.length)
  })

  test('shows the env gate badge for gated tools', () => {
    const gated = tools.filter((t: { envGate: string | null }) => t.envGate)
    expect(gated.length).toBeGreaterThan(0)
    const html = renderToStaticMarkup(<ToolCatalog />)
    for (const t of gated) expect(html).toContain(`${t.envGate}=true`)
  })
})

describe('AlertRuleList', () => {
  const { rules, compound } = read('alert-rules.json')

  test('groups every rule exactly once', () => {
    const grouped = groupRules(rules).flatMap(([, list]) => list)
    expect(grouped).toHaveLength(rules.length)
  })

  test('renders thresholds, table requirement, SQL and compound deps', () => {
    const html = renderToStaticMarkup(<AlertRuleList />)
    const withTable = rules.find(
      (r: { tableCheck: string | null }) => r.tableCheck
    )
    expect(html).toContain(withTable.tableCheck)
    expect(html).toContain(`critical ≥ ${rules[0].thresholds.critical}`)
    expect(html).toContain('<details')
    for (const c of compound) expect(html).toContain(`#rule-${c.depends[0]}`)
  })
})

describe('VersionMatrix', () => {
  const matrix = read('version-matrix.json')

  test('columns are distinct since versions, oldest first', () => {
    const cols = sinceColumns(matrix.configs)
    expect(new Set(cols).size).toBe(cols.length)
    expect(cols.indexOf('23.8')).toBeLessThan(cols.indexOf('24.10'))
    expect(cols.indexOf('24.1')).toBeLessThan(cols.indexOf('24.10'))
  })

  test('renders the minimum supported version and every config', () => {
    const html = renderToStaticMarkup(<VersionMatrix />)
    expect(html).toContain(matrix.minimumSupportedVersion)
    for (const c of matrix.configs) expect(html).toContain(c.name)
  })
})
