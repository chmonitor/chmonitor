/**
 * GET /api/v1/releases
 *
 * Public product changelog for the in-dashboard What's new dialog.
 * Fetches GitHub Releases for chmonitor/chmonitor server-side (no user token),
 * filters to `vX.Y.Z`, and falls back to CHANGELOG.md when GitHub is down.
 * Cached ~1h in memory. Anonymous callers are allowed — notes are public.
 */

import { createFileRoute } from '@tanstack/react-router'

import { loadReleases } from '@/lib/whats-new/fetch-releases'

async function handleGet(): Promise<Response> {
  const payload = await loadReleases()
  const status = payload.success ? 200 : 503
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'public, max-age=60',
    },
  })
}

export const Route = createFileRoute('/api/v1/releases')({
  server: {
    handlers: {
      GET: () => handleGet(),
    },
  },
})

export { handleGet as __handleGetForTests }
