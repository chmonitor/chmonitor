/**
 * Server-only dynamic skill loader.
 *
 * Extends the builtin registry with:
 * - User skills loaded from `.agents/skills/` at runtime (source: 'user')
 * - Runtime-registered skills added via registerSkill() (source: 'remote')
 *
 * Import this module only from server-side code (API routes, agent tools).
 * Client components should use registry.ts directly.
 */

import type { Skill } from './types'

import { SKILLS } from './registry'
import fs from 'node:fs'
import path from 'node:path'

/** In-memory store for skills registered at runtime (e.g. via POST /api/v1/agent/skills) */
const runtimeSkills: Map<string, Skill> = new Map()

/**
 * Parse name, description, and body from a SKILL.md file.
 * Matches the pattern used in scripts/build-skills-registry.ts.
 */
export function parseFrontmatter(raw: string): {
  name: string
  description: string
  body: string
} | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/)
  if (!match) return null

  const frontmatter = match[1]
  const body = match[2].trim()

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

  if (!nameMatch || !descMatch) return null

  return {
    name: nameMatch[1].trim().replace(/^["']|["']$/g, ''),
    description: descMatch[1].trim().replace(/^["']|["']$/g, ''),
    body,
  }
}

/**
 * Load skills from `.agents/skills/` at runtime.
 * Each skill lives in its own directory containing a `SKILL.md` file.
 * Returns skills tagged with source: 'user'.
 */
export function loadDynamicSkills(): Skill[] {
  const skillsDir = path.join(process.cwd(), '.agents', 'skills')
  const skills: Skill[] = []

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const skillFile = path.join(skillsDir, entry.name, 'SKILL.md')

    try {
      const raw = fs.readFileSync(skillFile, 'utf-8')
      const parsed = parseFrontmatter(raw)
      if (!parsed) continue

      skills.push({
        name: parsed.name,
        description: parsed.description,
        content: parsed.body,
        source: 'user',
      })
    } catch {
      // Skip unreadable or malformed skill files
    }
  }

  return skills
}

/**
 * Register a skill at runtime (e.g. via POST /api/v1/agent/skills).
 * Registered skills override builtin and user skills with the same name.
 */
export function registerSkill(skill: Skill): void {
  runtimeSkills.set(skill.name, { ...skill, source: skill.source ?? 'remote' })
}

/**
 * Return all available skills: builtin + user (filesystem) + runtime-registered.
 * Priority (highest wins): runtime > user > builtin.
 */
export function getAllSkills(): Skill[] {
  const merged = new Map<string, Skill>(
    SKILLS.map((s: Skill) => [s.name, { ...s, source: 'builtin' as const }])
  )

  // Filesystem skills may include unrelated dirs (video, billing). Only
  // override builtin names — do not surface unregistered skill folders.
  const allow = new Set(SKILLS.map((s: Skill) => s.name))
  for (const skill of loadDynamicSkills()) {
    if (!allow.has(skill.name)) continue
    merged.set(skill.name, skill)
  }

  for (const [name, skill] of runtimeSkills) {
    merged.set(name, skill)
  }

  return Array.from(merged.values())
}
