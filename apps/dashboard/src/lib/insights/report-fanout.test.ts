/**
 * runReportFanout (#3801): shared host builds are memoized (one build + one
 * persist per host even for concurrent owners), deliveries run with bounded
 * concurrency, one failing owner never stops the others, and
 * recordReportDelivery still runs after that owner's delivery.
 */

import { describe, expect, mock, test } from 'bun:test'
import { BILLING_PLANS } from '@chm/pricing'

mock.module('cloudflare:workers', () => ({ env: {} }))

const events: string[] = []
let subscriptions: Array<{
  ownerId: string
  hostIds: number[]
}> = []
let inFlight = 0
let maxInFlight = 0

const buildWeeklyReport = mock(async (hostId: number) => {
  await new Promise((r) => setTimeout(r, 2))
  return {
    summary: { weekStart: 'w', hostLabel: `h${hostId}` },
    markdown: 'md',
    html: '<p/>',
  }
})
const persistWeeklyReport = mock(async (_row: unknown) => {})
const deliverReport = mock(async (ownerId: string) => {
  events.push(`deliver:${ownerId}`)
  inFlight += 1
  maxInFlight = Math.max(maxInFlight, inFlight)
  await new Promise((r) => setTimeout(r, 3))
  inFlight -= 1
  if (ownerId === 'bad') throw new Error('channel down')
  return { delivered: true }
})
const recordReportDelivery = mock(async (ownerId: string, _status: string) => {
  events.push(`record:${ownerId}`)
})

mock.module('@/lib/insights/report-subscription-store', () => ({
  listSubscriptionsByCadence: async () => subscriptions,
  recordReportDelivery: (o: string, s: string) => recordReportDelivery(o, s),
}))
mock.module('@/lib/insights/weekly-report', () => ({
  buildWeeklyReport: (h: number) => buildWeeklyReport(h),
  buildFleetMarkdown: () => 'fleet',
}))
mock.module('@/lib/insights/weekly-report-store', () => ({
  persistWeeklyReport: (r: unknown) => persistWeeklyReport(r),
}))
mock.module('@/lib/insights/report-delivery', () => ({
  deliverReport: (o: string) => deliverReport(o),
  formatDeliveryStatus: () => 'ok',
}))
mock.module('@/lib/insights/report-pdf', () => ({
  hasBrowserBinding: () => false,
  renderReportPdf: async () => null,
  reportPdfFilename: () => 'x.pdf',
}))
mock.module('@/lib/insights/fleet-report-html', () => ({
  renderFleetReportHtml: () => '<p/>',
}))
mock.module('@/lib/api/clickhouse-config', () => ({
  getClickHouseConfigsFromEnv: () => [
    { id: 0, host: 'http://a', customName: 'a' },
    { id: 1, host: 'http://b', customName: 'b' },
  ],
}))
mock.module('@/lib/billing/user-subscription', () => ({
  getPlanForOwner: async (ownerId: string) => {
    if (ownerId === 'plan-error') throw new Error('plan lookup failed')
    return BILLING_PLANS.pro
  },
}))

const { runReportFanout } = await import('./report-fanout')

describe('runReportFanout', () => {
  test('builds each shared host once, bounds delivery concurrency, isolates failures, records after delivery', async () => {
    events.length = 0
    maxInFlight = 0
    subscriptions = [
      { ownerId: 'o1', hostIds: [0] },
      { ownerId: 'bad', hostIds: [0, 1] },
      { ownerId: 'plan-error', hostIds: [0] },
      { ownerId: 'o2', hostIds: [1] },
      { ownerId: 'o3', hostIds: [0] },
      { ownerId: 'o4', hostIds: [1] },
      { ownerId: 'o5', hostIds: [0] },
      { ownerId: 'o6', hostIds: [1] },
    ]

    const results = await runReportFanout('weekly', {})

    // one build + one persist per distinct host, despite 7 owners sharing them
    expect(buildWeeklyReport).toHaveBeenCalledTimes(2)
    expect(persistWeeklyReport).toHaveBeenCalledTimes(2)

    // results keep subscription order; failures are isolated
    expect(results.map((r) => r.ownerId)).toEqual(
      subscriptions.map((s) => s.ownerId)
    )
    expect(results.find((r) => r.ownerId === 'bad')?.status).toBe('error')
    expect(results.find((r) => r.ownerId === 'plan-error')?.status).toBe(
      'error'
    )
    for (const id of ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']) {
      expect(results.find((r) => r.ownerId === id)?.delivered).toBe(true)
    }

    // bounded, but actually parallel
    expect(maxInFlight).toBeGreaterThan(1)
    expect(maxInFlight).toBeLessThanOrEqual(4)

    // recordReportDelivery only after that owner's delivery; never for a
    // failed delivery
    for (const id of ['o1', 'o2', 'o3', 'o4', 'o5', 'o6']) {
      expect(events.indexOf(`deliver:${id}`)).toBeLessThan(
        events.indexOf(`record:${id}`)
      )
    }
    expect(events).not.toContain('record:bad')
  })
})
