/**
 * Pick promptfoo cases by tag. `scripts/agent-eval.ts --tags a,b` keeps every
 * case in `cases/*.yaml` that carries at least one of the tags, so
 * `AGENT_EVAL_TAGS=extended` runs only the extended cases (including the ones
 * in `coverage.yaml`) instead of the whole suite.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export type EvalCase = {
  description: string
  tags: string[]
  [key: string]: unknown
}

export function loadCases(casesDir: string): EvalCase[] {
  return readdirSync(casesDir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .flatMap(
      (f) =>
        Bun.YAML.parse(readFileSync(join(casesDir, f), 'utf8')) as EvalCase[]
    )
}

export function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
}

export function selectCases(cases: EvalCase[], tags: string[]): EvalCase[] {
  const wanted = new Set(tags)
  return cases.filter((c) => c.tags?.some((t) => wanted.has(t)))
}
