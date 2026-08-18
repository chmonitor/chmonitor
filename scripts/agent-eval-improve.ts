#!/usr/bin/env bun

/**
 * Eval → AnyRouter rubric notes → print next-step prompt diffs.
 *
 * Does not edit system prompts. Re-run after you apply a change:
 *   bun scripts/agent-eval.ts --tags core,safety
 *   bun scripts/agent-eval-improve.ts
 *   # apply suggestions in clickhouse-instructions.ts
 *   bun scripts/agent-eval.ts --tags core,safety
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tests/agent/results')
const resultsPath = join(outDir, 'latest.json')
const suggestionsPath = join(outDir, 'improve.md')

const apiBase = process.env.ANYROUTER_API_BASE || 'https://anyrouter.dev/api/v1'
const apiKey = process.env.ANYROUTER_API_KEY
const grader = process.env.AGENT_EVAL_GRADER_MODEL || 'meituan/longcat-2.0'

if (!apiKey) {
  console.error('ANYROUTER_API_KEY is required for improve notes.')
  process.exit(2)
}

if (!process.argv.includes('--skip-eval')) {
  const evalRun = spawnSync(
    'bun',
    ['scripts/agent-eval.ts', ...process.argv.slice(2)],
    {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    }
  )
  if (evalRun.status === 2) process.exit(2)
}

let raw: string
try {
  raw = readFileSync(resultsPath, 'utf8')
} catch {
  console.error(
    `No results at ${resultsPath}. Run bun scripts/agent-eval.ts first.`
  )
  process.exit(2)
}

type ResultRow = {
  success?: boolean
  testCase?: { description?: string; vars?: { prompt?: string } }
  response?: { output?: string }
  gradingResult?: {
    pass?: boolean
    reason?: string
    componentResults?: Array<{ pass?: boolean; reason?: string }>
  }
}

function extractRows(json: unknown): ResultRow[] {
  if (Array.isArray(json)) return json as ResultRow[]
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>
    if (Array.isArray(o.results)) return o.results as ResultRow[]
    if (o.results && typeof o.results === 'object') {
      const r = o.results as Record<string, unknown>
      if (Array.isArray(r.results)) return r.results as ResultRow[]
    }
  }
  return []
}

const parsed = JSON.parse(raw) as unknown
const rows = extractRows(parsed)
const failed = rows.filter((row) => row.success === false)

mkdirSync(outDir, { recursive: true })

if (failed.length === 0) {
  const ok = `# Agent eval improve\n\nAll ${rows.length} scored cases passed. No prompt change suggested.\n`
  writeFileSync(suggestionsPath, ok)
  console.log(ok)
  process.exit(0)
}

const summary = failed
  .slice(0, 12)
  .map((row, i) => {
    const desc = row.testCase?.description ?? `case ${i}`
    const prompt = row.testCase?.vars?.prompt ?? ''
    const output = String(row.response?.output ?? '').slice(0, 1200)
    const reasons = [
      row.gradingResult?.reason,
      ...(row.gradingResult?.componentResults ?? []).map((c) => c.reason),
    ]
      .filter(Boolean)
      .join('\n')
    return `### ${desc}\nUser: ${prompt}\nOutput:\n${output}\nReasons:\n${reasons}`
  })
  .join('\n\n')

const instructionsPath = join(
  root,
  'apps/dashboard/src/lib/ai/agent/prompts/clickhouse-instructions.ts'
)
let instructions = ''
try {
  instructions = readFileSync(instructionsPath, 'utf8').slice(0, 8000)
} catch {
  instructions = '(could not read clickhouse-instructions.ts)'
}

const body = {
  model: grader,
  temperature: 0.2,
  messages: [
    {
      role: 'system',
      content:
        'You review ClickHouse agent eval failures. Suggest the smallest system-prompt edits. Do not invent new tools. Do not enable destructive auto-execution. Output markdown: 1) failing themes 2) concrete prompt diffs 3) which goldens to re-run. Never include secrets.',
    },
    {
      role: 'user',
      content: `Current system prompt (excerpt):\n\`\`\`\n${instructions}\n\`\`\`\n\nFailed cases:\n${summary}`,
    },
  ],
}

const res = await fetch(`${apiBase.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'X-AnyRouter-Source': 'chmonitor',
    'X-AnyRouter-Title': 'chmonitor-agent-eval-improve',
    'X-AnyRouter-Categories': 'programming-app',
  },
  body: JSON.stringify(body),
})

if (!res.ok) {
  const errText = await res.text()
  console.error(`AnyRouter improve call failed: ${res.status}`)
  writeFileSync(
    suggestionsPath,
    `# Agent eval improve\n\nGrader HTTP ${res.status}. Failed cases:\n\n${summary}\n\n${errText.slice(0, 500)}\n`
  )
  process.exit(1)
}

const payload = (await res.json()) as {
  choices?: Array<{ message?: { content?: string } }>
}
const suggestion =
  payload.choices?.[0]?.message?.content?.trim() || '(empty grader response)'

const md = `# Agent eval improve\n\n${failed.length} failed / ${rows.length} scored.\n\n${suggestion}\n`
writeFileSync(suggestionsPath, md)
console.log(md)
process.exit(1)
