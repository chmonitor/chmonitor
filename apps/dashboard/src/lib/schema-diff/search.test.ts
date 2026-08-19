import { validateSchemaDiffSearch } from './search'
import { describe, expect, test } from 'bun:test'

describe('validateSchemaDiffSearch', () => {
  test('parses host, source, and target integers', () => {
    expect(
      validateSchemaDiffSearch({ host: '1', source: '2', target: '3' })
    ).toEqual({
      host: 1,
      source: 2,
      target: 3,
    })
  })

  test('defaults host and drops invalid pair ids', () => {
    expect(
      validateSchemaDiffSearch({ host: 'nope', source: '1.5', target: 'x' })
    ).toEqual({
      host: 0,
    })
  })

  test('parses optional scope', () => {
    expect(
      validateSchemaDiffSearch({
        host: '0',
        source: '1',
        target: '2',
        scope: 'nodes',
      })
    ).toEqual({
      host: 0,
      source: 1,
      target: 2,
      scope: 'nodes',
    })
  })

  test('drops invalid scope', () => {
    expect(validateSchemaDiffSearch({ host: '0', scope: 'nope' })).toEqual({
      host: 0,
    })
  })

  test('parses negative user-connection ids', () => {
    expect(
      validateSchemaDiffSearch({
        host: '-1',
        source: '-1000',
        target: '-1',
      })
    ).toEqual({
      host: -1,
      source: -1000,
      target: -1,
    })
  })
})
