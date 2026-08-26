/**
 * Authorize cron HTTP triggers via `Authorization: Bearer <CRON_SECRET>` only.
 *
 * Query-string secrets (`?secret=`) are rejected — they land in access logs.
 * Fail-closed: when CRON_SECRET is unset/empty, returns 503.
 */

import { env } from 'cloudflare:workers'
import { secretsMatch } from '@/lib/auth/providers/constant-time'

export function authorizeCronRequest(
  request: Request,
  _routeLabel: string
): Response | null {
  const bindings = env as Record<string, string | undefined>
  const secret = (bindings.CRON_SECRET ?? process.env.CRON_SECRET)?.trim()

  if (!secret) {
    return Response.json(
      { error: 'CRON_SECRET not configured' },
      { status: 503 }
    )
  }

  const authHeader = request.headers.get('authorization')
  if (authHeader && secretsMatch(authHeader, `Bearer ${secret}`)) return null

  const url = new URL(request.url)
  if (url.searchParams.has('secret')) {
    return Response.json(
      {
        error:
          'Query-string cron secrets are not accepted; use Authorization: Bearer',
      },
      { status: 401 }
    )
  }

  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
