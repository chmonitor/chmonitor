import { describe, expect, mock, test } from 'bun:test'

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({ getD1Database: () => undefined }),
}))

const { toPublicCustomWebhookTarget } = await import('./custom-webhook-config')

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
      headers: { 'X-Source': 'chmonitor' },
      secretHeaders: {
        Authorization: 'Bearer matrix-secret',
        'X-Internal-Token': 'header-secret',
      },
      updatedAt: 0,
      source: 'helm',
      editable: false,
    })

    expect(publicTarget.headers).toEqual({ 'X-Source': 'chmonitor' })
    expect(publicTarget).not.toHaveProperty('secretHeaders')
    expect(publicTarget).not.toHaveProperty('url')
    expect(JSON.stringify(publicTarget)).not.toContain('matrix-secret')
    expect(JSON.stringify(publicTarget)).not.toContain('header-secret')
    expect(JSON.stringify(publicTarget)).not.toContain('secret-room')
  })
})
