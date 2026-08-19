import { pickFanoutCluster } from './pick-fanout-cluster'
import { describe, expect, test } from 'bun:test'

describe('pickFanoutCluster', () => {
  test('prefers the widest physical cluster', () => {
    const name = pickFanoutCluster([
      { cluster: 'analytics', host_name: 'a', port: 9000 },
      { cluster: 'default', host_name: 'a', port: 9000 },
      { cluster: 'default', host_name: 'b', port: 9000 },
    ])
    expect(name).toBe('default')
  })

  test('falls back to the widest logical cluster', () => {
    const name = pickFanoutCluster([
      { cluster: 'tiny', host_name: 'a', port: 9000 },
      { cluster: 'wide', host_name: 'a', port: 9000 },
      { cluster: 'wide', host_name: 'b', port: 9000 },
    ])
    expect(name).toBe('wide')
  })

  test('returns null for empty input', () => {
    expect(pickFanoutCluster([])).toBeNull()
  })
})
