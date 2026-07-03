/**
 * Unit tests for logEvent.ts — the audit-log writer.
 *
 * Uses a minimal in-memory D1 fake injected via mock.module('@chm/platform'),
 * the same pattern as lib/billing/ai-usage-store.test.ts, so the real INSERT
 * SQL is exercised without requiring a Cloudflare Workers runtime.
 *
 * These tests encode the plan's non-negotiable invariants directly:
 * - audit is enterprise-only (community must never write a row)
 * - org scoping is mandatory (an empty orgId must never write a row)
 * - a D1 failure must never throw into the caller (audit is observational)
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface InsertedRow {
  id: string
  event_time: string
  org_id: string
  user_id: string | null
  event: string
  resource: string | null
  action: string
  result: string
  ip: string | null
  metadata: string | null
}

let inserted: InsertedRow[] = []
let prepareCalls = 0
let shouldThrow = false
let dbAvailable = true

function fakeD1() {
  return {
    prepare(_sql: string) {
      prepareCalls++
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (shouldThrow) throw new Error('D1 write failed')
              const [
                id,
                event_time,
                org_id,
                user_id,
                event,
                resource,
                action,
                result,
                ip,
                metadata,
              ] = values as [
                string,
                string,
                string,
                string | null,
                string,
                string | null,
                string,
                string,
                string | null,
                string | null,
              ]
              inserted.push({
                id,
                event_time,
                org_id,
                user_id,
                event,
                resource,
                action,
                result,
                ip,
                metadata,
              })
              return { success: true, results: [], meta: {} }
            },
          }
        },
      }
    },
  }
}

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => (dbAvailable ? fakeD1() : null),
  }),
}))

const { logEvent } = await import('./logEvent')

const ENTERPRISE = { CHM_EDITION: 'enterprise' }
const COMMUNITY = { CHM_EDITION: 'community' }

function baseEvent(overrides: Partial<Parameters<typeof logEvent>[0]> = {}) {
  return {
    orgId: 'org_1',
    userId: 'user_1',
    event: 'member.invited',
    resource: 'user_2',
    action: 'invite' as const,
    result: 'success' as const,
    ...overrides,
  }
}

beforeEach(() => {
  inserted = []
  prepareCalls = 0
  shouldThrow = false
  dbAvailable = true
})

describe('logEvent — fail-open gates', () => {
  test('no-ops in community edition; D1 is never touched', async () => {
    await logEvent(baseEvent(), { runtimeEnv: COMMUNITY })
    expect(prepareCalls).toBe(0)
    expect(inserted).toHaveLength(0)
  })

  test('no-ops when orgId is empty, even in enterprise — org scoping is mandatory', async () => {
    await logEvent(baseEvent({ orgId: '' }), { runtimeEnv: ENTERPRISE })
    expect(prepareCalls).toBe(0)
  })

  test('resolves without throwing when the D1 binding is unavailable', async () => {
    dbAvailable = false
    await expect(
      logEvent(baseEvent(), { runtimeEnv: ENTERPRISE })
    ).resolves.toBeUndefined()
    expect(inserted).toHaveLength(0)
  })
})

describe('logEvent — success path (enterprise + D1 available)', () => {
  test('inserts exactly one row with the given fields', async () => {
    await logEvent(baseEvent(), { runtimeEnv: ENTERPRISE })

    expect(inserted).toHaveLength(1)
    const row = inserted[0] as InsertedRow
    expect(row.org_id).toBe('org_1')
    expect(row.user_id).toBe('user_1')
    expect(row.event).toBe('member.invited')
    expect(row.resource).toBe('user_2')
    expect(row.action).toBe('invite')
    expect(row.result).toBe('success')
  })

  test('id is a valid UUID and event_time is a recent ISO-8601 UTC timestamp', async () => {
    const before = Date.now()
    await logEvent(baseEvent(), { runtimeEnv: ENTERPRISE })
    const after = Date.now()

    const row = inserted[0] as InsertedRow
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
    const ts = Date.parse(row.event_time)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(after)
  })

  test('optional fields (userId, resource, ip, metadata) default to null when omitted', async () => {
    await logEvent(
      { orgId: 'org_1', event: 'x', action: 'create', result: 'success' },
      { runtimeEnv: ENTERPRISE }
    )

    const row = inserted[0] as InsertedRow
    expect(row.user_id).toBeNull()
    expect(row.resource).toBeNull()
    expect(row.ip).toBeNull()
    expect(row.metadata).toBeNull()
  })

  test('metadata is JSON-stringified for storage', async () => {
    await logEvent(baseEvent({ metadata: { a: 1, b: 'two' } }), {
      runtimeEnv: ENTERPRISE,
    })

    const row = inserted[0] as InsertedRow
    expect(JSON.parse(row.metadata as string)).toEqual({ a: 1, b: 'two' })
  })
})

describe('logEvent — swallow-on-error', () => {
  test('a D1 write failure resolves (never throws) — audit must never break the caller', async () => {
    shouldThrow = true
    await expect(
      logEvent(baseEvent(), { runtimeEnv: ENTERPRISE })
    ).resolves.toBeUndefined()
  })
})
