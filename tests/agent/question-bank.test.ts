/**
 * The question bank (`cases/questions.yaml`) maps realistic user questions to
 * the tool(s) and skill the agent should use. A bank that names a tool or skill
 * the agent does not ship is worse than no bank: the live eval would grade the
 * agent against a capability that no longer exists. So this gate checks, with
 * no key and no network:
 *
 * - every tool any case names (covers, toolCalled/noToolCalled config,
 *   `[tool:x]` in a not-contains) is a row in TOOL_CATALOG, the side table
 *   `tool-catalog.test.ts` keeps in lockstep with createAllTools();
 * - every skill a case names is in the generated SKILLS registry;
 * - every core tool has at least one bank question, so a renamed or new core
 *   tool cannot slip out of the eval.
 *
 * A consistent rename (factory key + catalog row) keeps tool-catalog.test.ts
 * green and turns this one red until the bank follows.
 */

import { SKILLS } from '../../apps/dashboard/src/lib/ai/agent/skills/registry'
import {
  coreToolNames,
  TOOL_CATALOG,
} from '../../apps/dashboard/src/lib/ai/agent/tools/catalog'
import { type EvalCase, loadCases } from './select-cases.js'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const casesDir = join(here, 'cases')

type Assertion = {
  type: string
  value?: unknown
  config?: { tools?: string[] }
}
type Case = EvalCase & {
  metadata?: { covers?: string[]; skills?: string[] }
  assert?: Assertion[]
}

const all = loadCases(casesDir) as Case[]
const bank = (
  Bun.YAML.parse(
    readFileSync(join(casesDir, 'questions.yaml'), 'utf8')
  ) as Case[]
).map((c) => c.description)
const bankCases = all.filter((c) => bank.includes(c.description))

const toolTarget = (a: Assertion) =>
  a.type === 'javascript' && /:(toolCalled|noToolCalled)$/.test(String(a.value))

/** Every tool name a case refers to, with where it came from. */
function referencedTools(c: Case): string[] {
  const names = [...(c.metadata?.covers ?? [])]
  for (const a of c.assert ?? []) {
    if (toolTarget(a)) names.push(...(a.config?.tools ?? []))
    if (a.type === 'not-contains' || a.type === 'contains') {
      for (const m of String(a.value).matchAll(/\[tool:([a-z0-9_]+)\]/g))
        names.push(m[1])
    }
  }
  return names
}

describe('question bank', () => {
  test('the bank is loaded and non-trivial', () => {
    // Guards against a vacuous pass (empty file, wrong path, parse to []).
    expect(bankCases.length).toBe(bank.length)
    expect(bankCases.length).toBeGreaterThanOrEqual(25)
    expect(coreToolNames().length).toBeGreaterThan(0)
  })

  test('every tool referenced by any eval case is in TOOL_CATALOG', () => {
    const missing = all.flatMap((c) =>
      referencedTools(c)
        .filter((t) => !(t in TOOL_CATALOG))
        .map((t) => `${c.description}: ${t}`)
    )
    expect(missing).toEqual([])
  })

  test('every skill referenced by any eval case is in the skills registry', () => {
    const known = new Set(SKILLS.map((s) => s.name))
    expect(known.size).toBeGreaterThan(0)
    const missing = all.flatMap((c) =>
      (c.metadata?.skills ?? [])
        .filter((s) => !known.has(s))
        .map((s) => `${c.description}: ${s}`)
    )
    expect(missing).toEqual([])
  })

  test('every bank question maps to tools the live assertion accepts', () => {
    for (const c of bankCases) {
      const covers = c.metadata?.covers ?? []
      expect(covers.length, c.description).toBeGreaterThan(0)
      const called = (c.assert ?? []).find(
        (a) => toolTarget(a) && String(a.value).endsWith(':toolCalled')
      )
      expect(called, c.description).toBeDefined()
      // The static map and the live gate cannot disagree: each expected tool
      // must be one the live toolCalled assertion passes on.
      for (const t of covers)
        expect(called?.config?.tools ?? [], `${c.description}: ${t}`).toContain(
          t
        )
      // A skill question is only answerable through load_skill.
      if ((c.metadata?.skills ?? []).length > 0)
        expect(called?.config?.tools ?? [], c.description).toContain(
          'load_skill'
        )
    }
  })

  test('every core tool has at least one bank question', () => {
    const covered = new Set(bankCases.flatMap((c) => c.metadata?.covers ?? []))
    const uncovered = coreToolNames().filter((t) => !covered.has(t))
    expect(uncovered).toEqual([])
  })
})
