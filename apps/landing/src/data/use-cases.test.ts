import { useCases } from './use-cases'
import { describe, expect, test } from 'bun:test'

// Roadmap/unwired channel and feature names that must never appear as a
// shipped-feature claim on a use-case page. See use-cases.ts's top comment
// for the audit trail (Telegram/PagerDuty adapters exist as pure formatters
// but are not consumed by the health-sweep dispatch — genuinely unwired).
const DENYLIST = ['telegram', 'pagerduty', 'pager duty', 'opsgenie', 'email']

// Structured copy fields to scan — NOT the raw source file text, which
// legitimately mentions denylisted names in comments/docs.
function copyFields(): string[] {
  return useCases.flatMap((u) => [
    u.title,
    u.description,
    u.eyebrow,
    u.h1,
    u.cardBlurb,
    u.subhead,
    u.heroImageAlt,
    ...u.benefits.flatMap((b) => [b.title, b.body]),
    ...u.featureList,
  ])
}

describe('useCases content invariants', () => {
  test('has at least 4 use cases (plan 64 done criteria)', () => {
    expect(useCases.length).toBeGreaterThanOrEqual(4)
  })

  test('slugs are unique', () => {
    const slugs = useCases.map((u) => u.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  test('titles are unique', () => {
    const titles = useCases.map((u) => u.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  test('descriptions are unique', () => {
    const descriptions = useCases.map((u) => u.description)
    expect(new Set(descriptions).size).toBe(descriptions.length)
  })

  test('h1s are unique', () => {
    const h1s = useCases.map((u) => u.h1)
    expect(new Set(h1s).size).toBe(h1s.length)
  })

  test('never names an unwired channel or roadmap feature', () => {
    const haystack = copyFields().join('\n').toLowerCase()
    for (const term of DENYLIST) {
      expect(haystack).not.toContain(term)
    }
  })

  test('every use case has at least one benefit and one feature-list entry', () => {
    for (const u of useCases) {
      expect(u.benefits.length).toBeGreaterThan(0)
      expect(u.featureList.length).toBeGreaterThan(0)
    }
  })
})
