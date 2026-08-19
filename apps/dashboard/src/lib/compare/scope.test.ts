import { canComparePair, resolveCompareScope, resolvePair } from './scope'
import { describe, expect, test } from 'bun:test'

describe('resolveCompareScope', () => {
  test('uses nodes when only the cluster has a pair', () => {
    expect(
      resolveCompareScope({ hostCount: 1, nodeCount: 3, requested: 'hosts' })
    ).toBe('nodes')
  })

  test('honors requested nodes when 2+ nodes exist', () => {
    expect(
      resolveCompareScope({ hostCount: 2, nodeCount: 2, requested: 'nodes' })
    ).toBe('nodes')
  })

  test('defaults to hosts when two saved hosts exist', () => {
    expect(resolveCompareScope({ hostCount: 2, nodeCount: 1 })).toBe('hosts')
  })
})

describe('resolvePair', () => {
  const peers = [
    { id: 0, name: 'A' },
    { id: 1, name: 'B' },
    { id: 2, name: 'C' },
  ]

  test('swaps to a different target when source equals target', () => {
    expect(resolvePair(peers, 1, 1)).toEqual({ sourceId: 1, targetId: 0 })
  })

  test('returns null without a pair', () => {
    expect(resolvePair([{ id: 0, name: 'A' }], 0, 1)).toBeNull()
  })
})

describe('canComparePair', () => {
  test('is true for two hosts or two nodes', () => {
    expect(canComparePair(2, 1)).toBe(true)
    expect(canComparePair(1, 2)).toBe(true)
    expect(canComparePair(1, 1)).toBe(false)
  })
})
