// @ts-nocheck — test file, only runs under bun:test

import type { TuningFinding } from '../types'

import { rankFindings } from '../tuning-engine'
import { describe, expect, test } from 'bun:test'

function finding(overrides: Partial<TuningFinding> = {}): TuningFinding {
  return {
    ruleId: 'nullable_column',
    category: 'schema',
    title: 't',
    target: 'db.tbl.col',
    rationale: 'r',
    evidence: 'e',
    estimatedBenefit: 'b',
    estimatedBytesSaved: 0,
    severity: 'low',
    ddl: 'ALTER ...',
    risk: 'low',
    riskNote: 'n',
    ...overrides,
  }
}

describe('rankFindings', () => {
  test('orders by estimated bytes saved descending', () => {
    const ranked = rankFindings([
      finding({ target: 'small', estimatedBytesSaved: 100 }),
      finding({ target: 'big', estimatedBytesSaved: 10_000 }),
      finding({ target: 'mid', estimatedBytesSaved: 5_000 }),
    ])
    expect(ranked.map((f) => f.target)).toEqual(['big', 'mid', 'small'])
  })

  test('breaks ties on bytes by severity (high first)', () => {
    const ranked = rankFindings([
      finding({ target: 'low', estimatedBytesSaved: 0, severity: 'low' }),
      finding({ target: 'high', estimatedBytesSaved: 0, severity: 'high' }),
      finding({ target: 'medium', estimatedBytesSaved: 0, severity: 'medium' }),
    ])
    expect(ranked.map((f) => f.target)).toEqual(['high', 'medium', 'low'])
  })

  test('schema findings with byte impact rank above zero-byte settings findings', () => {
    const ranked = rankFindings([
      finding({
        target: 'setting',
        category: 'settings',
        estimatedBytesSaved: 0,
        severity: 'high',
      }),
      finding({
        target: 'schema',
        category: 'schema',
        estimatedBytesSaved: 500,
      }),
    ])
    expect(ranked[0].target).toBe('schema')
  })

  test('does not mutate the input array', () => {
    const input = [
      finding({ target: 'a', estimatedBytesSaved: 1 }),
      finding({ target: 'b', estimatedBytesSaved: 2 }),
    ]
    rankFindings(input)
    expect(input.map((f) => f.target)).toEqual(['a', 'b'])
  })
})
