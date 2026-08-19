import {
  type DiffPeer,
  mergeDiffPeerLists,
  parseBrowserDiffSessions,
} from './diff-peers'
import { resolvePair } from './scope'
import { describe, expect, test } from 'bun:test'

function peer(id: number, name: string, kind: DiffPeer['kind']): DiffPeer {
  return { id, name, kind }
}

describe('parseBrowserDiffSessions', () => {
  test('keeps negative host ids with a session token', () => {
    expect(
      parseBrowserDiffSessions({
        browserSessions: [
          { hostId: -1, name: 'laptop', sessionToken: 'tok' },
          { hostId: 0, sessionToken: 'env-not-allowed' },
          { hostId: -2, connection: { host: 'http://ch', user: 'default' } },
        ],
      })
    ).toEqual([
      {
        hostId: -1,
        name: 'laptop',
        sessionToken: 'tok',
        connection: undefined,
      },
      {
        hostId: -2,
        name: undefined,
        sessionToken: undefined,
        connection: { host: 'http://ch', user: 'default', password: '' },
      },
    ])
  })

  test('returns empty for missing or junk bodies', () => {
    expect(parseBrowserDiffSessions(null)).toEqual([])
    expect(parseBrowserDiffSessions({})).toEqual([])
    expect(parseBrowserDiffSessions({ browserSessions: 'nope' })).toEqual([])
  })
})

describe('mergeDiffPeerLists', () => {
  test('orders env then browser then database and keeps negative ids', () => {
    const merged = mergeDiffPeerLists(
      [peer(0, 'demo', 'env')],
      [peer(-1, 'browser', 'browser')],
      [peer(-1000, 'prod', 'database')]
    )
    expect(merged.map((p) => p.id)).toEqual([0, -1, -1000])
    expect(resolvePair(merged, -1000, -1)).toEqual({
      sourceId: -1000,
      targetId: -1,
    })
  })

  test('hides env when demo is blocked so signed-in cloud can be empty', () => {
    const merged = mergeDiffPeerLists([], [], [])
    expect(merged).toEqual([])
  })

  test('first id wins on collision', () => {
    const merged = mergeDiffPeerLists(
      [peer(0, 'env', 'env')],
      [peer(0, 'browser-collision', 'browser')],
      []
    )
    expect(merged).toHaveLength(1)
    expect(merged[0].name).toBe('env')
  })
})
