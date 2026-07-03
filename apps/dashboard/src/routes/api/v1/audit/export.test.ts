/**
 * Tests for GET /api/v1/audit/export.
 *
 * The CRITICAL assertion (plans/22-audit-log-export.md STOP condition): org
 * scoping must be session-derived and NEVER influenced by a request param. A
 * caller signed in to org_A who tampers with the query string to reference
 * org_B must still only ever read org_A's rows — proven below by asserting
 * `listAuditLogs` (mocked) is always called with the SESSION org id
 * regardless of what the URL carries.
 *
 * `@/lib/audit/query` and `@/lib/audit/logEvent` are mocked at their LEAF
 * specifiers, never the `@/lib/audit` barrel — a barrel mock would also
 * shadow `buildAuditCsv`, which this file needs to stay REAL so the CSV
 * response body is genuine, not a stub (mirrors the leaf-mock convention in
 * log-session-event.test.ts).
 *
 * `CHM_EDITION` is a real global (`process.env`), not a mock — snapshotted
 * and restored per test so it can't leak into edition.test.ts or any other
 * file sharing this `bun test` process.
 */

import type { AuditLogRow } from '@/lib/audit/query'
import type { BillingOwner } from '@/lib/billing/billing-owner'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

let authImpl = mock(
  async () =>
    ({
      userId: 'user_1',
      orgId: 'org_A',
      orgRole: 'org:admin',
    }) as {
      userId: string | null
      orgId?: string | null
      orgRole?: string | null
    }
)
mock.module('@clerk/tanstack-react-start/server', () => ({
  auth: () => authImpl(),
}))

let resolveBillingOwnerImpl = mock(
  async (): Promise<BillingOwner> => ({
    type: 'org',
    id: 'org_A',
  })
)
mock.module('@/lib/billing/billing-owner', () => ({
  resolveBillingOwner: () => resolveBillingOwnerImpl(),
}))

let listAuditLogsImpl = mock(
  async (
    _orgId: string,
    _from: string,
    _to: string
  ): Promise<AuditLogRow[]> => []
)
mock.module('@/lib/audit/query', () => ({
  listAuditLogs: (orgId: string, from: string, to: string) =>
    listAuditLogsImpl(orgId, from, to),
}))

let logEventImpl = mock(async (_e: unknown) => {})
mock.module('@/lib/audit/logEvent', () => ({
  logEvent: (e: unknown) => logEventImpl(e),
}))

const { __handleGetForTests: handleGet } = await import('./export')

const ORIGINAL_CHM_EDITION = process.env.CHM_EDITION

function makeRequest(query = ''): Request {
  return new Request(`https://dash.example.com/api/v1/audit/export${query}`, {
    method: 'GET',
  })
}

function sampleRow(overrides: Partial<AuditLogRow> = {}): AuditLogRow {
  return {
    event_time: '2026-01-05T00:00:00.000Z',
    user_id: 'user_1',
    event: 'member.invited',
    resource: 'user_2',
    action: 'invite',
    result: 'success',
    ip: null,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.CHM_EDITION = 'enterprise'
  authImpl = mock(async () => ({
    userId: 'user_1',
    orgId: 'org_A',
    orgRole: 'org:admin',
  }))
  resolveBillingOwnerImpl = mock(async () => ({
    type: 'org' as const,
    id: 'org_A',
  }))
  listAuditLogsImpl = mock(async () => [])
  logEventImpl = mock(async () => {})
})

afterEach(() => {
  if (ORIGINAL_CHM_EDITION === undefined) {
    delete process.env.CHM_EDITION
  } else {
    process.env.CHM_EDITION = ORIGINAL_CHM_EDITION
  }
})

