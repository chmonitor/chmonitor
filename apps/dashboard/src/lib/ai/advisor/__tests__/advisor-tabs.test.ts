import {
  ADVISOR_DEFAULT_TAB,
  ADVISOR_TAB_QUERY,
  ADVISOR_TAB_SCHEMA,
  ADVISOR_TABS,
  resolveAdvisorTab,
} from '../advisor-tabs'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('advisor page tabs', () => {
  test('Schema & Settings is first and the default tab', () => {
    expect(ADVISOR_TABS[0]?.value).toBe(ADVISOR_TAB_SCHEMA)
    expect(ADVISOR_TABS[0]?.label).toBe('Schema & Settings')
    expect(ADVISOR_DEFAULT_TAB).toBe(ADVISOR_TAB_SCHEMA)
    expect(ADVISOR_TABS.map((tab) => tab.value)).toContain(ADVISOR_TAB_QUERY)
  })

  test('resolveAdvisorTab defaults to schema', () => {
    expect(resolveAdvisorTab({})).toBe('schema')
    expect(resolveAdvisorTab({ view: null, query: null, queryId: null })).toBe(
      'schema'
    )
  })

  test('query / queryId deep-links open Query Advisor', () => {
    expect(resolveAdvisorTab({ query: 'SELECT 1 FROM events' })).toBe('query')
    expect(resolveAdvisorTab({ queryId: 'abc' })).toBe('query')
  })

  test('explicit view wins over query params', () => {
    expect(
      resolveAdvisorTab({ view: 'schema', query: 'SELECT 1 FROM events' })
    ).toBe('schema')
    expect(resolveAdvisorTab({ view: 'query' })).toBe('query')
  })
})

describe('advisor page source', () => {
  test('page uses Schema as first tab and defaultValue from helpers', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../../routes/(dashboard)/advisor.tsx'),
      'utf-8'
    )
    expect(src).toContain('ADVISOR_TABS')
    expect(src).toContain('resolveAdvisorTab')
    expect(src).toContain('AdvisorSchemaTab')
    expect(src).toContain('AdvisorContent')
    expect(src).not.toMatch(/defaultValue=["']query["']/)
    expect(src).not.toMatch(/\bApply DDL\b/i)
    expect(src).not.toMatch(/\bexecuteDdl\b/)
  })
})
