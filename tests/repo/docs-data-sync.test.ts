/**
 * The docs data files (docs/content/_data/*.json) are generated from code by
 * scripts/gen-docs-data.ts and committed. This test regenerates them in memory
 * and fails when the committed copy is stale, so the docs tables built from
 * them (alert rules, agent tools, env vars, version matrix) cannot drift.
 *
 * It also checks that every env var the dashboard reads is named in the
 * environment-variables reference page. Descriptions stay hand-written in MDX;
 * only the names are checked here.
 */

import {
  DATA_DIR,
  generateDocsData,
  stableJson,
} from '../../scripts/gen-docs-data'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dir, '../..')
const ENV_DOC = readFileSync(
  join(REPO_ROOT, 'docs/content/reference/environment-variables.mdx'),
  'utf8'
)

const REGEN_HINT = 'run bun scripts/gen-docs-data.ts'

/**
 * Names of the files whose committed content differs from `generated`.
 * Compared as parsed JSON, not bytes: the pre-commit hook runs `biome format`
 * on staged JSON, which may re-wrap arrays without changing the data.
 */
function staleFiles(
  generated: Record<string, string>,
  readCommitted: (name: string) => string | null
): string[] {
  return Object.entries(generated)
    .filter(([name, content]) => {
      const committed = readCommitted(name)
      if (committed === null) return true
      try {
        return !Bun.deepEquals(JSON.parse(committed), JSON.parse(content), true)
      } catch {
        return true
      }
    })
    .map(([name]) => name)
}

function readCommitted(name: string): string | null {
  try {
    return readFileSync(join(DATA_DIR, name), 'utf8')
  } catch {
    return null
  }
}

const generated = await generateDocsData()

const isDocumented = (name: string) => new RegExp(`\\b${name}\\b`).test(ENV_DOC)

describe('docs/content/_data matches the code', () => {
  test('generates the four data files', () => {
    expect(Object.keys(generated).sort()).toEqual([
      'agent-tools.json',
      'alert-rules.json',
      'env-vars.json',
      'version-matrix.json',
    ])
  })

  test('committed JSON is up to date', () => {
    const stale = staleFiles(generated, readCommitted)
    if (stale.length > 0) {
      throw new Error(`Stale docs data (${stale.join(', ')}): ${REGEN_HINT}`)
    }
  })

  test('a changed rule title is caught as stale', () => {
    // Prove the comparison is not vacuous: mutate one rule title in memory
    // and confirm alert-rules.json is reported stale.
    const alerts = JSON.parse(generated['alert-rules.json'])
    alerts.rules[0].title = `${alerts.rules[0].title} (edited)`
    const mutated = {
      ...generated,
      'alert-rules.json': stableJson(alerts),
    }
    expect(staleFiles(mutated, readCommitted)).toEqual(['alert-rules.json'])
  })

  test('output is deterministic', async () => {
    expect(await generateDocsData()).toEqual(generated)
  })
})

describe('env vars are named in environment-variables.mdx', () => {
  const names: string[] = JSON.parse(generated['env-vars.json']).vars.map(
    (v: { name: string }) => v.name
  )

  test('every env var read by the code is documented', () => {
    const missing = names.filter((n) => !isDocumented(n))
    if (missing.length > 0) {
      throw new Error(
        `Undocumented env vars — add them to docs/content/reference/environment-variables.mdx: ${missing.join(', ')}`
      )
    }
  })
})
