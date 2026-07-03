/**
 * GET /api/v1/audit/export — org-scoped, date-filtered CSV export of the
 * audit log. Enterprise edition only.
 *
 * Auth: requires a signed-in org admin (no `member:manage` RBAC permission
 * exists yet — see lib/rbac/rbac.ts — so this composes the org-admin Clerk
 * role directly: `orgRole === 'org:admin'`).
 *
 * Org scoping is mandatory and session-derived: the org id comes from
 * `resolveBillingOwner()` (the session's active Clerk org), NEVER from a
 * request query param, so a caller can only ever export their own org's rows.
 *
 * Query params: `from` / `to` (ISO dates), both optional — default to the
 * last 30 days. A bare `YYYY-MM-DD` `to` value is treated as end-of-day so
 * the whole day is included.
 */
import { createFileRoute } from '@tanstack/react-router'

import type { BillingOwner } from '@/lib/billing/billing-owner'

import { auth } from '@clerk/tanstack-react-start/server'
import { createErrorResponse as createApiErrorResponse } from '@/lib/api/error-handler'
import { ApiErrorType } from '@/lib/api/types'
import { buildAuditCsv } from '@/lib/audit/csv'
import { logEvent } from '@/lib/audit/logEvent'
import { listAuditLogs } from '@/lib/audit/query'
import { resolveBillingOwner } from '@/lib/billing/billing-owner'
import { isEnabled } from '@/lib/edition'

const ROUTE = { route: '/api/v1/audit/export', method: 'GET' }
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const BARE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function notFound(): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.TableNotFound, message: 'Not found' },
    404,
    ROUTE
  )
}

function unauthorized(): Response {
  return createApiErrorResponse(
    {
      type: ApiErrorType.PermissionError,
      message: 'Authentication is required.',
    },
    401,
    ROUTE
  )
}

function forbidden(message: string): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.PermissionError, message },
    403,
    ROUTE
  )
}

function badRequest(message: string): Response {
  return createApiErrorResponse(
    { type: ApiErrorType.ValidationError, message },
    400,
    ROUTE
  )
}

/**
 * Parses a `from`/`to` query param into an ISO-8601 timestamp. When
 * `endOfDay` is set, a bare `YYYY-MM-DD` value is expanded to the last
 * instant of that day so the whole day is included. Returns null when the
 * value fails to parse.
 */
function parseBound(value: string, endOfDay: boolean): string | null {
  const normalized =
    endOfDay && BARE_DATE_RE.test(value) ? `${value}T23:59:59.999Z` : value
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString()
}

function sanitizeForFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

async function handleGet(request: Request): Promise<Response> {
  if (!isEnabled('audit')) {
    return notFound()
  }

  let owner: BillingOwner
  try {
    owner = await resolveBillingOwner()
  } catch {
    return unauthorized()
  }

  if (owner.type !== 'org') {
    return forbidden('An active organization is required to export audit logs.')
  }

  const authResult = await auth()
  const orgRole = (authResult as { orgRole?: string | null } | null)?.orgRole
  if (orgRole !== 'org:admin') {
    return forbidden('Only organization admins can export audit logs.')
  }

  const orgId = owner.id
  const userId = authResult?.userId ?? null

  const searchParams = new URL(request.url).searchParams
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')

  const fromIso = fromParam
    ? parseBound(fromParam, false)
    : new Date(Date.now() - THIRTY_DAYS_MS).toISOString()
  if (!fromIso) return badRequest('Invalid "from" date.')

  const toIso = toParam ? parseBound(toParam, true) : new Date().toISOString()
  if (!toIso) return badRequest('Invalid "to" date.')

  // orgId is session-derived above — never taken from fromParam/toParam or
  // any other request input, so this can only ever read the caller's own org.
  const rows = await listAuditLogs(orgId, fromIso, toIso)
  const csv = buildAuditCsv(rows)

  // Best-effort self-log — logEvent never throws, so this can't affect the
  // response either way.
  await logEvent({
    orgId,
    userId,
    event: 'audit.export',
    resource: null,
    action: 'export',
    result: 'success',
    metadata: { from: fromIso, to: toIso, rows: rows.length },
  })

  const filename = `audit-${sanitizeForFilename(orgId)}-${fromIso.slice(0, 10)}-${toIso.slice(0, 10)}.csv`

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export const Route = createFileRoute('/api/v1/audit/export')({
  server: {
    handlers: {
      GET: async ({ request }) => handleGet(request),
    },
  },
})

// Exported for unit tests only.
export { handleGet as __handleGetForTests }
