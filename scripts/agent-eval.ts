#!/usr/bin/env bun
/**
 * Run the live agent promptfoo suite.
 *
 * Defaults:
 *   AGENT_EVAL_URL=http://localhost:3000/api/v1/agent
 *   AGENT_EVAL_MODEL=anyrouter:meituan/longcat-2.0
 *   AGENT_EVAL_GRADER_MODEL=meituan/longcat-2.0
 *   ANYROUTER_API_BASE=https://anyrouter.dev/api/v1
 *
 * Tags: --tags core,safety  (default)   --tags all
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { formatScoreboard, summarize } from '../tests/agent/format-eval-comment.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tests/agent/results')
const generated = join(root, 'tests/agent/promptfooconfig.generated.yaml')

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function loadEnvFile(path: string) {
  if (!existsSync(path)) return
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(join(root, 'apps/dashboard/.env.local'))
loadEnvFile(join(root, '.env.local'))

const defaults = {
  AGENT_EVAL_URL:
    process.env.AGENT_EVAL_URL || 'http://localhost:3000/api/v1/agent',
  AGENT_EVAL_MODEL:
    process.env.AGENT_EVAL_MODEL || 'anyrouter:meituan/longcat-2.0',
  AGENT_EVAL_GRADER_MODEL:
    process.env.AGENT_EVAL_GRADER_MODEL || 'meituan/longcat-2.0',
  ANYROUTER_API_BASE:
    process.env.ANYROUTER_API_BASE || 'https://anyrouter.dev/api/v1',
  AGENT_API_TOKEN: process.env.AGENT_API_TOKEN || '',
  ANYROUTER_API_KEY: process.env.ANYROUTER_API_KEY || '',
}

if (!defaults.ANYROUTER_API_KEY) {
  console.error(
    'ANYROUTER_API_KEY is required (agent + llm-rubric grader).'
  )
  process.exit(2)
}

const tagsArg = argValue('--tags')
const useAll = tagsArg === 'all' || tagsArg === '*'
const configSrc = join(
  root,
  useAll
    ? 'tests/agent/promptfooconfig.all.yaml'
    : 'tests/agent/promptfooconfig.yaml'
)

mkdirSync(outDir, { recursive: true })

let yaml = readFileSync(configSrc, 'utf8')
for (const [key, value] of Object.entries(defaults)) {
  yaml = yaml.split(`\${${key}}`).join(value)
}
if (!defaults.AGENT_API_TOKEN) {
  yaml = yaml.replace(/^\s*Authorization:.*\n/m, '')
}
writeFileSync(generated, yaml)

const extra = process.argv
  .slice(2)
  .filter((a, i, arr) => a !== '--tags' && arr[i - 1] !== '--tags' && a !== '--json')

const jsonOut = join(outDir, 'latest.json')
const promptfooArgs = [
  'promptfoo',
  'eval',
  '-c',
  generated,
  '--no-cache',
  '--max-concurrency',
  '1',
  '--output',
  jsonOut,
  ...extra,
]

console.log(
  `[agent-eval] url=${defaults.AGENT_EVAL_URL} model=${defaults.AGENT_EVAL_MODEL} suite=${useAll ? 'all' : 'core,safety'}`
)

const result = spawnSync('bunx', promptfooArgs, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...defaults,
  },
})

let summaryLine = ''
try {
  const json = JSON.parse(readFileSync(jsonOut, 'utf8')) as unknown
  const summary = summarize(json)
  const board = formatScoreboard(summary)
  writeFileSync(join(outDir, 'scoreboard.md'), `${board}\n`)
  summaryLine = `\n${board}\n`
  console.log(summaryLine)
} catch {
  console.log('\n[agent-eval] no scoreboard — latest.json missing or invalid\n')
}

process.exit(result.status ?? 1)
