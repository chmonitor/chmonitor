/**
 * Tests for data.ts SQL validation on POST handler
 *
 * Structural verification that the POST /api/v1/data route calls
 * `validateSqlQuery` before executing client-supplied SQL. Requests that name
 * a `queryConfigName` never run client SQL at all; that path is covered by
 * named-config.test.ts.
 *
 * The GET handler already validates SQL; this test ensures the POST handler
 * does the same.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Source file is routes/api/v1/data.ts (sibling of the data/ directory)
const DATA_SOURCE = readFileSync(
  join((import.meta as any).dir, '..', '..', 'data.ts'),
  'utf-8'
)

describe('data.ts SQL validation (structural)', () => {
  test('GET handler calls validateSqlQuery', () => {
    // The GET handler should call validateSqlQuery within its body
    const getHandler = DATA_SOURCE.match(
      /const handleGet[\s\S]*?^}, ROUTE_CONTEXT\)/m
    )
    expect(getHandler).not.toBeNull()
    expect(getHandler![0]).toContain('validateSqlQuery(query)')
  })

  test('POST handler calls validateSqlQuery before fetchData', () => {
    // The POST handler should call validateSqlQuery within its body
    const postHandler = DATA_SOURCE.match(
      /const handlePost[\s\S]*?^}, ROUTE_CONTEXT\)/m
    )
    expect(postHandler).not.toBeNull()
    expect(postHandler![0]).toContain('validateSqlQuery(query)')
  })

  test('POST handler validates SQL before dashboard-query allowlist check', () => {
    // validateSqlQuery must appear before validateDashboardQuery in handlePost
    const postHandler = DATA_SOURCE.match(
      /const handlePost[\s\S]*?^}, ROUTE_CONTEXT\)/m
    )
    expect(postHandler).not.toBeNull()
    const body = postHandler![0]
    const sqlValidationPos = body.indexOf('validateSqlQuery(query)')
    const allowlistPos = body.indexOf('validateDashboardQuery(query')
    expect(sqlValidationPos).toBeGreaterThan(-1)
    expect(allowlistPos).toBeGreaterThan(-1)
    // SQL validation must come BEFORE the allowlist check
    expect(sqlValidationPos).toBeLessThan(allowlistPos)
  })
})
