/**
 * Tests for the D1-backed GitHub deployments store.
 *
 * Uses a small behavioral fake of D1Database (prepare/bind/run/all) injected
 * through a mocked @chm/platform, mirroring baseline-store.test.ts /
 * insights/store/d1-store.test.ts. Exercises the real SQL the store issues:
 * the upsert's `ON CONFLICT (id) DO UPDATE` — the idempotency guard required
 * by plans/45-github-deploy-correlation.md so a redelivered/duplicated
 * deployment.id updates in place rather than duplicating — the owner_scope +
 * time-range filtered read used by the chart overlay, and the best-effort
 * degrade when no binding is present.
 */
import type { DeploymentRecord } from './d1-store'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

interface FakeD1Row {
  id: string
  owner_scope: string
  repo: string
  environment: string | null
  ref: string | null
  sha: string | null
  version: string | null
  created_at: number
  received_at: number
}

function makeFakeD1() {
  const rows = new Map<string, FakeD1Row>()

  function bindsToRow(b: unknown[]): FakeD1Row {
    return {
      id: b[0] as string,
      owner_scope: b[1] as string,
      repo: b[2] as string,
      environment: b[3] as string | null,
      ref: b[4] as string | null,
      sha: b[5] as string | null,
      version: b[6] as string | null,
      created_at: b[7] as number,
      received_at: b[8] as number,
    }
  }

  function allFor(sql: string, binds: unknown[]) {
    let i = 0
    let scope: string | undefined
    let since: number | undefined
    let until: number | undefined
    if (sql.includes('owner_scope = ?')) scope = binds[i++] as string
    if (sql.includes('created_at >= ?')) since = binds[i++] as number
    if (sql.includes('created_at <= ?')) until = binds[i++] as number
    const limit = binds[i++] as number

    let out = [...rows.values()]
    if (scope !== undefined) out = out.filter((r) => r.owner_scope === scope)
    if (since !== undefined) out = out.filter((r) => r.created_at >= since)
    if (until !== undefined) out = out.filter((r) => r.created_at <= until)
    out = out.sort((a, b) => b.created_at - a.created_at).slice(0, limit)
    return { results: out }
  }

  function prepare(sql: string) {
    return {
      bind(...args: unknown[]) {
        return {
          async run() {
            const row = bindsToRow(args)
            rows.set(row.id, row)
            return { meta: { changes: 1 } }
          },
          async all() {
            return allFor(sql, args)
          },
        }
      },
    }
  }

  return { prepare, _rows: rows }
}

let currentDb: ReturnType<typeof makeFakeD1> | null = null

mock.module('@chm/platform', () => ({
  getPlatformBindings: () => ({
    getD1Database: () => currentDb,
  }),
}))

const { upsertDeployment, listDeployments } = await import('./d1-store')

function deployment(over: Partial<DeploymentRecord> = {}): DeploymentRecord {
  return {
    id: '1',
    ownerScope: 'default',
    repo: 'chmonitor/chmonitor',
    environment: 'production',
    ref: 'main',
    sha: 'abc123',
    version: 'v1.2.3',
    createdAt: 1_000_000,
    receivedAt: 1_000_100,
    ...over,
  }
}

beforeEach(() => {
  currentDb = makeFakeD1()
})

describe('github deployments d1-store', () => {
  test('upsert then list round-trips every field', async () => {
    expect(await upsertDeployment(deployment())).toBe(true)

    const rows = await listDeployments({ ownerScope: 'default' })
    expect(rows).toEqual([deployment()])
  })

  test('a redelivered deployment.id updates in place, not a duplicate row (idempotency)', async () => {
    await upsertDeployment(deployment({ environment: 'staging' }))
    await upsertDeployment(deployment({ environment: 'production' }))

    const rows = await listDeployments({ ownerScope: 'default' })
    expect(rows.length).toBe(1)
    expect(rows[0]?.environment).toBe('production')
  })

  test('listDeployments filters by time range (used by the chart overlay)', async () => {
    await upsertDeployment(deployment({ id: '1', createdAt: 1000 }))
    await upsertDeployment(deployment({ id: '2', createdAt: 2000 }))
    await upsertDeployment(deployment({ id: '3', createdAt: 3000 }))

    const rows = await listDeployments({ sinceMs: 1500, untilMs: 2500 })
    expect(rows.map((r) => r.id)).toEqual(['2'])
  })

  test('listDeployments only returns rows for the requested scope', async () => {
    await upsertDeployment(deployment({ id: '1', ownerScope: 'default' }))
    await upsertDeployment(deployment({ id: '2', ownerScope: 'other' }))

    expect(
      (await listDeployments({ ownerScope: 'default' })).map((r) => r.id)
    ).toEqual(['1'])
    expect(
      (await listDeployments({ ownerScope: 'other' })).map((r) => r.id)
    ).toEqual(['2'])
  })

  test('degrades to false/[] (never throws) when no D1 binding is present', async () => {
    currentDb = null

    expect(await upsertDeployment(deployment())).toBe(false)
    expect(await listDeployments()).toEqual([])
  })
})
