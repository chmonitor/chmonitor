import { getAllSkills, registerSkill } from '../../skills/dynamic-loader'
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

const load = (input: unknown) =>
  (createSkillTools().load_skill as any).execute(input) as Promise<any>

describe('load_skill execute', () => {
  test('returns the full skill (name, description and content) for a known name', async () => {
    const known = getAllSkills()[0]
    const out = await load({ name: known.name })
    expect(out.name).toBe(known.name)
    expect(out.description).toBe(known.description)
    expect(out.content).toBe(known.content)
    expect(out.content.length).toBeGreaterThan(0)
  })

  test('an unknown name throws and lists every available skill so the model can retry', async () => {
    const promise = load({ name: 'no-such-skill-xyz' })
    await expect(promise).rejects.toThrow('Skill "no-such-skill-xyz" not found')
    const message = await promise.then(
      () => '',
      (e: Error) => e.message
    )
    for (const skill of getAllSkills()) {
      expect(message).toContain(skill.name)
    }
  })

  test('the name match is exact: a near-miss name or surrounding whitespace does not match', async () => {
    const known = getAllSkills()[0].name
    await expect(load({ name: `${known}-x` })).rejects.toThrow('not found')
    await expect(load({ name: ` ${known} ` })).rejects.toThrow('not found')
  })

  test('a skill registered at runtime is loadable and shows up in the next tool description', async () => {
    registerSkill({
      name: 'unit-test-runtime-skill',
      description: 'Runtime skill for tests. Second sentence must not appear.',
      content: 'RUNTIME BODY',
    } as any)
    const out = await load({ name: 'unit-test-runtime-skill' })
    expect(out.content).toBe('RUNTIME BODY')
    const description = (createSkillTools().load_skill as any).description
    expect(description).toContain(
      '- unit-test-runtime-skill: Runtime skill for tests'
    )
    expect(description).not.toContain('Second sentence')
  })
})

describe('load_skill description purposes', () => {
  const descriptionFor = (skillDescription: string) => {
    registerSkill({
      name: 'unit-test-purpose-skill',
      description: skillDescription,
      content: 'x',
    } as any)
    const line = (createSkillTools().load_skill as any).description
      .split('\n')
      .find((l: string) => l.startsWith('- unit-test-purpose-skill:'))
    return line.slice('- unit-test-purpose-skill: '.length) as string
  }

  test('a short first sentence is kept whole, without its period', () => {
    expect(descriptionFor('Tune merges. Then more text.')).toBe('Tune merges')
  })

  test('a long first sentence is cut at a word boundary under 60 chars with an ellipsis', () => {
    const purpose = descriptionFor(
      'Diagnose replication lag, stuck fetches, and keeper session problems across every replica in a cluster'
    )
    expect(purpose.endsWith('…')).toBe(true)
    expect(purpose.length).toBeLessThanOrEqual(61)
    expect(purpose).toBe(
      'Diagnose replication lag, stuck fetches, and keeper session…'
    )
  })
})
