import { createReferenceQueryTools } from '../reference-query-tools'
import { describe, expect, test } from 'bun:test'

const { find_reference_query } = createReferenceQueryTools()

async function run(query: string, limit?: number) {
  return (await find_reference_query.execute?.(
    { query, ...(limit ? { limit } : {}) },
    {} as never
  )) as {
    type: string
    matchCount: number
    matches: { name: string; description: string; sql: string }[]
    note?: string
  }
}

describe('find_reference_query', () => {
  test('returns ranked matches from the built-in catalog for a real topic', async () => {
    const res = await run('slow queries')
    expect(res.type).toBe('reference_queries')
    expect(res.matchCount).toBeGreaterThan(0)
    // Every match carries name + SQL so the agent can adapt it.
    for (const m of res.matches) {
      expect(m.name.length).toBeGreaterThan(0)
      expect(typeof m.sql).toBe('string')
    }
  })

  test('respects the limit', async () => {
    const res = await run('query', 2)
    expect(res.matches.length).toBeLessThanOrEqual(2)
  })

  test('returns an empty match set with guidance for gibberish', async () => {
    const res = await run('zzzqqxnomatchtoken')
    expect(res.matchCount).toBe(0)
    expect(res.note).toBeDefined()
  })
})
