import { FEATURE_PAGES } from './feature-pages'
import { FEATURE_SECTIONS } from './feature-showcase'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const CAPABILITIES = join(
  import.meta.dir,
  '../../../../docs/content/guide/ai-agent/capabilities.mdx'
)

const DOCS_POSTGRES_TOOLS = [
  'run_postgres_select_query',
  'get_postgres_metrics',
  'list_postgres_slow_query_patterns',
  'get_postgres_table_stats',
] as const

function landingPostgresCopy(): string {
  const section = FEATURE_SECTIONS.find((s) => s.id === 'feature-postgres')
  const page = FEATURE_PAGES.find((p) => p.slug === 'postgres')
  if (!section || !page) throw new Error('missing landing Postgres copy')
  return [
    ...section.bullets,
    page.description,
    ...page.stats.flatMap((s) => [s.value, s.label]),
    ...page.sections.flatMap((s) => [s.title, s.body, ...(s.bullets ?? [])]),
    ...page.capabilities.flatMap((c) => [c.title, c.body]),
  ].join('\n')
}

describe('landing Postgres tool count matches docs', () => {
  test('capabilities.mdx lists four env-gated Postgres tools', () => {
    const src = readFileSync(CAPABILITIES, 'utf8')
    expect(src).toContain('4 env-gated cross-source Postgres tools')
    for (const name of DOCS_POSTGRES_TOOLS) {
      expect(src).toContain(name)
    }
    expect(DOCS_POSTGRES_TOOLS).toHaveLength(4)
  })

  test('landing says four env-gated tools, not three', () => {
    const hay = landingPostgresCopy()
    expect(hay).toMatch(/Four env-gated/i)
    expect(hay).toContain('4 tools')
    expect(hay).not.toMatch(/\bThree\b/)
    expect(hay).not.toMatch(/\b3 tools\b/)
  })
})
