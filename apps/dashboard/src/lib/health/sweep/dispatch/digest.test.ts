/**
 * Time-window digest delivery must survive a failed flush.
 *
 * Buffering commits the finding's dedup (so the next sweep does not re-buffer
 * the same condition) and the flush *takes* the rows out of the buffer. If the
 * flush send then failed, the alert was gone for good: never delivered and
 * never re-raised. The flush now parks failed entries again, due now, so the
 * next sweep re-sends them.
 */

import type { BufferedDigestEntry } from '../../alert-digest-buffer-store'
import type { DispatchCounters } from './types'

import { beforeEach, describe, expect, mock, test } from 'bun:test'

/** In-memory stand-in for the D1 buffer table. */
let rows: { flushAfter: number; entry: BufferedDigestEntry }[] = []
/** Every URL posted to, plus whether the send succeeded. */
const posts: { url: string; ok: boolean }[] = []
let webhookOk = true

mock.module('../../alert-digest-buffer-store', () => ({
  bufferDigestEntries: async (
    _owner: string,
    entries: readonly BufferedDigestEntry[],
    flushAfter: number
  ) => {
    if (entries.length === 0) return false
    for (const entry of entries) rows.push({ flushAfter, entry })
    return true
  },
  takeDueDigestEntries: async (_owner: string, now: number) => {
    const due = rows.filter((r) => r.flushAfter <= now)
    rows = rows.filter((r) => r.flushAfter > now)
    return due.map((r) => r.entry)
  },
}))
mock.module('./webhook-post', () => ({
  postWebhook: async (url: string) => {
    posts.push({ url, ok: webhookOk })
    return webhookOk ? { ok: true } : { ok: false, error: 'HTTP 500' }
  },
}))
mock.module('../../alert-history-store', () => ({
  recordAlertEvent: async () => {},
}))
mock.module('@/lib/slack/config', () => ({
  isSlackAppConfigured: () => false,
}))

const { createDigestPipeline } = await import('./digest')

const URL = 'https://hooks.example.com/alerts'
const ctx = { digestWindowMs: 1 } as unknown as Parameters<
  typeof createDigestPipeline
>[0]

const newCounters = (): DispatchCounters => ({
  alertsDispatched: 0,
  alertsSuppressed: 0,
  maintenanceSuppressed: 0,
  quietHoursSuppressed: 0,
  ackedSuppressed: 0,
  recoveries: 0,
  emailsDispatched: 0,
  digestBuffered: 0,
  digestFlushed: 0,
})

const payload = {
  severity: 'warning' as const,
  hostLabel: 'h',
  hostId: 0,
  metric: 'disk-usage',
  value: 90,
  title: 'Disk usage',
  label: '90%',
  timestamp: new Date(0).toISOString(),
}

const waitPastWindow = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  rows = []
  posts.length = 0
  webhookOk = true
})

describe('time-window digest flush', () => {
  test('a failed flush send is re-buffered and re-sent next sweep', async () => {
    // Sweep 1: a warning is buffered; its dedup commits at buffer time.
    let committed = 0
    const first = await createDigestPipeline(ctx, newCounters())
    await first.settleFinding({
      finding: {
        hostId: 0,
        ruleId: 'disk-usage',
        effective: 'warning',
        isRecovery: false,
        decision: { kind: 'fire' },
        text: 'disk 90%',
      } as never,
      commit: () => {
        committed++
      },
      anyDelivered: false,
      groupableWebhookTargets: [URL],
      findingTelegramTargets: [],
      immediateTargetCount: 0,
      webhookPayload: payload as never,
    })
    await first.flushDigests()
    expect(committed).toBe(1)
    expect(posts).toEqual([])
    expect(rows).toHaveLength(1)

    // Sweep 2: window closed, flush send fails. The entry must not be lost.
    await waitPastWindow()
    webhookOk = false
    const second = await createDigestPipeline(ctx, newCounters())
    await second.flushDigests()
    expect(posts).toEqual([{ url: URL, ok: false }])
    expect(rows).toHaveLength(1)

    // Sweep 3: the webhook recovers and the alert finally goes out, once.
    await waitPastWindow()
    webhookOk = true
    const third = await createDigestPipeline(ctx, newCounters())
    await third.flushDigests()
    expect(posts).toEqual([
      { url: URL, ok: false },
      { url: URL, ok: true },
    ])
    expect(rows).toEqual([])
  })

  test('a successful flush send is not re-buffered', async () => {
    rows.push({
      flushAfter: 0,
      entry: {
        kind: 'webhook',
        url: URL,
        text: 't',
        payload: payload as never,
      },
    })
    const pipeline = await createDigestPipeline(ctx, newCounters())
    await pipeline.flushDigests()
    expect(posts).toEqual([{ url: URL, ok: true }])
    expect(rows).toEqual([])
  })
})
