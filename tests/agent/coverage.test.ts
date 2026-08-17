/**
 * Structural coverage: default-gate tools defined in shipped `tools/*.ts`
 * must appear in a case `metadata.covers` list (not a comment dump).
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const toolsDir = join(
  here,
  '../../apps/dashboard/src/lib/ai/agent/tools'
)

const GATED = new Set([
  'kill_query',
  'optimize_table',
  'kill_mutation',
  'run_postgres_select_query',
  'list_postgres_slow_query_patterns',
  'get_postgres_metrics',
  'get_postgres_table_stats',
])

function shippedDefaultTools(): string[] {
  const names: string[] = []
  for (const file of readdirSync(toolsDir)) {
    if (!file.endsWith('.ts') || file.includes('test')) continue
    const text = readFileSync(join(toolsDir, file), 'utf8')
    const re = /^\s+([a-z][a-z0-9_]+):\s*dynamicTool\(/gm
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      names.push(match[1])
    }
  }
  return [...new Set(names)].filter((name) => !GATED.has(name)).sort()
}

function coveredTools(): Set<string> {
  const dir = join(here, 'cases')
  const found = new Set<string>()
  const re = /covers:\s*\[([^\]]+)\]/g
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.yaml')) continue
    const text = readFileSync(join(dir, file), 'utf8')
    let match: RegExpExecArray | null
    while ((match = re.exec(text))) {
      for (const raw of match[1].split(',')) {
        const name = raw.trim()
        if (name) found.add(name)
      }
    }
  }
  return found
}

describe('promptfoo goldens cover shipped tools', () => {
  test('every default-gate tool is listed in a case metadata.covers', () => {
    const covered = coveredTools()
    const missing = shippedDefaultTools().filter((name) => !covered.has(name))
    expect(missing).toEqual([])
  })
})
