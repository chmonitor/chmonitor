import type { FilterSchema } from './types'

import { filterSchemaForVersion } from './version-gate'
import { describe, expect, test } from 'bun:test'
import { runningQueriesFilterSchema } from '@/lib/query-config/queries/running-queries'

const keysOf = (s: FilterSchema) => s.fields.map((f) => f.key)

describe('filterSchemaForVersion', () => {
  test('client_agent is offered only on 26.6+ (only that SQL selects it)', () => {
    const at = (v: string) =>
      keysOf(filterSchemaForVersion(runningQueriesFilterSchema, v))
    expect(at('26.5.1.1')).not.toContain('client_agent')
    expect(at('26.6.1.1')).toContain('client_agent')
    expect(at('27.1.1.1')).toContain('client_agent')
  })

  test('an unknown version hides gated fields but keeps the rest', () => {
    const keys = keysOf(
      filterSchemaForVersion(runningQueriesFilterSchema, undefined)
    )
    expect(keys).not.toContain('client_agent')
    expect(keys).toContain('user')
  })

  test('drops presets that reference a hidden field', () => {
    const schema: FilterSchema = {
      fields: [
        { key: 'a', column: 'a', label: 'A', type: 'text', operators: ['eq'] },
        {
          key: 'b',
          column: 'b',
          label: 'B',
          type: 'text',
          operators: ['eq'],
          since: '26.6',
        },
      ],
      presets: [
        { name: 'ok', filters: [{ key: 'a', operator: 'eq', value: '1' }] },
        { name: 'gated', filters: [{ key: 'b', operator: 'eq', value: '1' }] },
      ],
    }
    expect(
      filterSchemaForVersion(schema, '25.1').presets?.map((p) => p.name)
    ).toEqual(['ok'])
  })

  test('an ungated schema is returned unchanged', () => {
    const schema: FilterSchema = {
      fields: [
        { key: 'a', column: 'a', label: 'A', type: 'text', operators: ['eq'] },
      ],
    }
    expect(filterSchemaForVersion(schema, undefined)).toBe(schema)
  })
})
