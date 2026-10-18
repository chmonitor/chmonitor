// Server-only: extends the builtin registry with user skills (.agents/skills) and runtime-registered ones. Client code uses registry.ts.

import type { Skill } from './types'

import { SKILLS } from './registry'
import fs from 'node:fs'
import path from 'node:path'

const runtimeSkills: Map<string, Skill> = new Map()

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
    } catch {}
  }

  return skills
}

// Registered skills override builtin and user skills with the same name.
export function registerSkill(skill: Skill): void {
  runtimeSkills.set(skill.name, { ...skill, source: skill.source ?? 'remote' })
}

// Priority (highest wins): runtime > user > builtin.
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
