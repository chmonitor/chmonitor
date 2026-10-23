/**
 * Repeats thread under an episode's first message (#4049): a reminder, an
 * escalation and the recovery reply to the first alert on native Matrix
 * (`m.thread`) and Telegram (`reply_parameters`); the recovery ends the
 * episode, so the next first alert starts a new thread. Drives the real
 * dispatcher against a real SQLite table built from the D1 migration.
 */

import type { SweepContext } from '../resolve-config'

import { installHealthPlatformMock } from '../../__tests__/platform-mock'
import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

mock.module('../../alert-history-store', () => ({
  recordAlertEvent: async () => {},
}))

/** The `prepare → bind → all/run` subset of D1 the thread store uses. */
function sqliteD1(db: Database) {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const params = args as (string | number)[]
          return {
            async all() {
              return {
                results: db.query(sql).all(...params),
                success: true,
                meta: {},
              }
            },
            async run() {
              const r = db.query(sql).run(...params)
              return { success: true, meta: { changes: r.changes } }
            },
          }
        },
      }
    },
  }
}

let sqlite: Database | null = null
installHealthPlatformMock(() => (sqlite ? sqliteD1(sqlite) : null))

const { createDispatcher } = await import('./index')
const { alertStateStore } = await import('../../alert-state-store')

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../db/conversations-migrations/0039_alert_thread_roots.sql',
      import.meta.url
    )
  ),
  'utf8'
)

interface Sent {
  url: string
  body: Record<string, unknown>
}
const realFetch = globalThis.fetch
let sent: Sent[] = []
let nextId = 100

beforeEach(() => {
  sent = []
  alertStateStore.clear()
  sqlite = new Database(':memory:')
  sqlite.run(MIGRATION)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    sent.push({ url, body: JSON.parse(String(init?.body)) })
    const id = nextId++
    return new Response(
      url.includes('api.telegram.org')
        ? JSON.stringify({ ok: true, result: { message_id: id } })
        : JSON.stringify({ event_id: `$ev${id}` }),
      { status: 200 }
    )
  }) as typeof fetch
})

afterEach(() => {
  globalThis.fetch = realFetch
  sqlite = null
})

function makeCtx(channels: Partial<SweepContext['channels']>): SweepContext {
  return {
    settings: {
      webhookUrl: '',
      webhookEnabled: false,
      healthchecksUrl: '',
      browserNotificationsEnabled: false,
      minSeverity: 'warning',
    },
    routes: [],
    pagerDutyFallbackKey: '',
    channels: {
      webhookUrl: '',
      webhookUrlTrusted: true,
      healthchecksUrl: '',
      opsgenie: null,
      email: null,
      telegram: null,
      ntfy: null,
      pushover: null,
      matrix: null,
      twilio: null,
      channelSettings: {},
      ...channels,
    },
    channelSettings: {},
    alertingEnabled: true,
    // 1 ms cooldown (`tick` waits longer): every still-firing sweep reminds.
    cooldown: { defaultMs: 1, bySeverity: {}, byRule: {} },
    repeatMinDelta: { default: null, byRule: {} },
    repeatBackoffMaxMs: null,
    mutedRules: [],
    enabledRules: [],
    notifyRules: [],
    rules: [],
    thresholdOverrides: {} as SweepContext['thresholdOverrides'],
    hysteresis: {
      defaults: { minConsecutiveBreaches: 1, minConsecutiveClears: 1 },
      byRule: {},
    },
    orderedCompoundRules: [],
    configs: [],
    windows: [],
    quietHours: [],
    digestWindowMs: 0,
    acks: [],
  }
}

const MATRIX = {
  matrix: {
    homeserverUrl: 'https://matrix.example.test',
    accessToken: 'syt_env',
    roomId: '!env:example.test',
  },
}
const TELEGRAM = { telegram: { botToken: '123:abc', chatId: '-100' } }

async function tick(
  ctx: SweepContext,
  severity: 'warning' | 'critical' | 'ok',
  hostIds: number[] = [1],
  ruleId = 'thread-test'
) {
  await Bun.sleep(5)
  const dispatcher = await createDispatcher(ctx)
  for (const hostId of hostIds) {
    await dispatcher.dispatchFinding({
      hostId,
      hostName: `ch-${hostId}`,
      ruleId,
      ruleType: 'threshold',
      ruleTitle: 'Thread test',
      severity,
      value: severity === 'ok' ? 1 : 99,
      label: 'too high',
    })
  }
  await dispatcher.flushDigests()
  await dispatcher.flushBusEvents()
  const out = sent
  sent = []
  return out
}

const relation = (s: Sent) => s.body['m.relates_to']
const reply = (s: Sent) => s.body.reply_parameters
const rootRows = () =>
  sqlite?.query('SELECT root_id FROM alert_thread_roots').all() ?? []

