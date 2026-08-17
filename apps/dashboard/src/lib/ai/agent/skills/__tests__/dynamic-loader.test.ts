/**
 * Tests for the dynamic skill loader.
 *
 * Focuses on the deterministic, high-risk logic:
 *  - parseFrontmatter(): a broken parser silently drops user skills, so each
 *    null-returning branch and the quote-stripping are asserted.
 *  - registerSkill()/getAllSkills(): runtime skills must override builtin skills
 *    of the same name (priority: runtime > user > builtin).
 *
 * loadDynamicSkills() reads the real filesystem (process.cwd()/.agents/skills),
 * so it is exercised only indirectly via parseFrontmatter; we avoid a global
 * node:fs mock that would leak across bun's shared test process.
 */

import {
  getAllSkills,
  parseFrontmatter,
  registerSkill,
} from '../dynamic-loader'
import { SKILLS } from '../registry'
import { describe, expect, test } from 'bun:test'

describe('parseFrontmatter', () => {
  test('parses name, description, and body from valid frontmatter', () => {
    const parsed = parseFrontmatter(
      '---\nname: my-skill\ndescription: does a thing\n---\nbody text here'
    )
    expect(parsed).toEqual({
      name: 'my-skill',
      description: 'does a thing',
      body: 'body text here',
    })
  })

  test('returns null when there is no frontmatter block', () => {
    expect(parseFrontmatter('just some text, no dashes')).toBeNull()
  })

  test('returns null when name is missing', () => {
    expect(
      parseFrontmatter('---\ndescription: only a description\n---\nbody')
    ).toBeNull()
  })

  test('returns null when description is missing', () => {
    expect(parseFrontmatter('---\nname: only-a-name\n---\nbody')).toBeNull()
  })

  test('strips surrounding single and double quotes from values', () => {
    const parsed = parseFrontmatter(
      `---\nname: "quoted-name"\ndescription: 'quoted desc'\n---\nbody`
    )
    expect(parsed?.name).toBe('quoted-name')
    expect(parsed?.description).toBe('quoted desc')
  })

  test('handles CRLF line endings', () => {
    const parsed = parseFrontmatter(
      '---\r\nname: crlf-skill\r\ndescription: windows\r\n---\r\nbody'
    )
    expect(parsed?.name).toBe('crlf-skill')
    expect(parsed?.body).toBe('body')
  })
})

describe('registerSkill / getAllSkills priority', () => {
  test('a runtime-registered skill appears in getAllSkills tagged remote', () => {
    const unique = `test-skill-${'x'.repeat(3)}-unique`
    registerSkill({
      name: unique,
      description: 'a runtime skill',
      content: 'runtime body',
    })

    const found = getAllSkills().find((s) => s.name === unique)
    expect(found).toBeDefined()
    expect(found?.source).toBe('remote')
    expect(found?.content).toBe('runtime body')
  })

  test('filesystem skills not in the builtin registry are not exposed', () => {
    const builtin = new Set(SKILLS.map((s) => s.name))
    const names = getAllSkills()
      .filter((s) => s.source !== 'remote')
      .map((s) => s.name)
    for (const name of names) {
      expect(builtin.has(name)).toBe(true)
    }
    expect(names).not.toContain('hyperframes')
    expect(names).not.toContain('seo-audit')
  })

  test('a runtime skill overrides a builtin skill of the same name', () => {
    registerSkill({
      name: 'replication-guide', // an existing builtin skill name
      description: 'overridden at runtime',
      content: 'override body',
      source: 'remote',
    })

    const matches = getAllSkills().filter((s) => s.name === 'replication-guide')
    // Merged by name — exactly one entry, and it is the runtime override.
    expect(matches).toHaveLength(1)
    expect(matches[0].description).toBe('overridden at runtime')
    expect(matches[0].source).toBe('remote')
  })
})
