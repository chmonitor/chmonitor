/**
 * Load-bearing invariant test: this package RECOMMENDS ONLY and does no I/O.
 *
 * The dashboard has the equivalent guard for its own orchestration layer
 * (`apps/dashboard/src/lib/ai/advisor/__tests__/analyze-query.test.ts`), and
 * the MCP tool for its fetchers (`packages/mcp-server/src/__tests__/advisor.test.ts`).
 * This one guards the shared engine both of them now import.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { scorePartitionKey, scoreProjection, scoreSkipIndex } from './scorers'
import { makeContext, makeSchema } from './test-fixtures'

const SOURCE_FILES = [
  'index.ts',
  'types.ts',
  'sql-parsing.ts',
  'scorers.ts',
  'impact.ts',
]

describe('recommend-only invariant', () => {
  test('no source file exposes an execute/apply surface', () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(join(import.meta.dir, file), 'utf-8')
      expect(source).not.toMatch(/\bwriteQuery\b/)
      expect(source).not.toMatch(/\.command\s*\(/)
      expect(source).not.toMatch(/\.insert\s*\(/)
      expect(source).not.toMatch(/\bapplyRecommendation\b/)
      expect(source).not.toMatch(/\bexecuteDdl\b/)
    }
  })

  test('no source file performs I/O — the engine is pure, callers fetch', () => {
    for (const file of SOURCE_FILES) {
      const source = readFileSync(join(import.meta.dir, file), 'utf-8')
      expect(source).not.toMatch(/\bfetch\s*\(/)
      expect(source).not.toMatch(/from '@chm\/clickhouse-client'/)
      expect(source).not.toMatch(/from 'node:/)
    }
  })

  test('the package declares no runtime dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'package.json'), 'utf-8')
    )
    expect(pkg.dependencies).toBeUndefined()
  })

  test('scorer output is inert, JSON-serializable data', () => {
    const ctx = makeContext({
      groupByColumns: ['status'],
      predicates: [
        {
          column: 'created_at',
          operator: '>',
          isRange: true,
          isEqualityOrIn: false,
        },
      ],
      schema: makeSchema({
        columns: [
          ...makeSchema().columns,
          {
            name: 'created_at',
            type: 'DateTime',
            isInPartitionKey: false,
            isInSortingKey: false,
            compressedBytes: 1000,
            uncompressedBytes: 2000,
          },
        ],
      }),
    })
    const recommendations = [
      ...scoreSkipIndex(ctx),
      scoreProjection(ctx),
      scorePartitionKey(ctx),
    ].filter((r) => r !== null)

    expect(recommendations.length).toBeGreaterThan(0)
    expect(JSON.parse(JSON.stringify(recommendations))).toEqual(recommendations)
  })
})
