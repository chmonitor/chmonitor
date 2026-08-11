import {
  buildSchemaForm,
  coerceFormValues,
  type FormField,
  parseRawArguments,
  validateFormValues,
} from '../schema-form'
import { describe, expect, it } from 'bun:test'

describe('buildSchemaForm', () => {
  it('treats a missing or empty schema as a no-argument tool', () => {
    expect(buildSchemaForm(undefined)).toEqual({
      fields: [],
      requiresRawJson: false,
    })
    expect(buildSchemaForm({ type: 'object', properties: {} })).toEqual({
      fields: [],
      requiresRawJson: false,
    })
  })

  it('maps scalar properties and marks required ones', () => {
    const { fields, requiresRawJson } = buildSchemaForm({
      type: 'object',
      required: ['sql'],
      properties: {
        sql: { type: 'string', description: 'SQL query' },
        hostId: { type: 'number', default: 0 },
        verbose: { type: 'boolean' },
      },
    })

    expect(requiresRawJson).toBe(false)
    // Required first, so the shortest path to a valid call is at the top.
    expect(fields[0]).toMatchObject({
      name: 'sql',
      kind: 'string',
      required: true,
      description: 'SQL query',
    })
    expect(fields.find((f) => f.name === 'hostId')).toMatchObject({
      kind: 'number',
      required: false,
      default: '0',
    })
    expect(fields.find((f) => f.name === 'verbose')?.kind).toBe('boolean')
  })

  it('reads integers as number fields and enums as option lists', () => {
    const { fields } = buildSchemaForm({
      properties: {
        limit: { type: 'integer' },
        order: { type: 'string', enum: ['asc', 'desc'] },
      },
    })
    expect(fields.find((f) => f.name === 'limit')?.kind).toBe('number')
    expect(fields.find((f) => f.name === 'order')).toMatchObject({
      kind: 'enum',
      options: ['asc', 'desc'],
    })
  })

  it('unwraps nullable unions produced by optional zod fields', () => {
    const { fields } = buildSchemaForm({
      properties: { hostId: { type: ['number', 'null'] } },
    })
    expect(fields[0]?.kind).toBe('number')
  })

  it('falls back to raw JSON when a property is not a simple scalar', () => {
    const { fields, requiresRawJson } = buildSchemaForm({
      properties: {
        sql: { type: 'string' },
        filters: { type: 'object', properties: { db: { type: 'string' } } },
      },
    })
    expect(requiresRawJson).toBe(true)
    // The mappable field is still offered; the UI adds the JSON escape hatch.
    expect(fields.map((f) => f.name)).toEqual(['sql'])
  })
})

const fields: FormField[] = [
  { name: 'sql', kind: 'string', required: true },
  { name: 'hostId', kind: 'number', required: false, default: '0' },
  { name: 'verbose', kind: 'boolean', required: false },
]

describe('coerceFormValues', () => {
  it('converts values by field kind', () => {
    expect(
      coerceFormValues(fields, {
        sql: 'SELECT 1',
        hostId: '2',
        verbose: 'true',
      })
    ).toEqual({ sql: 'SELECT 1', hostId: 2, verbose: true })
  })

  it('omits empty values so the server applies schema defaults', () => {
    expect(coerceFormValues(fields, { sql: 'SELECT 1', hostId: '' })).toEqual({
      sql: 'SELECT 1',
    })
  })

  it('drops unparseable numbers rather than sending NaN', () => {
    expect(coerceFormValues(fields, { sql: 'x', hostId: 'abc' })).toEqual({
      sql: 'x',
    })
  })
})

describe('validateFormValues', () => {
  it('reports empty required fields', () => {
    expect(validateFormValues(fields, {})).toEqual(['sql is required'])
  })

  it('reports non-numeric input for number fields', () => {
    expect(validateFormValues(fields, { sql: 'x', hostId: 'abc' })).toEqual([
      'hostId must be a number',
    ])
  })

  it('accepts a fully valid form', () => {
    expect(validateFormValues(fields, { sql: 'SELECT 1' })).toEqual([])
  })

  it('does not require a field that declares a default', () => {
    expect(
      validateFormValues(
        [{ name: 'hostId', kind: 'number', required: true, default: '0' }],
        {}
      )
    ).toEqual([])
  })
})

describe('parseRawArguments', () => {
  it('treats an empty textarea as no arguments', () => {
    expect(parseRawArguments('  ')).toEqual({ ok: true, args: {} })
  })

  it('parses a JSON object', () => {
    expect(parseRawArguments('{"sql":"SELECT 1"}')).toEqual({
      ok: true,
      args: { sql: 'SELECT 1' },
    })
  })

  it('rejects non-object JSON', () => {
    const result = parseRawArguments('[1,2]')
    expect(result.ok).toBe(false)
  })

  it('rejects malformed JSON', () => {
    const result = parseRawArguments('{oops')
    expect(result.ok).toBe(false)
  })
})
