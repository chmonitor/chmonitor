import { createAskUserTools } from '../ask-user-tools'
import { describe, expect, test } from 'bun:test'

type Parsed = { success: boolean; error?: { issues: { message: string }[] } }
type AskUserTool = {
  description: string
  inputSchema: { safeParse: (v: unknown) => Parsed }
  execute: (input: unknown) => Promise<Record<string, unknown>>
}

const tool = (createAskUserTools() as unknown as { ask_user: AskUserTool })
  .ask_user

const parse = (v: unknown) => tool.inputSchema.safeParse(v)
const valid = { question: 'Which database?', inputType: 'single_choice' }
const opt = (i: number) => ({ label: `L${i}`, value: `v${i}` })

describe('createAskUserTools', () => {
  test('exposes only ask_user and documents every input type', () => {
    expect(Object.keys(createAskUserTools())).toEqual(['ask_user'])
    for (const t of [
      'single_choice',
      'multi_choice',
      'confirm',
      'free_text',
      'rating',
    ]) {
      expect(tool.description).toContain(t)
    }
  })
})

describe('ask_user input validation', () => {
  test('accepts a minimal question', () => {
    expect(parse(valid).success).toBe(true)
  })

  test('rejects an empty question and one over 200 chars', () => {
    expect(parse({ ...valid, question: '' }).success).toBe(false)
    expect(parse({ ...valid, question: 'x'.repeat(200) }).success).toBe(true)
    expect(parse({ ...valid, question: 'x'.repeat(201) }).success).toBe(false)
  })

  test('rejects an unknown inputType', () => {
    expect(parse({ ...valid, inputType: 'dropdown' }).success).toBe(false)
  })

  test('caps options at 20', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => opt(i))
    expect(parse({ ...valid, options: twenty }).success).toBe(true)
    expect(parse({ ...valid, options: [...twenty, opt(20)] }).success).toBe(
      false
    )
  })

  test('rejects options with empty or oversized label/value/description', () => {
    expect(
      parse({ ...valid, options: [{ label: '', value: 'a' }] }).success
    ).toBe(false)
    expect(
      parse({ ...valid, options: [{ label: 'a', value: '' }] }).success
    ).toBe(false)
    expect(
      parse({ ...valid, options: [{ label: 'x'.repeat(81), value: 'a' }] })
        .success
    ).toBe(false)
    expect(
      parse({ ...valid, options: [{ label: 'a', value: 'x'.repeat(121) }] })
        .success
    ).toBe(false)
    expect(
      parse({
        ...valid,
        options: [{ label: 'a', value: 'a', description: 'x'.repeat(201) }],
      }).success
    ).toBe(false)
  })

  test('rejects oversized placeholder and context', () => {
    expect(parse({ ...valid, placeholder: 'x'.repeat(201) }).success).toBe(
      false
    )
    expect(parse({ ...valid, context: 'x'.repeat(201) }).success).toBe(false)
  })

  test('min/max must be integers within 1..10', () => {
    expect(parse({ ...valid, min: 0 }).success).toBe(false)
    expect(parse({ ...valid, max: 11 }).success).toBe(false)
    expect(parse({ ...valid, min: 1.5 }).success).toBe(false)
    expect(parse({ ...valid, min: 1, max: 10 }).success).toBe(true)
  })

  test('rejects max below min with a clear message', () => {
    const r = parse({ ...valid, inputType: 'rating', min: 5, max: 3 })
    expect(r.success).toBe(false)
    expect(r.error?.issues.map((i) => i.message)).toContain(
      'Maximum rating value must be greater than or equal to minimum rating value'
    )
  })

  test('allows max equal to min, and a lone min or max', () => {
    expect(parse({ ...valid, min: 4, max: 4 }).success).toBe(true)
    expect(parse({ ...valid, min: 9 }).success).toBe(true)
    expect(parse({ ...valid, max: 2 }).success).toBe(true)
  })
})

describe('ask_user execute', () => {
  test('returns the structured question awaiting a response, with defaults', async () => {
    const out = await tool.execute({ ...valid })
    expect(out).toEqual({
      type: 'ask_user',
      question: 'Which database?',
      inputType: 'single_choice',
      options: undefined,
      placeholder: undefined,
      min: 1,
      max: 5,
      context: undefined,
      awaiting_response: true,
    })
  })

  test('passes every provided field through unchanged', async () => {
    const options = [{ label: 'A', value: 'a', description: 'first' }]
    const out = await tool.execute({
      question: 'Rate it',
      inputType: 'rating',
      options,
      placeholder: 'type here',
      min: 2,
      max: 9,
      context: 'ctx',
    })
    expect(out).toMatchObject({
      type: 'ask_user',
      question: 'Rate it',
      inputType: 'rating',
      options,
      placeholder: 'type here',
      min: 2,
      max: 9,
      context: 'ctx',
      awaiting_response: true,
    })
  })

  test('defaults each bound independently', async () => {
    expect(await tool.execute({ ...valid, min: 3 })).toMatchObject({
      min: 3,
      max: 5,
    })
    expect(await tool.execute({ ...valid, max: 7 })).toMatchObject({
      min: 1,
      max: 7,
    })
  })
})