describe('GET /api/v1/audit/export — edition gate', () => {
  test('404s outside enterprise edition, before touching auth', async () => {
    process.env.CHM_EDITION = 'community'

    const res = await handleGet(makeRequest())

    expect(res.status).toBe(404)
    expect(resolveBillingOwnerImpl).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/audit/export — auth gate', () => {
  test('401 when the session cannot be resolved (not signed in / Clerk unavailable)', async () => {
    resolveBillingOwnerImpl = mock(async () => {
      throw new Error('unauthorized')
    })

    const res = await handleGet(makeRequest())

    expect(res.status).toBe(401)
  })

  test('403 when the session has no active org', async () => {
    resolveBillingOwnerImpl = mock(async () => ({
      type: 'user' as const,
      id: 'user_1',
    }))

    const res = await handleGet(makeRequest())

    expect(res.status).toBe(403)
    expect(listAuditLogsImpl).not.toHaveBeenCalled()
  })

  test('403 when the org member is not an admin', async () => {
    authImpl = mock(async () => ({
      userId: 'user_1',
      orgId: 'org_A',
      orgRole: 'org:member',
    }))

    const res = await handleGet(makeRequest())

    expect(res.status).toBe(403)
    expect(listAuditLogsImpl).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/audit/export — CRITICAL: org scoping is session-derived only', () => {
  test('ignores an org-referencing query param — always reads the SESSION org, never a param-supplied one', async () => {
    await handleGet(makeRequest('?orgId=org_B&org=org_B&org_id=org_B'))

    expect(listAuditLogsImpl).toHaveBeenCalledTimes(1)
    const [orgIdArg] = listAuditLogsImpl.mock.calls[0] as [
      string,
      string,
      string,
    ]
    expect(orgIdArg).toBe('org_A')
    expect(orgIdArg).not.toBe('org_B')
  })

  test('a different signed-in org (org_B) reads only org_B — proves the scoping key tracks the session, not a hardcoded value', async () => {
    resolveBillingOwnerImpl = mock(async () => ({
      type: 'org' as const,
      id: 'org_B',
    }))
    authImpl = mock(async () => ({
      userId: 'user_9',
      orgId: 'org_B',
      orgRole: 'org:admin',
    }))

    await handleGet(makeRequest())

    const [orgIdArg] = listAuditLogsImpl.mock.calls[0] as [
      string,
      string,
      string,
    ]
    expect(orgIdArg).toBe('org_B')
  })
})

describe('GET /api/v1/audit/export — date range parsing', () => {
  test('defaults to roughly the last 30 days when from/to are omitted', async () => {
    await handleGet(makeRequest())

    const [, fromArg, toArg] = listAuditLogsImpl.mock.calls[0] as [
      string,
      string,
      string,
    ]
    const spanMs = Date.parse(toArg) - Date.parse(fromArg)
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(spanMs - thirtyDaysMs)).toBeLessThan(5000)
  })

  test('explicit from/to are forwarded verbatim (from = start of day)', async () => {
    await handleGet(makeRequest('?from=2026-01-01&to=2026-01-02'))

    const [, fromArg, toArg] = listAuditLogsImpl.mock.calls[0] as [
      string,
      string,
      string,
    ]
    expect(fromArg).toBe('2026-01-01T00:00:00.000Z')
    // A bare date `to` is treated as end-of-day so the whole day is included.
    expect(toArg).toBe('2026-01-02T23:59:59.999Z')
  })

  test('400 on an unparseable "from"', async () => {
    const res = await handleGet(makeRequest('?from=not-a-date'))
    expect(res.status).toBe(400)
    expect(listAuditLogsImpl).not.toHaveBeenCalled()
  })

  test('400 on an unparseable "to"', async () => {
    const res = await handleGet(makeRequest('?to=not-a-date'))
    expect(res.status).toBe(400)
    expect(listAuditLogsImpl).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/audit/export — CSV response', () => {
  test('200 with text/csv content-type and an attachment content-disposition naming the org', async () => {
    listAuditLogsImpl = mock(async () => [sampleRow()])

    const res = await handleGet(makeRequest())

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    const disposition = res.headers.get('Content-Disposition') ?? ''
    expect(disposition).toContain('attachment;')
    expect(disposition).toContain('org_A')
  })

  test('the body is a real CSV: header row + one data row matching the queried rows', async () => {
    listAuditLogsImpl = mock(async () => [
      sampleRow({ event: 'connection.created' }),
    ])

    const res = await handleGet(makeRequest())
    const body = await res.text()
    const lines = body.split('\n')

    expect(lines[0]).toBe('event_time,user_id,event,resource,action,result,ip')
    expect(lines[1]).toContain('connection.created')
  })

  test('zero rows still returns a 200 with a header-only CSV, not an error', async () => {
    listAuditLogsImpl = mock(async () => [])

    const res = await handleGet(makeRequest())
    const body = await res.text()

    expect(res.status).toBe(200)
    expect(body).toBe('event_time,user_id,event,resource,action,result,ip')
  })

  test('emits its own audit.export self-log with action:"export"', async () => {
    await handleGet(makeRequest())

    expect(logEventImpl).toHaveBeenCalledTimes(1)
    expect(logEventImpl.mock.calls[0]?.[0]).toMatchObject({
      orgId: 'org_A',
      event: 'audit.export',
      action: 'export',
      result: 'success',
    })
  })
})
