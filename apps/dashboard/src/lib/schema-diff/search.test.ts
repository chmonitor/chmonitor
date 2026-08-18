import { describe, expect, test } from 'bun:test'

import { validateSchemaDiffSearch } from './search'

describe('validateSchemaDiffSearch', () => {
  test('parses host, source, and target integers', () => {
    expect(validateSchemaDiffSearch({ host: '1', source: '2', target: '3' })).toEqual({
      host: 1,
      source: 2,
      target: 3,
    })
  })

  test('defaults host and drops invalid pair ids', () => {
    expect(validateSchemaDiffSearch({ host: 'nope', source: '1.5', target: 'x' })).toEqual({
      host: 0,
    })
  })
})
