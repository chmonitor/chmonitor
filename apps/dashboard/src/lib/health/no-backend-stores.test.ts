/**
 * Alert-settings stores on a deployment with no metadata database (#4053).
 *
 * A valid self-hosted setup has neither a D1 binding nor a DATABASE_URL, so:
 *   - READS answer "nothing stored" without any warn/error log line;
 *   - WRITES still fail loudly, with a message that names DATABASE_URL before
 *     D1 (a self-hosted operator has no wrangler.toml);
 *   - a REAL backend failure still logs (reads) or throws (writes/lists).
 */

import { installHealthPlatformMock } from './__tests__/platform-mock'
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'

/** A D1 whose every statement rejects: a real backend failure. */
function makeThrowingD1() {
  const fail = async () => {
    throw new Error('boom: connection lost')
  }
  const statement = { bind: () => statement, all: fail, run: fail, first: fail }
  return { prepare: () => statement, batch: fail }
}

let currentDb: ReturnType<typeof makeThrowingD1> | null = null
installHealthPlatformMock(() => currentDb)

const { noBackendMessage } = await import('./no-backend-message')
const { listActiveAcks, clearAck, ackAlert } = await import('./alert-ack-store')
const { listDismissedSuggestionKeys, dismissSuggestion } = await import(
  './alert-suggestion-dismissals-store'
)
const { listCheckAlerts, renameCheckAlert } = await import(
  './check-alerts-store'
)
const { listQuietHours, createQuietHours } = await import('./quiet-hours')
const { listWindows, createWindow, deleteWindow } = await import(
  './maintenance-windows'
)
const { listPeerDBRules, savePeerDBRule, deletePeerDBRule } = await import(
  '@/lib/peerdb/alert-rules-store'
)

const PG_ENV = ['DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_PRISMA_URL'] as const
const SAVED = Object.fromEntries(PG_ENV.map((k) => [k, process.env[k]]))
let errorSpy: ReturnType<typeof spyOn<Console, 'error'>>
let warnSpy: ReturnType<typeof spyOn<Console, 'warn'>>

beforeEach(() => {
  for (const k of PG_ENV) delete process.env[k]
  currentDb = null
  errorSpy = spyOn(console, 'error').mockImplementation(() => {})
  warnSpy = spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  errorSpy.mockRestore()
  warnSpy.mockRestore()
  for (const k of PG_ENV) {
    const v = SAVED[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

/** The message names DATABASE_URL, and names it before the D1 binding. */
function expectEnvVarFirst(message: string) {
  expect(message).toContain('DATABASE_URL')
  expect(message.indexOf('DATABASE_URL')).toBeLessThan(message.indexOf('D1'))
  expect(message).not.toContain('wrangler')
}

const QUIET = {
  ownerId: 'o',
  days: [1],
  start: '22:00',
  end: '07:00',
  timezone: 'UTC',
  severityCap: null,
  createdBy: 'o',
}
const PEERDB_RULE = {
  id: 'r1',
  check: 'lag',
  matchKind: 'exact',
  match: 'm',
  warning: 1,
  critical: 2,
  severity: 'critical',
  enabled: true,
  muteUntil: null,
} as unknown as Parameters<typeof savePeerDBRule>[1]

describe('noBackendMessage', () => {
  test('names the env var before the D1 bindings it is given', () => {
    expectEnvVarFirst(noBackendMessage('Doing a thing'))
    expect(noBackendMessage('X', 'A_D1 or B_D1')).toContain('(A_D1 or B_D1)')
  })
})

describe('no backend: reads are quiet', () => {
  test('every read answers empty without a warn/error log', async () => {
    expect(await listActiveAcks('')).toEqual([])
    await clearAck('', 0, 'disk-usage')
    expect((await listDismissedSuggestionKeys('o')).size).toBe(0)
    const checks = await listCheckAlerts('o')
    expect(checks.length).toBeGreaterThan(0)
    expect(checks.every((c) => c.source === 'default')).toBe(true)
    expect(await listQuietHours('o')).toEqual([])
    expect(await listWindows('o')).toEqual([])
    expect(await listPeerDBRules('o')).toEqual([])
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

describe('no backend: writes still fail loudly, env var first', () => {
  test('ackAlert', async () => {
    const err = await ackAlert({
      ownerId: '',
      hostId: 0,
      ruleId: 'disk-usage',
      durationKey: '5m',
      ackedBy: 'a',
    }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expectEnvVarFirst((err as Error).message)
  })

  test('dismissSuggestion', async () => {
    const err = await dismissSuggestion('o', 'k').catch((e: Error) => e)
    expect((err as { code?: string }).code).toBe('NOT_CONFIGURED')
    expectEnvVarFirst((err as Error).message)
  })

  test('renameCheckAlert', async () => {
    const err = await renameCheckAlert('o', 'max-parts', 'Parts').catch(
      (e: Error) => e
    )
    expect((err as { code?: string }).code).toBe('NOT_CONFIGURED')
    expectEnvVarFirst((err as Error).message)
  })

  test('createQuietHours', async () => {
    const err = await createQuietHours(QUIET).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expectEnvVarFirst((err as Error).message)
    expect((err as Error).message).toContain('MAINTENANCE_D1')
  })

  test('createWindow and deleteWindow', async () => {
    const created = await createWindow({
      ownerId: 'o',
      hostId: 0,
      reason: 'r',
      startsAt: 1,
      endsAt: 2,
      createdBy: 'o',
    }).catch((e: Error) => e)
    expectEnvVarFirst((created as Error).message)
    const deleted = await deleteWindow('o', 'id').catch((e: Error) => e)
    expectEnvVarFirst((deleted as Error).message)
  })

  test('savePeerDBRule and deletePeerDBRule', async () => {
    const saved = await savePeerDBRule('o', PEERDB_RULE).catch((e: Error) => e)
    expectEnvVarFirst((saved as Error).message)
    const deleted = await deletePeerDBRule('o', 'r1').catch((e: Error) => e)
    expectEnvVarFirst((deleted as Error).message)
  })
})

describe('real backend failure is not hidden', () => {
  test('best-effort reads log a warning (ack, quiet hours, windows, peerdb)', async () => {
    currentDb = makeThrowingD1()
    expect(await listActiveAcks('')).toEqual([])
    expect(await listQuietHours('o-fail')).toEqual([])
    expect(await listWindows('o-fail')).toEqual([])
    expect(await listPeerDBRules('o-fail')).toEqual([])
    expect(warnSpy.mock.calls.length).toBeGreaterThanOrEqual(4)
  })

  test('check-alert list throws STORAGE_ERROR instead of showing defaults', async () => {
    currentDb = makeThrowingD1()
    const err = await listCheckAlerts('o').catch((e: Error) => e)
    expect((err as { code?: string }).code).toBe('STORAGE_ERROR')
  })

  test('dismissal write throws STORAGE_ERROR', async () => {
    currentDb = makeThrowingD1()
    const err = await dismissSuggestion('o', 'k').catch((e: Error) => e)
    expect((err as { code?: string }).code).toBe('STORAGE_ERROR')
  })
})
