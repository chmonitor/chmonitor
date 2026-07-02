#!/usr/bin/env bun

/**
 * Build script: scans .agents/skills/ and generates lib/ai/agent/skills/registry.ts
 *
 * Usage: bun run scripts/build-skills-registry.ts
 */

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

interface SkillEntry {
  name: string
  description: string
  content: string
}

/**
 * Allowlist of ClickHouse-domain skill directories that belong in the
 * monitoring agent bundle. ONLY these dirs under `.agents/skills/` are compiled
 * into `registry.ts`.
 *
 * Why an allowlist: `.agents/skills/` doubles as the target for
 * `npx skills add <pkg>` installs, so it accumulates unrelated third-party
 * skills (hyperframes*, polar-*, seo-audit, pr-to-video, build-agent, etc.).
 * Without this filter, `bun run build:skills` would inject every scanned dir
 * into the agent bundle — the leak CLAUDE.md warns against ("keep dev/product
 * skills out of there so they never leak into the agent bundle").
 *
 * HOW TO MAINTAIN: when you add a legitimate new ClickHouse-domain skill, add
 * its directory name here. Unrelated `npx skills add` installs are intentionally
 * excluded and must NOT be added. Any scanned dir not in this list is skipped
 * and reported via console.warn so drift stays visible.
 */
const DOMAIN_SKILLS: readonly string[] = [
  'replication-guide',
  'incident-response',
  'anomaly-detection',
  'plan-and-verify',
  'query-optimization',
  'version-upgrade-advisor',
  'cluster-operations',
  'troubleshooting',
  'hardware-tuning',
  'concept-explainer',
  'query-tuning-advisor',
  'security-hardening',
  'schema-design-advisor',
  'migration-patterns',
  'data-analysis',
  'system-tables-reference',
  'storage-optimization',
  'clickhouse-best-practices',
]

function parseFrontmatter(raw: string): {
  name: string
  description: string
  body: string
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/)
  if (!match) throw new Error('No frontmatter found')

  const frontmatter = match[1]
  const body = match[2].trim()

  // Simple YAML parsing for name and description
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

  if (!nameMatch) throw new Error('Missing "name" in frontmatter')
  if (!descMatch) throw new Error('Missing "description" in frontmatter')

  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim().replace(/^["']|["']$/g, ''),
    body,
  }
}

async function main() {
  const skillsDir = join(process.cwd(), '.agents', 'skills')
  const outputFile = join(
    process.cwd(),
    'apps',
    'dashboard',
    'src',
    'lib',
    'ai',
    'agent',
    'skills',
    'registry.ts'
  )

  const skills: SkillEntry[] = []

  let dirNames: string[]
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true })
    dirNames = entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    console.log('No .agents/skills/ directory found, generating empty registry')
    dirNames = []
  }

  // Filter scanned dirs down to the domain allowlist. Anything else (e.g.
  // `npx skills add` installs) is intentionally excluded so it can't leak into
  // the agent bundle. Report skipped dirs so drift is visible.
  const allowed = new Set(DOMAIN_SKILLS)
  const skipped = dirNames.filter((d) => !allowed.has(d)).sort()
  if (skipped.length > 0) {
    console.warn(
      `  Skipping ${skipped.length} non-domain skill dir(s) not in the allowlist ` +
        `(not compiled into registry.ts): ${skipped.join(', ')}`
    )
  }
  const missing = DOMAIN_SKILLS.filter((d) => !dirNames.includes(d))
  if (missing.length > 0) {
    console.warn(
      `  Allowlisted skill dir(s) not found under .agents/skills/: ${missing.join(', ')}`
    )
  }
  dirNames = dirNames.filter((d) => allowed.has(d))

  for (const dirName of dirNames) {
    const skillFile = join(skillsDir, dirName, 'SKILL.md')
    try {
      const raw = await readFile(skillFile, 'utf-8')
      const { name, description, body } = parseFrontmatter(raw)
      skills.push({ name, description, content: body })
      console.log(`  Found skill: ${name}`)
    } catch (err) {
      console.warn(`  Skipping ${dirName}: ${err}`)
    }
  }

  // Generate registry.ts
  const escapeForTemplate = (s: string) =>
    s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$')

  const skillEntries = skills
    .map(
      (s) => `  {
    name: '${s.name}',
    description: '${escapeForTemplate(s.description)}',
    content: \`${escapeForTemplate(s.content)}\`,
  }`
    )
    .join(',\n')

  const output = `/**
 * Auto-generated skills registry.
 * Run \`bun run build:skills\` to regenerate from .agents/skills/
 *
 * DO NOT EDIT MANUALLY
 */

import type { Skill } from './types'

export const SKILLS: readonly Skill[] = [
${skillEntries}
]

/** Get all available skills metadata (without content) */
export function getSkillsMetadata(): ReadonlyArray<{
  name: string
  description: string
}> {
  return SKILLS.map(({ name, description }) => ({
    name,
    description,
  }))
}

/** Load a skill by name, returns null if not found */
export function loadSkillContent(name: string): Skill | null {
  return SKILLS.find((s) => s.name === name) ?? null
}
`

  await writeFile(outputFile, output, 'utf-8')
  console.log(`\nGenerated ${outputFile} with ${skills.length} skill(s)`)
}

main().catch((err) => {
  console.error('Failed to build skills registry:', err)
  process.exit(1)
})
