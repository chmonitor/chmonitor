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
import type { EffectiveCustomWebhookTarget } from '../../custom-webhook-config'
import type { DispatchCounters } from './types'

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

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
mock.module('../../alert-history-store', () => ({
  recordAlertEvent: async () => {},
}))
mock.module('@/lib/slack/config', () => ({
  isSlackAppConfigured: () => false,
}))

const { createDigestPipeline } = await import('./digest')
const { buildCustomTargetBody } = await import('../../custom-webhook-targets')

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

// Stub fetch rather than mocking ./webhook-post: a module mock would leak into
// webhook-post.test.ts when both run in one process.
const originalFetch = globalThis.fetch
const stubFetch = (async (input: RequestInfo | URL) => {
  posts.push({ url: String(input), ok: webhookOk })
  return new Response(null, { status: webhookOk ? 204 : 500 })
}) as typeof fetch

beforeEach(() => {
  rows = []
  posts.length = 0
  webhookOk = true
  globalThis.fetch = stubFetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
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
/**
 * Hookshot / Matrix custom targets group per sweep (#3869). A room that gets
 * one message per finding during an incident is unreadable, so N findings for
 * one target must become ONE post; a lone finding must keep the exact
 * per-finding body; and a time-window warning must still reach the target in
 * the same pass (custom targets carry secret headers, so they never go to D1).
 */
describe('grouped custom webhook targets', () => {
  const HOOK = 'https://93.184.216.34/hookshot/abc'
  const target = {
    id: 'cwt_hook',
    name: 'room',
    url: HOOK,
    enabled: true,
    format: 'hookshot' as const,
    minSeverity: null,
    titleTemplate: '',
    bodyTemplate: '',
    headers: {},
    secretHeaders: { Authorization: 'Bearer s3cret' },
    updatedAt: 0,
    source: 'env',
    editable: false,
  } as never as EffectiveCustomWebhookTarget

  const bodies: { url: string; body: unknown }[] = []
  beforeEach(() => {
    bodies.length = 0
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      bodies.push({ url: String(input), body: JSON.parse(String(init?.body)) })
      return new Response(null, { status: 204 })
    }) as typeof fetch
  })

  function settle(
    pipeline: Awaited<ReturnType<typeof createDigestPipeline>>,
    opts: {
      hostId: number
      severity: 'warning' | 'critical'
      onCommit: () => void
      webhooks?: string[]
    }
  ) {
    const p = {
      ...payload,
      severity: opts.severity,
      hostId: opts.hostId,
      hostLabel: `h${opts.hostId}`,
    }
    return pipeline.settleFinding({
      finding: {
        hostId: opts.hostId,
        hostLabel: p.hostLabel,
        ruleId: 'disk-usage',
        effective: opts.severity,
        isRecovery: false,
        decision: { kind: 'fire' },
        text: `disk ${opts.hostId}`,
      } as never,
      commit: opts.onCommit,
      anyDelivered: false,
      groupableWebhookTargets: opts.webhooks ?? [],
      findingTelegramTargets: [],
      groupableCustomTargets: [target],
      immediateTargetCount: 0,
      webhookPayload: p as never,
    })
  }

  test('three findings send one grouped post to the target', async () => {
    let committed = 0
    const pipeline = await createDigestPipeline(
      { digestWindowMs: 0 } as never,
      newCounters()
    )
    for (const hostId of [0, 1, 2]) {
      await settle(pipeline, {
        hostId,
        severity: 'critical',
        onCommit: () => committed++,
      })
    }
    expect(bodies).toHaveLength(0)
    await pipeline.flushDigests()
    expect(bodies.map((b) => b.url)).toEqual([HOOK])
    const body = bodies[0].body as { text: string; html: string }
    expect(body.text).toContain('3 critical on 3 hosts')
    expect(committed).toBe(3)
  })

  test('a lone finding sends the exact per-finding body', async () => {
    const pipeline = await createDigestPipeline(
      { digestWindowMs: 0 } as never,
      newCounters()
    )
    await settle(pipeline, {
      hostId: 4,
      severity: 'critical',
      onCommit: () => {},
    })
    await pipeline.flushDigests()
    const expected = buildCustomTargetBody(
      target,
      { ...payload, severity: 'critical', hostId: 4, hostLabel: 'h4' },
      'disk 4'
    ).body
    expect(bodies).toEqual([{ url: HOOK, body: expected }])
  })

  test('a buffered warning still reaches the target this pass, once', async () => {
    let committed = 0
    const counters = newCounters()
    const pipeline = await createDigestPipeline(ctx, counters)
    for (const hostId of [0, 1]) {
      await settle(pipeline, {
        hostId,
        severity: 'warning',
        onCommit: () => committed++,
        webhooks: [URL],
      })
    }
    await pipeline.flushDigests()
    // The plain webhook entries are parked in D1; the custom target is not.
    expect(rows.map((r) => r.entry.kind)).toEqual(['webhook', 'webhook'])
    expect(JSON.stringify(rows)).not.toContain('s3cret')
    expect(counters.digestBuffered).toBe(2)
    expect(bodies.map((b) => b.url)).toEqual([HOOK])
    expect((bodies[0].body as { text: string }).text).toContain(
      '2 warning on 2 hosts'
    )
    // Each finding committed exactly once (at buffer time).
    expect(committed).toBe(2)
  })

  test('a warning routed only to the custom target is sent in-pass', async () => {
    let committed = 0
    const counters = newCounters()
    const pipeline = await createDigestPipeline(ctx, counters)
    await settle(pipeline, {
      hostId: 0,
      severity: 'warning',
      onCommit: () => committed++,
    })
    await pipeline.flushDigests()
    expect(rows).toEqual([])
    expect(bodies.map((b) => b.url)).toEqual([HOOK])
    expect(committed).toBe(1)
    expect(counters.alertsDispatched).toBe(1)
  })

  test('a failed grouped send leaves the in-pass finding uncommitted', async () => {
    globalThis.fetch = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof fetch
    let committed = 0
    const pipeline = await createDigestPipeline(
      { digestWindowMs: 0 } as never,
      newCounters()
    )
    await settle(pipeline, {
      hostId: 0,
      severity: 'critical',
      onCommit: () => committed++,
    })
    await pipeline.flushDigests()
    expect(committed).toBe(0)
  })
})
