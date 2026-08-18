#!/usr/bin/env bun

/**
 * Write tests/agent/results/pr-comment.md and optionally upsert it on a PR.
 *
 *   bun scripts/agent-eval-comment.ts
 *   bun scripts/agent-eval-comment.ts --skip "ANYROUTER_API_KEY unset"
 *   bun scripts/agent-eval-comment.ts --post   # needs GH_TOKEN + PR number
 */

import {
  formatEvalComment,
  formatSkipComment,
  MARKER,
} from '../tests/agent/format-eval-comment.js'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'tests/agent/results')
const jsonPath = join(outDir, 'latest.json')
const mdPath = join(outDir, 'pr-comment.md')

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

const skip = argValue('--skip')
mkdirSync(outDir, { recursive: true })

let body: string
if (skip) {
  body = formatSkipComment(skip)
} else {
  let json: unknown = {}
  try {
    json = JSON.parse(readFileSync(jsonPath, 'utf8'))
  } catch {
    json = {}
  }
  body = formatEvalComment(json, {
    tags: process.env.AGENT_EVAL_TAGS || '',
    model: process.env.AGENT_EVAL_MODEL || '',
    url: process.env.AGENT_EVAL_URL || '',
  })
}

writeFileSync(mdPath, body)
process.stdout.write(body)
if (!body.endsWith('\n')) process.stdout.write('\n')

if (!process.argv.includes('--post')) {
  process.exit(0)
}

const repo = process.env.GITHUB_REPOSITORY
const pr =
  argValue('--pr') || process.env.AGENT_EVAL_PR || process.env.PR_NUMBER || ''
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN

if (!repo || !pr || !token) {
  console.error(
    '[agent-eval-comment] --post needs GITHUB_REPOSITORY, PR number, and GITHUB_TOKEN'
  )
  process.exit(2)
}

const [owner, name] = repo.split('/')
const list = spawnSync(
  'gh',
  [
    'api',
    `repos/${owner}/${name}/issues/${pr}/comments`,
    '--paginate',
    '--jq',
    '.[] | {id, body}',
  ],
  { encoding: 'utf8', env: process.env }
)

if (list.status !== 0) {
  console.error(list.stderr)
  process.exit(list.status ?? 1)
}

type Comment = { id: number; body: string }
const comments: Comment[] = []
for (const line of list.stdout.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('{')) continue
  try {
    comments.push(JSON.parse(trimmed) as Comment)
  } catch {
    // paginate --jq may emit a JSON array; parse once below
  }
}

let existingId: number | undefined
if (comments.length === 0) {
  try {
    const all = JSON.parse(list.stdout) as Comment[]
    existingId = all.find((c) => c.body?.includes(MARKER))?.id
  } catch {
    existingId = undefined
  }
} else {
  existingId = comments.find((c) => c.body?.includes(MARKER))?.id
}

const tmp = join(outDir, 'pr-comment.body.md')
writeFileSync(tmp, body)

if (existingId) {
  const upd = spawnSync(
    'gh',
    [
      'api',
      '-X',
      'PATCH',
      `repos/${owner}/${name}/issues/comments/${existingId}`,
      '-F',
      `body=@${tmp}`,
    ],
    { encoding: 'utf8', env: process.env }
  )
  if (upd.status !== 0) {
    console.error(upd.stderr)
    process.exit(upd.status ?? 1)
  }
  console.error(`[agent-eval-comment] updated comment ${existingId}`)
} else {
  const create = spawnSync(
    'gh',
    [
      'api',
      '-X',
      'POST',
      `repos/${owner}/${name}/issues/${pr}/comments`,
      '-F',
      `body=@${tmp}`,
    ],
    { encoding: 'utf8', env: process.env }
  )
  if (create.status !== 0) {
    console.error(create.stderr)
    process.exit(create.status ?? 1)
  }
  console.error('[agent-eval-comment] posted new comment')
}
