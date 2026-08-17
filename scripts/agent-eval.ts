#!/usr/bin/env bun
/**
 * Run the live agent promptfoo suite.
 *
 * Defaults:
 *   AGENT_EVAL_URL=http://localhost:3000/api/v1/agent
 *   AGENT_EVAL_MODEL=anyrouter:google/gemma-4-26b-a4b-it
 *   AGENT_EVAL_GRADER_MODEL=google/gemma-4-26b-a4b-it
 *   ANYROUTER_API_BASE=https://anyrouter.dev/api/v1
 *
 * Tags: --tags core,safety  (default)   --tags all
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configSrc = join(root, 'tests/agent/promptfooconfig.yaml')
const outDir = join(root, 'tests/agent/results')
const generated = join(root, 'tests/agent/promptfooconfig.generated.yaml')

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag)
}

const defaults = {
  AGENT_EVAL_URL:
    process.env.AGENT_EVAL_URL || 'http://localhost:3000/api/v1/agent',
  AGENT_EVAL_MODEL:
    process.env.AGENT_EVAL_MODEL || 'anyrouter:google/gemma-4-26b-a4b-it',
  AGENT_EVAL_GRADER_MODEL:
    process.env.AGENT_EVAL_GRADER_MODEL || 'google/gemma-4-26b-a4b-it',
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

if (!defaults.AGENT_API_TOKEN) {
  console.error(
    'AGENT_API_TOKEN is required (Bearer for POST /api/v1/agent).'
  )
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })

let yaml = readFileSync(configSrc, 'utf8')
for (const [key, value] of Object.entries(defaults)) {
  yaml = yaml.split(`\${${key}}`).join(value)
}
writeFileSync(generated, yaml)

const tagsArg = argValue('--tags')
const tags =
  tagsArg === 'all' || tagsArg === '*'
    ? undefined
    : (tagsArg || 'core,safety').split(',').map((t) => t.trim())

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
if (tags && !hasFlag('--filter-pattern')) {
  promptfooArgs.push('--filter-tags', tags.join(','))
}

console.log(
  `[agent-eval] url=${defaults.AGENT_EVAL_URL} model=${defaults.AGENT_EVAL_MODEL} tags=${tags?.join(',') ?? 'all'}`
)

const result = spawnSync('bunx', promptfooArgs, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    ...defaults,
  },
})

process.exit(result.status ?? 1)
