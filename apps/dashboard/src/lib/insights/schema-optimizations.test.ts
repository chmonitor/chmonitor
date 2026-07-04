/**
 * Tests for the pure schema-optimization mapper.
 *
 * No ClickHouse / advisor I/O — the mapper is fed synthetic advisor results so
 * its ranking, de-dup, filtering, and (crucially) stable-key determinism are
 * asserted directly. The `metric` + `title` must depend only on kind/table/title
 * (never on run-to-run impact numbers) or a dismissed suggestion resurrects on
 * the next cron sweep; the determinism test below guards exactly that.
 */

import type { Recommendation } from '@/lib/ai/advisor/types'

import {
  MAX_SCHEMA_OPTIMIZATIONS,
  metricSlug,
  schemaOptMetric,
  selectSchemaOptimizations,
} from './schema-optimizations'
import { describe, expect, test } from 'bun:test'

function rec(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    kind: 'skip_index',
    title: 'Add a skip index on `user_id`',
    rationale: '`user_id` is filtered but not in the sorting key.',
    ddl: 'ALTER TABLE default.events ADD INDEX ...',
    risk: 'low',
    riskNote: 'additive',
    effort: 'low',
    estImpact: {
      granulesSaved: 100,
      granulesRead: 200,
      bytesSaved: 1000,
      summary: 'Estimated ~100 granules saved.',
      unknown: false,
    },
    ...overrides,
  }
}

describe('metricSlug', () => {
  test('lowercases, collapses non-alphanumerics, trims', () => {
    expect(metricSlug('Add a skip index on `user_id`')).toBe(
      'add_a_skip_index_on_user_id'
    )
  })

  test('is stable for the same input', () => {
    const title = 'Add a projection ordered by day, region'
    expect(metricSlug(title)).toBe(metricSlug(title))
  })
})

describe('selectSchemaOptimizations', () => {
  test('drops recommendations with an unknown estimate', () => {
    const out = selectSchemaOptimizations([
      {
        database: 'default',
        table: 'events',
        recommendations: [
          rec({ estImpact: { ...rec().estImpact, unknown: true } }),
        ],
      },
    ])
    expect(out).toHaveLength(0)
  })

  test('maps a known recommendation to an info optimization candidate', () => {
    const [candidate] = selectSchemaOptimizations([
      { database: 'default', table: 'events', recommendations: [rec()] },
    ])
    expect(candidate.severity).toBe('info')
    expect(candidate.category).toBe('optimization')
    expect(candidate.title).toBe(
      'Add a skip index on `user_id` on default.events'
    )
    expect(candidate.action?.prompt).toContain('default.events')
    expect(candidate.metric).toBe(schemaOptMetric('default', 'events', rec()))
  })

  test('metric is distinct per kind/table so collectInsights dedup keeps all', () => {
    const skip = rec()
    const projection = rec({
      kind: 'projection',
      title: 'Add a projection ordered by day',
    })
    const out = selectSchemaOptimizations([
      {
        database: 'default',
        table: 'events',
        recommendations: [skip, projection],
      },
    ])
    expect(out).toHaveLength(2)
    expect(new Set(out.map((c) => c.metric)).size).toBe(2)
  })

  test('de-duplicates the same suggestion seen across two sampled queries', () => {
    const out = selectSchemaOptimizations([
      { database: 'default', table: 'events', recommendations: [rec()] },
      { database: 'default', table: 'events', recommendations: [rec()] },
    ])
    expect(out).toHaveLength(1)
  })

  test('ranks by estimated granules saved and caps the count', () => {
    const results = Array.from({ length: MAX_SCHEMA_OPTIMIZATIONS + 2 }).map(
      (_, i) => ({
        database: 'default',
        table: `t${i}`,
        recommendations: [
          rec({
            title: `Add a skip index on col${i}`,
            estImpact: { ...rec().estImpact, granulesSaved: i * 10 },
          }),
        ],
      })
    )
    const out = selectSchemaOptimizations(results)
    expect(out).toHaveLength(MAX_SCHEMA_OPTIMIZATIONS)
    // Highest granulesSaved first.
    expect(out[0].value).toBeGreaterThan(out[1].value as number)
  })

  test('metric + title are impact-independent (stable dismissal key)', () => {
    const base = { database: 'default', table: 'events' }
    const [a] = selectSchemaOptimizations([
      {
        ...base,
        recommendations: [
          rec({ estImpact: { ...rec().estImpact, granulesSaved: 5 } }),
        ],
      },
    ])
    const [b] = selectSchemaOptimizations([
      {
        ...base,
        recommendations: [
          rec({ estImpact: { ...rec().estImpact, granulesSaved: 9999 } }),
        ],
      },
    ])
    // Different impact numbers must NOT change the key-forming fields.
    expect(a.metric).toBe(b.metric)
    expect(a.title).toBe(b.title)
  })
})