describe('Matrix: repeats thread under the first alert', () => {
  test('reminder, escalation and recovery reply in the root thread; recovery clears it', async () => {
    const ctx = makeCtx(MATRIX)
    const [first] = await tick(ctx, 'warning')
    expect(relation(first)).toBeUndefined()
    const rootId = `$ev${nextId - 1}`
    expect(rootRows()).toEqual([{ root_id: rootId }])

    const thread = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    }
    const [reminder] = await tick(ctx, 'warning')
    expect(relation(reminder)).toEqual(thread)
    const [escalated] = await tick(ctx, 'critical')
    expect(relation(escalated)).toEqual(thread)
    const [recovery] = await tick(ctx, 'ok')
    expect(recovery.body.body).toContain('RESOLVED')
    expect(relation(recovery)).toEqual(thread)
    expect(rootRows()).toEqual([])

    // The next episode starts its own thread.
    const [next] = await tick(ctx, 'warning')
    expect(relation(next)).toBeUndefined()
    expect(rootRows()).toEqual([{ root_id: `$ev${nextId - 1}` }])
  })

  test('a digest of several findings stays top-level and starts no thread', async () => {
    const ctx = makeCtx(MATRIX)
    const [digest] = await tick(ctx, 'critical', [1, 2])
    expect(relation(digest)).toBeUndefined()
    expect(rootRows()).toEqual([])
  })

  test('a recovery that was never sent cannot leak into the next episode', async () => {
    const ctx = makeCtx(MATRIX)
    await tick(ctx, 'warning')
    const staleRoot = `$ev${nextId - 1}`
    // Recovery dropped without a send (muted rule): the row stays behind.
    await tick({ ...ctx, mutedRules: ['thread-test'] }, 'ok')
    const [next] = await tick(ctx, 'warning')
    expect(relation(next)).toBeUndefined()
    expect(rootRows()).not.toContainEqual({ root_id: staleRoot })
  })

  test('a new episode that first reaches a room as an escalation starts a new thread', async () => {
    // Critical-only room: the episode's 'new' warning never reaches it, so the
    // escalation is its first message there.
    const ctx: SweepContext = {
      ...makeCtx(MATRIX),
      channelSettings: { matrix: { minSeverity: 'critical' } },
    }
    await tick(ctx, 'warning')
    const [firstCritical] = await tick(ctx, 'critical')
    expect(relation(firstCritical)).toBeUndefined()
    // Recovery dropped without a send (muted rule): the root stays behind.
    await tick({ ...ctx, mutedRules: ['thread-test'] }, 'ok')

    expect(await tick(ctx, 'warning')).toEqual([])
    const [nextCritical] = await tick(ctx, 'critical')
    expect(relation(nextCritical)).toBeUndefined()
    expect(rootRows()).toEqual([{ root_id: `$ev${nextId - 1}` }])
  })

  test('a threaded send the homeserver rejects drops the root so the retry goes top-level', async () => {
    const ctx = makeCtx(MATRIX)
    await tick(ctx, 'warning')
    const okFetch = globalThis.fetch
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      sent.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response('{"errcode":"M_UNKNOWN"}', { status: 400 })
    }) as typeof fetch
    const [rejected] = await tick(ctx, 'warning')
    expect(relation(rejected)).toBeDefined()
    globalThis.fetch = okFetch
    const [retry] = await tick(ctx, 'warning')
    expect(relation(retry)).toBeUndefined()
  })

  test('with no metadata DB every message stays top-level', async () => {
    const ctx = makeCtx(MATRIX)
    sqlite = null
    await tick(ctx, 'warning')
    const [reminder] = await tick(ctx, 'warning')
    expect(relation(reminder)).toBeUndefined()
  })
})

describe('Telegram: repeats reply to the first alert', () => {
  test('reminder and recovery reply to the first message_id; recovery clears it', async () => {
    const ctx = makeCtx(TELEGRAM)
    const [first] = await tick(ctx, 'critical')
    expect(reply(first)).toBeUndefined()
    const rootId = nextId - 1

    const expected = { message_id: rootId, allow_sending_without_reply: true }
    const [reminder] = await tick(ctx, 'critical')
    expect(reply(reminder)).toEqual(expected)
    const [recovery] = await tick(ctx, 'ok')
    expect(reply(recovery)).toEqual(expected)
    expect(rootRows()).toEqual([])
  })

  test('no bot token or chat id is stored', async () => {
    await tick(makeCtx(TELEGRAM), 'critical')
    const dump = JSON.stringify(
      sqlite?.query('SELECT * FROM alert_thread_roots').all()
    )
    expect(dump).not.toContain('123:abc')
    expect(dump).not.toContain('-100')
  })
})
