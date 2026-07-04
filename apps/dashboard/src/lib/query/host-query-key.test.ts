import { hostConnectionKey } from './host-query-key'
import { describe, expect, test } from 'bun:test'

describe('hostConnectionKey', () => {
  test('server hosts contribute no host-list state to the key', () => {
    // id >= 0 and the default host are fully identified by the request URL, so
    // the key part is a constant `undefined` regardless of whether the merged
    // host list has settled — this is what stops the cold-load double-fetch.
    expect(hostConnectionKey(0, null)).toBeUndefined()
    expect(hostConnectionKey(1, null)).toBeUndefined()
    expect(hostConnectionKey(undefined, null)).toBeUndefined()
  })

  test('a browser connection keys on its stable connection id', () => {
    expect(hostConnectionKey(-1, { id: 'conn-a' })).toBe('conn-a')
    expect(hostConnectionKey(-1000, { id: 'conn-b' })).toBe('conn-b')
  })

  test('two connections sharing a negative slot never collide', () => {
    // Negative id slots are reused as connections are added/removed. If the key
    // dropped the connection id, connection B at slot -1 would read connection
    // A's cached data. The stable id keeps their cache entries distinct.
    const a = hostConnectionKey(-1, { id: 'conn-a' })
    const b = hostConnectionKey(-1, { id: 'conn-b' })
    expect(a).not.toBe(b)
  })

  test('an unresolved browser connection defers, then refetches on resolve', () => {
    // Before useMergedHosts() settles the connection is null → undefined key
    // part; once it resolves the id enters the key, triggering one refetch.
    expect(hostConnectionKey(-1, null)).toBeUndefined()
    expect(hostConnectionKey(-1, undefined)).toBeUndefined()
    expect(hostConnectionKey(-1, { id: 'conn-a' })).toBe('conn-a')
  })
})
