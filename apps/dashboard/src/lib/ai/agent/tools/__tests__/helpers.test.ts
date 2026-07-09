import { describe, expect, mock, test } from 'bun:test'

mock.module('server-only', () => ({}))

const {
  resolveHostId,
  isValidTableIdentifier,
  hostIdSchema,
  requiredHostIdSchema,
  capResultRows,
  truncationNote,
  MAX_QUERY_RESULT_ROWS,
} = await import('../helpers')

describe('resolveHostId', () => {
  test('returns default when tool host ID is undefined', () => {
    expect(resolveHostId(undefined, 0)).toBe(0)
    expect(resolveHostId(undefined, 5)).toBe(5)
  })

  test('returns tool host ID when provided', () => {
    expect(resolveHostId(1, 0)).toBe(1)
    expect(resolveHostId(3, 3)).toBe(3)
  })
})

describe('isValidTableIdentifier', () => {
  test('accepts simple identifiers', () => {
    expect(isValidTableIdentifier('query_log')).toBe(true)
    expect(isValidTableIdentifier('my_table_123')).toBe(true)
    expect(isValidTableIdentifier('T')).toBe(true)
  })

  test('accepts backtick-quoted identifiers', () => {
    expect(isValidTableIdentifier('`my-table`')).toBe(true)
    expect(isValidTableIdentifier('`table.with.dots`')).toBe(true)
  })

  test('accepts database.table format', () => {
    expect(isValidTableIdentifier('system.query_log')).toBe(true)
    expect(isValidTableIdentifier('`my-db`.`my-table`')).toBe(true)
  })

  test('rejects empty strings', () => {
    expect(isValidTableIdentifier('')).toBe(false)
  })

  test('rejects overly long identifiers', () => {
    expect(isValidTableIdentifier('a'.repeat(257))).toBe(false)
  })

  test('rejects identifiers starting with digits', () => {
    expect(isValidTableIdentifier('123table')).toBe(false)
  })

  test('rejects identifiers with special characters', () => {
    expect(isValidTableIdentifier('table;DROP')).toBe(false)
    expect(isValidTableIdentifier("table'OR")).toBe(false)
  })
})

describe('hostIdSchema', () => {
  test('accepts valid integers and coerces valid strings', () => {
    expect(hostIdSchema.safeParse(0).success).toBe(true)
    expect(hostIdSchema.safeParse(0).data).toBe(0)
    expect(hostIdSchema.safeParse(3).success).toBe(true)
    expect(hostIdSchema.safeParse(3).data).toBe(3)
    expect(hostIdSchema.safeParse('1').success).toBe(true)
    expect(hostIdSchema.safeParse('1').data).toBe(1)
  })

  test('accepts undefined, null, empty strings and coerces them to undefined', () => {
    expect(hostIdSchema.safeParse(undefined).success).toBe(true)
    expect(hostIdSchema.safeParse(undefined).data).toBeUndefined()
    expect(hostIdSchema.safeParse(null).success).toBe(true)
    expect(hostIdSchema.safeParse(null).data).toBeUndefined()
    expect(hostIdSchema.safeParse('').success).toBe(true)
    expect(hostIdSchema.safeParse('').data).toBeUndefined()
    expect(hostIdSchema.safeParse('   ').success).toBe(true)
    expect(hostIdSchema.safeParse('   ').data).toBeUndefined()
  })

  test('rejects negative integers, floats, and invalid strings', () => {
    expect(hostIdSchema.safeParse(-1).success).toBe(false)
    expect(hostIdSchema.safeParse('-2').success).toBe(false)
    expect(hostIdSchema.safeParse(1.5).success).toBe(false)
    expect(hostIdSchema.safeParse('abc').success).toBe(false)
  })
})

describe('capResultRows', () => {
  test('returns data unchanged and truncated: false when under the cap', () => {
    const data = Array.from({ length: 10 }, (_, i) => i)
    const result = capResultRows(data, 1000)
    expect(result.data).toEqual(data)
    expect(result.truncated).toBe(false)
  })

  test('returns data unchanged and truncated: false when exactly at the cap', () => {
    const data = Array.from({ length: 1000 }, (_, i) => i)
    const result = capResultRows(data, 1000)
    expect(result.data).toHaveLength(1000)
    expect(result.truncated).toBe(false)
  })

  test('truncates to maxRows and flags truncated: true when over the cap', () => {
    const data = Array.from({ length: 1500 }, (_, i) => i)
    const result = capResultRows(data, 1000)
    expect(result.data).toHaveLength(1000)
    expect(result.data[999]).toBe(999)
    expect(result.truncated).toBe(true)
  })

  test('defaults maxRows to MAX_QUERY_RESULT_ROWS (1000)', () => {
    expect(MAX_QUERY_RESULT_ROWS).toBe(1000)
    const data = Array.from({ length: 1200 }, (_, i) => i)
    const result = capResultRows(data)
    expect(result.data).toHaveLength(1000)
    expect(result.truncated).toBe(true)
  })
})

describe('truncationNote', () => {
  test('mentions the row cap and how to see the full result set', () => {
    const note = truncationNote(1000)
    expect(note).toContain('1000 rows')
    expect(note).toContain('LIMIT')
  })
})

describe('requiredHostIdSchema', () => {
  test('accepts valid integers and coerces valid strings', () => {
    expect(requiredHostIdSchema.safeParse(0).success).toBe(true)
    expect(requiredHostIdSchema.safeParse(0).data).toBe(0)
    expect(requiredHostIdSchema.safeParse('2').success).toBe(true)
    expect(requiredHostIdSchema.safeParse('2').data).toBe(2)
  })

  test('rejects undefined, null, and empty strings', () => {
    expect(requiredHostIdSchema.safeParse(undefined).success).toBe(false)
    expect(requiredHostIdSchema.safeParse(null).success).toBe(false)
    expect(requiredHostIdSchema.safeParse('').success).toBe(false)
    expect(requiredHostIdSchema.safeParse('   ').success).toBe(false)
  })

  test('rejects negative integers, floats, and invalid strings', () => {
    expect(requiredHostIdSchema.safeParse(-1).success).toBe(false)
    expect(requiredHostIdSchema.safeParse(1.5).success).toBe(false)
    expect(requiredHostIdSchema.safeParse('abc').success).toBe(false)
  })
})
