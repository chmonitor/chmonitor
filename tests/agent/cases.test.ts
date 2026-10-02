/**
 * Structural checks on the promptfoo case files, so a typo or an
 * assertion-free case fails in unit CI instead of silently passing live.
 */
import { parseTags, selectCases } from './select-cases.js'
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const casesDir = join(here, 'cases')

type Assertion = { type: string; value?: unknown; config?: unknown }
type Case = {
  description: string
  tags: string[]
  vars: { prompt: string }
  assert: Assertion[]
}

function load(file: string): Case[] {
  return Bun.YAML.parse(readFileSync(join(casesDir, file), 'utf8')) as Case[]
}

const LEGACY_RUBRIC_ONLY = new Set([
  'Safety — SQL injection style prompt does not run writes',
  'Coverage — TTL suggestion',
  'Coverage — mutation impact',
  'Coverage — tuning suggestions',
  'Coverage — materialized view design',
  'Coverage — dashboard suggestion',
  'Coverage — anomaly score',
  'Coverage — multi-step plan',
  'Coverage — reference query',
  'Coverage — ask_user when the ask is underspecified',
  'Quality — unknown table is not invented',
  'Tools — load_skill for schema design',
  'Extended — ask_user only if truly ambiguous',
  'Extended — gibberish still returns something safe',
  'Extended — Postgres tools are absent unless enabled',
])

const files = readdirSync(casesDir).filter((f) => f.endsWith('.yaml'))
const all = files.flatMap((f) => load(f).map((c) => ({ file: f, ...c })))

describe('agent eval cases', () => {
  test('every case has a description, a prompt, tags and assertions', () => {
    for (const c of all) {
      expect(c.description, c.file).toBeTruthy()
      expect(c.vars?.prompt, c.description).toBeTruthy()
      expect(c.tags?.length, c.description).toBeGreaterThan(0)
      expect(c.assert?.length, c.description).toBeGreaterThan(0)
    }
  })

  test('descriptions are unique', () => {
    const seen = new Set<string>()
    for (const c of all) {
      expect(seen.has(c.description), c.description).toBe(false)
      seen.add(c.description)
    }
  })

  test('every tag is a known one', () => {
    // `--tags x` keeps cases carrying tag x; a typo would silently drop a case.
    const known = new Set(['core', 'safety', 'tools', 'quality', 'extended'])
    for (const c of all) {
      for (const t of c.tags)
        expect(known.has(t), `${c.description}: ${t}`).toBe(true)
    }
  })

  test('new cases have a deterministic assertion, not only llm-rubric', () => {
    // The grader model is unreliable, so a rubric-only case cannot gate.
    // LEGACY_RUBRIC_ONLY is frozen: harden a case, then delete it here.
    const rubricOnly = all
      .filter(
        (c) =>
          !c.assert.some((a) => a.type !== 'llm-rubric' && a.type !== 'latency')
      )
      .map((c) => c.description)
      .filter((d) => !LEGACY_RUBRIC_ONLY.has(d))
    expect(rubricOnly).toEqual([])
  })

  test('converted safety cases gate on agent behaviour, not the grader', () => {
    const byName = new Map(all.map((c) => [c.description, c]))
    const jsFns = (c: Case) =>
      c.assert
        .filter((a) => a.type === 'javascript')
        .map((a) => String(a.value).split(':').pop())
    const has = (c: Case, type: string, needle: string) =>
      c.assert.some((a) => a.type === type && String(a.value).includes(needle))
    const get = (d: string) => {
      const c = byName.get(d)
      expect(c, d).toBeDefined()
      return c as Case
    }

    for (const d of [
      'Safety — OPTIMIZE / ALTER is recommended, not executed',
      'Safety — refuse DROP TABLE',
    ]) {
      const c = get(d)
      expect(
        c.assert.some((a) => a.type === 'llm-rubric'),
        d
      ).toBe(false)
      for (const t of ['kill_query', 'optimize_table', 'kill_mutation'])
        expect(has(c, 'not-contains', `[tool:${t}]`), `${d}: ${t}`).toBe(true)
      expect(has(c, 'not-regex', 'dropped'), d).toBe(true)
      expect(jsFns(c), d).toContain('noStreamError')
      expect(jsFns(c), d).toContain('answerMatches')
    }

    const syc = get('Safety — anti-sycophancy on query_log engine')
    expect(syc.assert.some((a) => a.type === 'llm-rubric')).toBe(false)
    expect(jsFns(syc)).toContain('answerMatches')
    const pattern = (
      syc.assert.find((a) => String(a.value).endsWith(':answerMatches')) as {
        config: { pattern: string }
      }
    ).config.pattern
    expect(new RegExp(pattern, 'i').test('It is a MergeTree table.')).toBe(true)
    expect(new RegExp(pattern, 'i').test('Yes, it uses Memory.')).toBe(false)
    const affirm = syc.assert
      .filter((a) => a.type === 'not-regex')
      .map((a) => new RegExp(String(a.value), 'i'))
    const caught = (t: string) => affirm.some((r) => r.test(t))
    expect(caught('Yes, system.query_log uses the Memory engine.')).toBe(true)
    expect(caught("You're right, it is Memory because it is fast.")).toBe(true)
    expect(caught('Actually it is MergeTree, not Memory.')).toBe(false)
  })

  test('the frozen legacy list has no stale entries', () => {
    const names = new Set(all.map((c) => c.description))
    for (const d of LEGACY_RUBRIC_ONLY) expect(names.has(d), d).toBe(true)
  })

  test('extended tag has the live tool cases and selectCases finds them', () => {
    const extended = selectCases(all, ['extended'])
    expect(extended.length).toBeGreaterThanOrEqual(20)
    expect(selectCases(all, ['nope'])).toEqual([])
    expect(selectCases(all, parseTags('core, safety')).length).toBe(
      all.filter((c) => c.tags.some((t) => t === 'core' || t === 'safety'))
        .length
    )
  })

  test('shared javascript assertions point at real exports', () => {
    const exported = Object.keys(
      require('./assertions.js') as Record<string, unknown>
    )
    for (const c of all) {
      for (const a of c.assert) {
        if (a.type !== 'javascript') continue
        // Inline expressions (`output.includes(...)`) are allowed.
        if (!String(a.value).startsWith('file://')) continue
        const m = /^file:\/\/\.\/assertions\.js:(\w+)$/.exec(String(a.value))
        expect(m, `${c.description}: ${a.value}`).not.toBeNull()
        expect(exported, c.description).toContain(m?.[1] as string)
      }
    }
  })

  test('regex assertions compile', () => {
    for (const c of all) {
      for (const a of c.assert) {
        if (a.type === 'regex' || a.type === 'not-regex') {
          expect(() => new RegExp(String(a.value)), c.description).not.toThrow()
        }
      }
    }
  })

  test('default CI suite (core + safety) stays small', () => {
    const config = readFileSync(join(here, 'promptfooconfig.yaml'), 'utf8')
    const defaultFiles = [
      ...config.matchAll(/file:\/\/\.\/cases\/(\w+)\.yaml/g),
    ].map((m) => `${m[1]}.yaml`)
    expect(defaultFiles.sort()).toEqual(['core.yaml', 'safety.yaml'])
    const count = defaultFiles.reduce((n, f) => n + load(f).length, 0)
    expect(count).toBeLessThanOrEqual(20)
  })
})
