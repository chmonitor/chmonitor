/**
 * Per-owner scheduled report fan-out (#2786).
 *
 * Runs from the weekly/monthly cron AFTER the legacy host-keyed env opt-in
 * (`CHM_WEEKLY_REPORT_HOSTS` webhook flow, which stays untouched for OSS).
 * For every `report_subscriptions` row with the matching cadence it builds a
 * report per subscribed env host, persists it, delivers it to the owner's
 * configured alert channels, and records a compact delivery audit.
 *
 * Plan gate (#2791): weekly cadence is a paid feature for cloud owners — a
 * subscription left on 'weekly' after a downgrade to Free is skipped (never
 * silently switched). OSS single-tenant ('' owner) is never plan-gated.
 * Fail-open like the rest of the insights pipeline: one owner/host failing
 * never aborts the others.
 */

import type { ReportPeriod } from './types'

import { renderFleetReportHtml } from './fleet-report-html'
import { deliverReport, formatDeliveryStatus } from './report-delivery'
import {
  hasBrowserBinding,
  renderReportPdf,
  reportPdfFilename,
} from './report-pdf'
import {
  listSubscriptionsByCadence,
  recordReportDelivery,
} from './report-subscription-store'
import {
  buildFleetMarkdown,
  buildWeeklyReport,
  type WeeklyReport,
} from './weekly-report'
import { persistWeeklyReport } from './weekly-report-store'
import { warn } from '@chm/logger'
import { getClickHouseConfigsFromEnv } from '@/lib/api/clickhouse-config'
import { hasCapability } from '@/lib/billing/entitlements'
import { getPlanForOwner } from '@/lib/billing/user-subscription'
import { getHost } from '@/lib/utils'
import { mapWithConcurrency } from '@/lib/utils/map-with-concurrency'

/** Max owner deliveries in flight — bounds Clerk/D1/ClickHouse/channel subrequests. */
const DELIVERY_CONCURRENCY = 4

export interface FanoutOwnerResult {
  readonly ownerId: string
  readonly hosts: number[]
  readonly delivered: boolean
  readonly status: string
  readonly skipped?: 'plan' | 'no-hosts'
}

/** True when `plan` may receive weekly (vs monthly-only) scheduled reports. */
export function weeklyReportsAllowed(planId: string): boolean {
  return planId !== 'free'
}

export async function runReportFanout(
  period: ReportPeriod,
  bindings: Record<string, string | undefined>
): Promise<FanoutOwnerResult[]> {
  const subscriptions = await listSubscriptionsByCadence(period)
  if (subscriptions.length === 0) return []

  const configs = getClickHouseConfigsFromEnv(bindings)
  const byId = new Map(configs.map((c) => [c.id, c]))
  // Reports are per-host but delivery is per-owner; memoize the build promise
  // so owners subscribed to the same host share ONE build (and one persist)
  // even when they run concurrently.
  const reportCache = new Map<number, Promise<WeeklyReport>>()
  const buildAndPersist = (hostId: number): Promise<WeeklyReport> => {
    let pending = reportCache.get(hostId)
    if (!pending) {
      const cfg = byId.get(hostId)
      const label =
        cfg?.customName || getHost(cfg?.host ?? '') || `Host ${hostId}`
      pending = (async () => {
        const report = await buildWeeklyReport(hostId, label, period)
        await persistWeeklyReport({
          hostId: String(hostId),
          weekStart: report.summary.weekStart,
          summaryJson: JSON.stringify(report.summary),
          html: report.html,
          delivered: false,
          generatedAt: Date.now(),
        })
        return report
      })()
      reportCache.set(hostId, pending)
    }
    return pending
  }

  // PDF attachment (#2794) needs a Browser Rendering binding; render only when
  // present (Cloud). OSS/self-hosted has no binding → HTML-only, unchanged.
  const browserAvailable = hasBrowserBinding(
    bindings as unknown as Record<string, unknown>
  )

  const processSubscription = async (
    sub: (typeof subscriptions)[number]
  ): Promise<FanoutOwnerResult> => {
    try {
      // PDF is a Pro+ (`data_export`) perk; resolve the owner's plan once and
      // reuse it for both the weekly-cadence gate and the PDF-attachment gate.
      const plan =
        sub.ownerId !== '' ? await getPlanForOwner(sub.ownerId) : null

      if (period === 'weekly' && plan && !weeklyReportsAllowed(plan.id)) {
        return {
          ownerId: sub.ownerId,
          hosts: [],
          delivered: false,
          status: 'skipped:plan',
          skipped: 'plan',
        }
      }

      const attachPdf =
        browserAvailable && plan != null && hasCapability(plan, 'data_export')

      const hosts = sub.hostIds.filter((id) => byId.has(id))
      if (hosts.length === 0) {
        return {
          ownerId: sub.ownerId,
          hosts: [],
          delivered: false,
          status: 'skipped:no-hosts',
          skipped: 'no-hosts',
        }
      }

      // Build + persist every subscribed host's report first (per-host
      // persistence is unchanged — the fleet combination is delivery-only).
      const reports = await Promise.all(hosts.map(buildAndPersist))

      let delivered = false
      let status: string
      if (reports.length > 1) {
        // Multi-host subscription → ONE combined fleet delivery instead of N
        // separate ones. The synthetic summary only labels the delivery
        // (email subject) — it is never persisted.
        const summaries = reports.map((r) => r.summary)
        const fleetReport: WeeklyReport = {
          summary: { ...summaries[0], hostLabel: `${summaries.length} hosts` },
          markdown: buildFleetMarkdown(summaries, period),
          html: renderFleetReportHtml(summaries),
        }
        const pdf = attachPdf
          ? await renderReportPdf(
              fleetReport.html,
              bindings as unknown as Record<string, unknown>
            )
          : null
        const outcome = await deliverReport(
          sub.ownerId,
          fleetReport,
          pdf
            ? {
                pdf,
                pdfFilename: reportPdfFilename(
                  'fleet',
                  period,
                  fleetReport.summary.weekStart
                ),
              }
            : {}
        )
        delivered = outcome.delivered
        status = `fleet[${hosts.join(',')}][${formatDeliveryStatus(outcome)}]`
      } else {
        const pdf = attachPdf
          ? await renderReportPdf(
              reports[0].html,
              bindings as unknown as Record<string, unknown>
            )
          : null
        const outcome = await deliverReport(
          sub.ownerId,
          reports[0],
          pdf
            ? {
                pdf,
                pdfFilename: reportPdfFilename(
                  reports[0].summary.hostLabel,
                  period,
                  reports[0].summary.weekStart
                ),
              }
            : {}
        )
        delivered = outcome.delivered
        status = `host${hosts[0]}[${formatDeliveryStatus(outcome)}]`
      }
      await recordReportDelivery(sub.ownerId, status)
      return { ownerId: sub.ownerId, hosts, delivered, status }
    } catch (err) {
      warn(
        `[report-fanout] owner ${sub.ownerId || '(single-tenant)'} failed: ${err instanceof Error ? err.message : String(err)}`
      )
      return {
        ownerId: sub.ownerId,
        hosts: [],
        delivered: false,
        status: 'error',
      }
    }
  }

  return mapWithConcurrency(
    subscriptions,
    DELIVERY_CONCURRENCY,
    processSubscription
  )
}
