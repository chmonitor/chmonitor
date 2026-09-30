import type { CustomWebhookTarget } from './custom-webhook-targets'

import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => undefined }),
}))

const { mergeWebhookTargets, toPublicCustomWebhookTarget } = await import(
  './custom-webhook-config'
)

function target(
  overrides: Partial<CustomWebhookTarget> & Pick<CustomWebhookTarget, 'id'>
): CustomWebhookTarget {
  return {
    name: 'ops',
    url: 'https://hooks.example.test/ops',
    enabled: true,
    format: 'raw',
    minSeverity: null,
    titleTemplate: '',
    bodyTemplate: '',
    headers: {},
    updatedAt: 0,
    ...overrides,
  }
}

// #3539: operators save a D1 target under a Helm target's name to override
// or silence it. Merging by id (env:<name> vs a D1 uuid) would send both.
describe('custom webhook target merge', () => {
  test('a D1 target with the same name replaces the env target whole', () => {
    const merged = mergeWebhookTargets([
      {
        source: 'env',
        entries: [
          target({
            id: 'env:ops',
            url: 'https://helm.example.test/secret',
            secretHeaders: { Authorization: 'Bearer helm-secret' },
          }),
          target({ id: 'env:other', name: 'other' }),
        ],
      },
      {
        source: 'd1',
        entries: [
          target({
            id: 'uuid-1',
            url: 'https://d1.example.test/hook',
            enabled: false,
          }),
        ],
      },
    ])

    const ops = merged.filter((t) => t.name === 'ops')
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      id: 'uuid-1',
      source: 'd1',
      url: 'https://d1.example.test/hook',
      enabled: false,
    })
    // Whole replacement: the Helm secret header must not ride along to D1's URL.
    expect(ops[0]).not.toHaveProperty('secretHeaders')
    expect(merged.map((t) => t.name).sort()).toEqual(['ops', 'other'])
  })

  test('a file target shadows an env target with the same name', () => {
    const merged = mergeWebhookTargets([
      { source: 'env', entries: [target({ id: 'env:ops' })] },
      { source: 'file', entries: [target({ id: 'file-ops' })] },
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0]).toMatchObject({ id: 'file-ops', source: 'file' })
  })
})

describe('custom webhook public config', () => {
  test('never returns secret headers or the raw credential URL', () => {
    const publicTarget = toPublicCustomWebhookTarget({
      id: 'env:matrix',
      name: 'matrix',
      url: 'https://matrix.example.test/_matrix/client/v3/rooms/secret-room',
      enabled: true,
      format: 'matrix',
      minSeverity: null,
      titleTemplate: '',
      bodyTemplate: '',
      headers: {
        'X-Source': 'chmonitor',
        Authorization: 'Bearer should-not-be-public',
      },
      secretHeaders: {
        Authorization: 'Bearer matrix-secret',
        'X-Internal-Token': 'header-secret',
      },
      updatedAt: 0,
      source: 'env',
      editable: false,
    })

    expect(publicTarget.headers).toEqual({ 'X-Source': 'chmonitor' })
    expect(publicTarget).not.toHaveProperty('secretHeaders')
    expect(publicTarget).not.toHaveProperty('url')
    expect(JSON.stringify(publicTarget)).not.toContain('matrix-secret')
    expect(JSON.stringify(publicTarget)).not.toContain('header-secret')
    expect(JSON.stringify(publicTarget)).not.toContain('should-not-be-public')
    expect(JSON.stringify(publicTarget)).not.toContain('secret-room')
  })
})
