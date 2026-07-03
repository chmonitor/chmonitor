// @ts-nocheck — test file, only runs under bun:test

import { proposePrewhereRewrite } from '../sql-rewriter'
import { makeContext, makeSchema } from './fixtures'
import { describe, expect, test } from 'bun:test'

describe('proposePrewhereRewrite', () => {
  test('moves a single selective predicate into PREWHERE', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error'",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite).not.toBeNull()
    expect(rewrite?.rewrittenSql).toBe(
      "SELECT * FROM default.events PREWHERE status = 'error'"
    )
    expect(rewrite?.movedPredicate.column).toBe('status')
  })

  test('keeps the remaining AND-joined conditions in WHERE', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error' AND user_id = 5",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
        {
          column: 'user_id',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
      schema: makeSchema({ sortingKeyColumns: ['event_date', 'user_id'] }),
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite?.rewrittenSql).toContain('PREWHERE')
    expect(rewrite?.rewrittenSql).toContain('WHERE user_id = 5')
  })

  test('preserves clauses after WHERE (GROUP BY / ORDER BY / LIMIT) verbatim', () => {
    const ctx = makeContext({
      sql: "SELECT status, count() FROM default.events WHERE status = 'error' GROUP BY status ORDER BY count() DESC LIMIT 10",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite?.rewrittenSql).toContain(
      'GROUP BY status ORDER BY count() DESC LIMIT 10'
    )
    expect(rewrite?.rewrittenSql).toContain('PREWHERE')
  })

  test('keeps a parenthesized OR group intact as a single condition (does not split inside it)', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error' AND (region = 'us' OR region = 'eu')",
      predicates: [
        {
          column: 'status',
          operator: '=',
          isRange: false,
          isEqualityOrIn: true,
        },
      ],
    })
    const rewrite = proposePrewhereRewrite(ctx)
    expect(rewrite?.rewrittenSql).toContain(
      "WHERE (region = 'us' OR region = 'eu')"
    )
  })

  test('returns null when there is no WHERE clause', () => {
    expect(
      proposePrewhereRewrite(
        makeContext({ sql: 'SELECT * FROM default.events' })
      )
    ).toBeNull()
  })

  test('returns null when there are no recognized predicates', () => {
    expect(
      proposePrewhereRewrite(
        makeContext({
          sql: 'SELECT * FROM default.events WHERE 1 = 1',
          predicates: [],
        })
      )
    ).toBeNull()
  })

  test('never executes anything — it only returns a string, synchronously', () => {
    const ctx = makeContext({
      sql: "SELECT * FROM default.events WHERE status = 'error'",
    })
    const result = proposePrewhereRewrite(ctx)
    // Not a Promise, no side effects possible from a plain sync function
    // returning a plain object of strings.
    expect(result).not.toBeInstanceOf(Promise)
    expect(typeof result?.rewrittenSql).toBe('string')
    for (const value of Object.values(result ?? {})) {
      expect(typeof value === 'function').toBe(false)
    }
  })
})
