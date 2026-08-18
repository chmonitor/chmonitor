import { describe, expect, test } from 'bun:test'

import { namedDelta } from './named-delta'

describe('namedDelta', () => {
  test('splits added, removed, and changed by name', () => {
    const source = [
      { name: 'keep', type: 'UInt64' },
      { name: 'add', type: 'String' },
      { name: 'change', type: 'Float64' },
    ]
    const target = [
      { name: 'keep', type: 'UInt64' },
      { name: 'change', type: 'Float32' },
      { name: 'drop', type: 'Int32' },
    ]

    const delta = namedDelta(source, target, (a, b) => a.type === b.type)

    expect(delta.added.map((c) => c.name)).toEqual(['add'])
    expect(delta.removed.map((c) => c.name)).toEqual(['drop'])
    expect(delta.changed.map((c) => c.name)).toEqual(['change'])
    expect(delta.changed[0].source.type).toBe('Float64')
    expect(delta.changed[0].target.type).toBe('Float32')
  })
})
