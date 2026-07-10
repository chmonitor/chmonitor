/**
 * Unit tests for the `pageContext` request-body hint (issue #2457): grounding
 * an ambiguous chat message in the dashboard page it was sent from ("the user
 * is currently viewing the Merges page"), without perturbing the byte-stable
 * cached system prompt (`AGENT_JSON_RENDER_INLINE_PROMPT`).
 *
 * Exercises the two pure helpers exported from `./agent` — `sanitizePageContext`
 * (validates/clamps the client-supplied hint; missing/malformed input must
 * behave exactly like a request that omits `pageContext` entirely) and
 * `buildPageContextLine` (the short synthetic line threaded ahead of the
 * user's turn as its own message, per `docs/content/guide/ai-agent.mdx`).
 *
 * `cloudflare:workers` is stubbed because `./agent` imports `env` from it at
 * module top — same convention as `routes/api/v1/advisor.test.ts` and
 * `routes/api/v1/__tests__/actions.test.ts`.
 */

import { describe, expect, mock, test } from 'bun:test'

mock.module('cloudflare:workers', () => ({ env: {} }))

import { buildPageContextLine, sanitizePageContext } from './agent'

describe('sanitizePageContext', () => {
  test('returns undefined when pageContext is omitted', () => {
    expect(sanitizePageContext(undefined)).toBeUndefined()
  })

  test('returns undefined for malformed input (not an object)', () => {
    expect(sanitizePageContext('nope' as any)).toBeUndefined()
    expect(sanitizePageContext(null as any)).toBeUndefined()
  })

  test('returns undefined when route is missing or not a string', () => {
    expect(sanitizePageContext({ label: 'Merges' } as any)).toBeUndefined()
    expect(
      sanitizePageContext({ route: 42, label: 'Merges' } as any)
    ).toBeUndefined()
  })

  test('returns undefined when route is blank/whitespace-only', () => {
    expect(sanitizePageContext({ route: '   ' })).toBeUndefined()
  })

  test('accepts a valid route with no label', () => {
    expect(sanitizePageContext({ route: '/merges' })).toEqual({
      route: '/merges',
    })
  })

  test('accepts a valid route + label pair', () => {
    expect(sanitizePageContext({ route: '/merges', label: 'Merges' })).toEqual({
      route: '/merges',
      label: 'Merges',
    })
  })

  test('drops a non-string label but keeps the route', () => {
    expect(
      sanitizePageContext({ route: '/merges', label: 123 as any })
    ).toEqual({ route: '/merges' })
  })

  test('drops a blank label but keeps the route', () => {
    expect(sanitizePageContext({ route: '/merges', label: '   ' })).toEqual({
      route: '/merges',
    })
  })

  test('clamps an oversized route/label instead of rejecting the request', () => {
    const hugeRoute = `/${'a'.repeat(5_000)}`
    const hugeLabel = 'b'.repeat(5_000)
    const result = sanitizePageContext({ route: hugeRoute, label: hugeLabel })
    expect(result).toBeDefined()
    expect(result?.route.length).toBeLessThan(hugeRoute.length)
    expect(result?.label?.length).toBeLessThan(hugeLabel.length)
  })
})

describe('buildPageContextLine', () => {
  test('prefers the label over the raw route', () => {
    const line = buildPageContextLine({ route: '/merges', label: 'Merges' }, 0)
    expect(line).toContain('"Merges"')
    expect(line).toContain('host 0')
  })

  test('falls back to the route when there is no label', () => {
    const line = buildPageContextLine({ route: '/merges' }, 2)
    expect(line).toContain('"/merges"')
    expect(line).toContain('host 2')
  })
})
