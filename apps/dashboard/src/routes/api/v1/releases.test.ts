import type { ReleasesPayload } from '@/lib/whats-new/types'

import { afterEach, describe, expect, mock, test } from 'bun:test'

mock.module('@/lib/whats-new/fetch-releases', () => ({
  loadReleases: () => loadReleases(),
}))

const githubPayload: ReleasesPayload = {
  success: true,
  source: 'github',
  data: [
    {
      version: '0.3.3',
      tag: 'v0.3.3',
      publishedAt: '2026-08-15T12:00:00Z',
      summary: 'Settings gear',
      markdown: '### Features\n\n* **ui:** add settings icon',
      highlights: ['Settings gear'],
    },
  ],
}

let loadReleases = mock(async (): Promise<ReleasesPayload> => githubPayload)

const { __handleGetForTests: handleGet } = await import('./releases')

afterEach(() => {
  loadReleases = mock(async (): Promise<ReleasesPayload> => githubPayload)
})

describe('GET /api/v1/releases', () => {
  test('returns 200 with GitHub notes', async () => {
    const response = await handleGet()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { source: string; data: unknown[] }
    expect(body.source).toBe('github')
    expect(body.data).toHaveLength(1)
  })

  test('returns 503 when both GitHub and CHANGELOG fail', async () => {
    loadReleases = mock(
      async (): Promise<ReleasesPayload> => ({
        success: false,
        source: 'none',
        data: [],
        error: 'Release notes are temporarily unavailable.',
      })
    )
    const response = await handleGet()
    expect(response.status).toBe(503)
    const body = (await response.json()) as { success: boolean; error: string }
    expect(body.success).toBe(false)
    expect(body.error).toContain('unavailable')
  })
})
