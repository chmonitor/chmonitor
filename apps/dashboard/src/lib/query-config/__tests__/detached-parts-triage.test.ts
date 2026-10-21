/**
 * detached-parts-triage is a review aid, never a "safe to drop" verdict (#4070).
 *
 * The live suite (`pnpm run test:query-config:live`) runs the SQL against a
 * real server in both analyzer modes. These tests pin the text-level contract
 * that cannot drift without someone noticing: bounded output, no DROP advice,
 * wording that says "review" and "this replica", the class rules, and the SQL
 * shapes that broke other configs on the old analyzer.
 */

import type { QueryConfig } from '@/types/query-config'

import { detachedPartsTriageDeclarative } from '../declarative/catalog/tables/detached-parts-triage'
import { detachedPartsTriageConfig } from '../tables/detached-parts-triage'
import { describe, expect, test } from 'bun:test'

const configs: [string, QueryConfig | typeof detachedPartsTriageDeclarative][] =
  [
    ['ts config', detachedPartsTriageConfig],
    ['declarative twin', detachedPartsTriageDeclarative],
  ]

const sqlOf = (c: { sql: QueryConfig['sql'] }): string =>
  typeof c.sql === 'string' ? c.sql : c.sql.map((v) => v.sql).join('\n')

for (const [label, config] of configs) {
  describe(`detached-parts-triage (${label})`, () => {
    const sql = sqlOf(config)

    test('is read-only and bounded', () => {
      expect(sql).toMatch(/LIMIT 200\s*$/)
      expect(sql).not.toMatch(/\b(DROP|ALTER|ATTACH|DETACH|TRUNCATE)\b/i)
      expect(sql).not.toMatch(/\bformat\(/)
    })

    test('says review and THIS REPLICA ONLY, never safe', () => {
      expect(config.description).toContain('THIS REPLICA ONLY')
      expect(config.description).toMatch(/does not prove other replicas/)
      expect(config.description).toContain('review')
      for (const text of [config.description ?? '', sql]) {
        expect(text).not.toMatch(/likely_safe|\bsafe\b(?!-to-drop verdict)/i)
        expect(text).not.toMatch(/DROP DETACHED/i)
      }
    })

    test('never classes a broken or owned part as reviewable', () => {
      // Owned parts win first, then broken-like reasons, and only then the
      // coverage rule; coverage must not appear before those two branches.
      const owned = sql.indexOf("'cannot_drop_via_sql'")
      const attention = sql.indexOf("'needs_attention'")
      const reviewable = sql.indexOf("'review_after_coverage_check'")
      expect(owned).toBeGreaterThan(-1)
      expect(attention).toBeGreaterThan(owned)
      expect(reviewable).toBeGreaterThan(attention)
      expect(sql).toContain(
        "'broken', 'broken-on-start', 'unexpected', 'noquorum'"
      )
      expect(sql).toContain("startsWith(dp.name, 'attaching_')")
      expect(sql).toContain("startsWith(dp.name, 'deleting_')")
      expect(sql).toContain("startsWith(dp.name, 'tmp-fetch_')")
      // reviewable only for ignored/clone/covered reasons, all parts covered,
      // newest part older than 30 days.
      expect(sql).toContain("IN ('ignored', 'clone', 'covered-by-broken')")
      expect(sql).toContain('countIf(dpt.part_covered = 1) = count()')
      expect(sql).toContain('max(dpt.part_modified) < now() - INTERVAL 30 DAY')
    })

    test('coverage is same-partition, active-only, block-range containment', () => {
      expect(sql).toContain('ps.active = 1')
      expect(sql).toContain('ap.active_partition = dp.partition_id')
      expect(sql).toMatch(
        /r\.1 <= dp\.min_block_number AND r\.2 >= dp\.max_block_number/
      )
    })

    test('old-analyzer safe: no lambda alias in WITH, no correlated EXISTS', () => {
      expect(sql).not.toMatch(/\bWITH\b/i)
      expect(sql).not.toMatch(/\bEXISTS\b/i)
    })

    test('no output alias shadows a source column (#4032)', () => {
      // The derived subquery never exposes a bare database/table/reason column.
      expect(sql).toMatch(/dp\.database AS part_database/)
      expect(sql).toMatch(/dp\.table AS part_table/)
      const inner = sql.slice(sql.indexOf('FROM\n'), sql.indexOf(') AS dpt'))
      for (const [, alias] of inner.matchAll(/\bAS (\w+)/g)) {
        expect(alias).toMatch(/^(part_|active_|dp$|dq$|ps$|ap$)/)
      }
    })

    test('BackgroundBar column has base, readable_ and pct_ companions', () => {
      expect(sql).toMatch(/sum\(dpt\.part_bytes\)\s+AS bytes/)
      expect(sql).toMatch(/formatReadableSize\([^\n]*AS readable_bytes/)
      expect(sql).toMatch(/AS pct_bytes/)
    })

    test('exposes the documented columns', () => {
      for (const col of config.columns) {
        expect(sql).toMatch(new RegExp(`\\bAS ${col}\\b`))
      }
    })
  })
}

test('registered in the main query list and left the existing config alone', async () => {
  const { queries } = await import('../index')
  expect(queries.map((q) => q.name)).toContain('detached-parts-triage')
  expect(queries.map((q) => q.name)).toContain('detached_parts')
})
