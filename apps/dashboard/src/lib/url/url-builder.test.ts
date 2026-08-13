import { describe, expect, it } from 'bun:test'
import { buildUrl, splitHref } from './url-builder'

describe('buildUrl', () => {
  it('builds a URL with no existing query string', () => {
    expect(buildUrl('/overview', { host: 0 })).toBe('/overview?host=0')
  })

  it('appends to an existing query string', () => {
    expect(
      buildUrl('/table?database=default', { host: 1, table: 'users' })
    ).toBe('/table?database=default&host=1&table=users')
  })

  it('merges with existing search params', () => {
    expect(
      buildUrl('/table', { host: 1 }, 'database=default&status=active')
    ).toBe('/table?database=default&status=active&host=1')
  })

  it('drops undefined values', () => {
    expect(buildUrl('/overview', { host: 0, filter: undefined })).toBe(
      '/overview?host=0'
    )
  })
})

describe('splitHref', () => {
  it('returns just `to` when there is no query string', () => {
    expect(splitHref('/overview')).toEqual({ to: '/overview' })
  })

  it('splits a single query param into `search`', () => {
    expect(splitHref('/overview?host=0')).toEqual({
      to: '/overview',
      search: { host: '0' },
    })
  })

  it('splits multiple query params into `search`', () => {
    expect(splitHref('/table?database=default&host=1&table=users')).toEqual({
      to: '/table',
      search: { database: 'default', host: '1', table: 'users' },
    })
  })

  it('round-trips buildUrl output back into {to, search}', () => {
    const href = buildUrl('/explorer', { host: 2, database: 'default' })
    expect(splitHref(href)).toEqual({
      to: '/explorer',
      search: { host: '2', database: 'default' },
    })
  })

  it('handles a trailing `?` with no params as an empty search object', () => {
    expect(splitHref('/keeper?')).toEqual({ to: '/keeper', search: {} })
  })
})
