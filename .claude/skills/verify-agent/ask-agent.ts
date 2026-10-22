#!/usr/bin/env bun
/**
 * Ask the live agent one question-bank case and check which tools it called.
 *
 *   bun .claude/skills/verify-agent/ask-agent.ts "Question — disk free space"
 *   bun .claude/skills/verify-agent/ask-agent.ts --prompt "free text" --expect get_disk_usage,query
 *
 * Env: AGENT_EVAL_URL (default http://localhost:3000/api/v1/agent),
 * AGENT_API_TOKEN (optional Bearer), AGENT_EVAL_MODEL (optional).
 * Writes request.json, response.sse, parsed.txt, verdict.json under
 * tests/agent/results/verify-agent/<timestamp>/ (gitignored, never cleaned up).
 * Exit 0 = an accepted tool was called; 1 = it was not; 2 = HTTP/infra failure.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const { parseAgentSse } = require(join(root, 'tests/agent/parse-agent-sse.js'))

type Case = {
  description: string
  vars: { prompt: string }
  metadata?: { covers?: string[]; skills?: string[] }
  assert?: { value?: unknown; config?: { tools?: string[] } }[]
}

const args = process.argv.slice(2)
let prompt: string
let accepted: string[]
let label: string
if (args[0] === '--prompt') {
  prompt = args[1] ?? ''
  const i = args.indexOf('--expect')
  accepted = i >= 0 ? (args[i + 1] ?? '').split(',').filter(Boolean) : []
  label = 'adhoc'
} else {
  const bank = Bun.YAML.parse(
    readFileSync(join(root, 'tests/agent/cases/questions.yaml'), 'utf8')
  ) as Case[]
  const c = bank.find((x) => x.description === args[0])
  if (!c) {
    console.error(`no bank case named ${JSON.stringify(args[0])}. Cases:`)
    for (const x of bank) console.error(`  ${x.description}`)
    process.exit(2)
  }
  prompt = c.vars.prompt
  accepted =
    c.assert?.find((a) => String(a.value).endsWith(':toolCalled'))?.config
      ?.tools ?? []
  label = c.description
}

const url = process.env.AGENT_EVAL_URL ?? 'http://localhost:3000/api/v1/agent'
const body = {
  message: prompt,
  messages: [{ role: 'user', parts: [{ type: 'text', text: prompt }] }],
  hostId: 0,
  ...(process.env.AGENT_EVAL_MODEL && { model: process.env.AGENT_EVAL_MODEL }),
}
const dir = join(
  root,
  'tests/agent/results/verify-agent',
  new Date().toISOString().replace(/[:.]/g, '-')
)
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'request.json'), JSON.stringify({ url, label, body }, null, 2))

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    ...(process.env.AGENT_API_TOKEN && {
      Authorization: `Bearer ${process.env.AGENT_API_TOKEN}`,
    }),
  },
  body: JSON.stringify(body),
})
const raw = await res.text()
writeFileSync(join(dir, 'response.sse'), raw)
const parsed = String(parseAgentSse(raw))
writeFileSync(join(dir, 'parsed.txt'), parsed)

const called = [...parsed.matchAll(/\[tool:([a-z0-9_]+)\]/g)].map((m) => m[1])
const toolErrors = [...parsed.matchAll(/\[tool-error:[^\]]*\]/g)].map((m) => m[0])
const hit = called.filter((t) => accepted.includes(t))
const verdict = {
  label,
  status: res.status,
  accepted,
  called,
  toolErrors,
  pass: res.ok && (accepted.length === 0 || hit.length > 0),
}
writeFileSync(join(dir, 'verdict.json'), JSON.stringify(verdict, null, 2))
console.log(JSON.stringify(verdict, null, 2))
console.log(`evidence: ${dir}`)
process.exit(!res.ok ? 2 : verdict.pass ? 0 : 1)
