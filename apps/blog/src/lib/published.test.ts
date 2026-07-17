import { isPublished } from './published'
import { describe, expect, test } from 'bun:test'

// Minimal stand-in for a blog collection entry's `data` — only the two
// fields `isPublished` reads.
function post(overrides: { draft?: boolean; date: Date }) {
  return {
    draft: overrides.draft ?? false,
    date: overrides.date,
  } as Parameters<typeof isPublished>[0]
}

describe('isPublished', () => {
  test('rejects a future-dated post even when draft is unset (#2697)', () => {
    const oneYearFromNow = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    expect(isPublished(post({ date: oneYearFromNow }))).toBe(false)
  })

  test('accepts a past-dated, non-draft post', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(isPublished(post({ date: yesterday }))).toBe(true)
  })

  test('accepts a post dated today', () => {
    expect(isPublished(post({ date: new Date() }))).toBe(true)
  })

  test('rejects a draft post regardless of date', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    expect(isPublished(post({ draft: true, date: yesterday }))).toBe(false)
  })
})
