import { fetchGitHubStats, formatCount } from './github-stars'
import { afterEach, describe, expect, test } from 'bun:test'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('formatCount', () => {
  test('returns empty string for null (never a fabricated number)', () => {
    expect(formatCount(null)).toBe('')
  })

  test('passes small counts through verbatim', () => {
    expect(formatCount(0)).toBe('0')
    expect(formatCount(42)).toBe('42')
    expect(formatCount(999)).toBe('999')
  })

  test('abbreviates thousands', () => {
    expect(formatCount(1000)).toBe('1.0k')
    expect(formatCount(1234)).toBe('1.2k')
  })
})

describe('fetchGitHubStats fail-open', () => {
  test('returns null counts when the API throws (offline build)', async () => {
    globalThis.fetch = () => Promise.reject(new Error('offline'))
    expect(await fetchGitHubStats('chmonitor/chmonitor')).toEqual({
      stars: null,
      forks: null,
      updated: null,
    })
  })

  test('returns null counts on a non-200 response (rate limited)', async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response('rate limited', { status: 403 }))
    expect(await fetchGitHubStats('chmonitor/chmonitor')).toEqual({
      stars: null,
      forks: null,
      updated: null,
    })
  })

  test('parses counts on success', async () => {
    globalThis.fetch = () =>
      Promise.resolve(
        Response.json({
          stargazers_count: 1234,
          forks_count: 56,
          pushed_at: '2026-07-01T00:00:00Z',
        })
      )
    const stats = await fetchGitHubStats('chmonitor/chmonitor')
    expect(stats.stars).toBe(1234)
    expect(stats.forks).toBe(56)
    expect(stats.updated).toBeTypeOf('string')
  })

  test('ignores non-numeric fields rather than trusting them', async () => {
    globalThis.fetch = () =>
      Promise.resolve(Response.json({ stargazers_count: 'lots' }))
    expect((await fetchGitHubStats('chmonitor/chmonitor')).stars).toBeNull()
  })
})
