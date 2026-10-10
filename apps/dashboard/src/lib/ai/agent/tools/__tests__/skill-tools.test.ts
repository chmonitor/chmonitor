import { getAllSkills } from '../../skills/dynamic-loader'
import { createSkillTools } from '../skill-tools'
import { describe, expect, test } from 'bun:test'

describe('load_skill description', () => {
  const description = (createSkillTools().load_skill as { description: string })
    .description

  test('lists every skill by name so the model can pick one', () => {
    for (const skill of getAllSkills()) {
      expect(description).toContain(`- ${skill.name}:`)
    }
  })

  test('stays short: one-line purposes, not full skill descriptions', () => {
    expect(description.length).toBeLessThan(2000)
    for (const skill of getAllSkills()) {
      expect(description).not.toContain(skill.description)
    }
  })
})
