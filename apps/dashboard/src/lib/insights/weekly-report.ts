/**
 * Proactive weekly health report.
 *
 * Composes a per-host cluster-health narrative from a rolling 7-day window:
 * top findings from the AI insights engine (`ai-insight` findings, which
 * already fold in the statistical baselines from plan 48 — see
 * `collectors.ts`'s baseline-backed detail strings), a count of adaptive
 * baselines fitted for this host, and the disk-capacity outlook from the
 * capacity forecaster (plan 50). Delivered best-effort via the existing
 * outbound alert webhook (`HEALTH_ALERT_WEBHOOK_URL`) when configured — email
 * (plan 25) and the native Slack app (plan 37) are not merged yet, so the
 * webhook channel already used for regular alerts is the "configured channel"
 * this reuses. The report is ALWAYS persisted regardless of delivery outcome
 * (fail-open — see plans/52-proactive-weekly-health-report.md).
 */

import type { ForecastResult } from '@/lib/ai/advisor/capacity-forecaster'
import type { InsightSeverity } from './types'

import { listBaselines } from './baseline-store'
import { resolveInsightsStore } from './store/resolve-store'
import { INSIGHT_SOURCES, insightKey } from './types'
import { renderWeeklyReportHtml } from './weekly-report-html'
import { persistWeeklyReport } from './weekly-report-store'
import { debug, warn } from '@chm/logger'
import { forecastDiskFull } from '@/lib/ai/advisor/capacity-forecaster'
import { validateHostUrl } from '@/lib/browser-connections/host-url'

const WINDOW_SINCE = '7 DAY'
const WINDOW_DAYS = 7
const MAX_TOP_FINDINGS = 5
const MAX_CATEGORY_BREAKDOWN = 6
/** Discord's `content` field caps at 2000 chars; stay safely under it. */
const MAX_WEBHOOK_TEXT_LENGTH = 1900

const VALID_SEVERITY = new Set<InsightSeverity>(['info', 'warning', 'critical'])
const SEVERITY_RANK: Record<InsightSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

function toSeverity(value: string): InsightSeverity {
  return VALID_SEVERITY.has(value as InsightSeverity)
    ? (value as InsightSeverity)
    : 'info'
}

/** A single highlighted finding surfaced in the "top findings" section. */
export interface WeeklyTopFinding {
  readonly severity: InsightSeverity
  readonly category: string
  readonly title: string
  readonly detail: string
  readonly metric: string
  readonly generatedAt: string
}

/** Capacity section: the real forecast, or a degraded-but-honest fallback. */
export type WeeklyReportCapacity =
  | ForecastResult
  | {
      readonly available: false
      readonly reason: 'error'
      readonly message: string
    }

/** Compact, JSON-serializable summary of a host's weekly report. */
export interface WeeklyReportSummary {
  readonly hostId: number
  readonly hostLabel: string
  /** Start of the rolling 7-day window, `YYYY-MM-DD`. */
  readonly weekStart: string
  /** End of the window (today), `YYYY-MM-DD`. */
  readonly weekEnd: string
  readonly generatedAt: string
  readonly totalFindings: number
  readonly bySeverity: Record<InsightSeverity, number>
  readonly byCategory: Record<string, number>
  readonly topFindings: readonly WeeklyTopFinding[]
  /** Count of metrics with a fitted statistical baseline (plan 48). */
  readonly baselinesFitted: number
  readonly capacity: WeeklyReportCapacity
}

export interface WeeklyReport {
  readonly summary: WeeklyReportSummary
  /** Markdown narrative — the full digest, before any delivery-channel truncation. */
  readonly markdown: string
  /** Presentation-quality, fully self-contained HTML document (see `weekly-report-html.ts`). */
  readonly html: string
}

/**
 * Parse the server-side per-host opt-in allowlist from
 * `CHM_WEEKLY_REPORT_HOSTS` (comma-separated host indices, e.g. `"0,2"`).
 *
 * The opt-in is intentionally a Worker-readable env var, NOT the per-user
 * localStorage `InsightsSettings` — the cron runs server-side and cannot read a
 * browser's localStorage. Default (unset/empty) = an EMPTY set, so a
 * self-hosted deployment that never sets it generates no weekly reports and
 * stays quiet: opt-in, never opt-out. Garbage entries are dropped.
 */
export function parseOptedInHosts(raw: string | undefined | null): number[] {
  if (!raw) return []
  const seen = new Set<number>()
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10)
    if (Number.isInteger(n) && n >= 0) seen.add(n)
  }
  return [...seen].sort((a, b) => a - b)
}

function dateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
}

/**
 * Build the top-N findings list: dedupe by stable key (newest occurrence
 * wins — `store.list()` returns newest-first) and rank by severity then
 * recency, matching the overview panel's read-path ordering (`read-insights.ts`).
 */
function buildTopFindings(
  hostId: number,
  rows: ReadonlyArray<{
    event_time: string
    severity: string
    category: string
    title: string
    detail: string
    metric: string
  }>
): WeeklyTopFinding[] {
  const byKey = new Map<string, WeeklyTopFinding>()
  for (const row of rows) {
    const key = insightKey(hostId, {
      category: row.category,
      metric: row.metric || undefined,
      title: row.title,
    })
    if (byKey.has(key)) continue
    byKey.set(key, {
      severity: toSeverity(row.severity),
      category: row.category,
      title: row.title,
      detail: row.detail,
      metric: row.metric,
      generatedAt: row.event_time,
    })
  }

  return [...byKey.values()]
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      if (bySeverity !== 0) return bySeverity
      return b.generatedAt.localeCompare(a.generatedAt)
    })
    .slice(0, MAX_TOP_FINDINGS)
}

function formatCategoryBreakdown(byCategory: Record<string, number>): string {
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return 'No categories recorded.'
  return entries
    .slice(0, MAX_CATEGORY_BREAKDOWN)
    .map(([category, count]) => `${category} (${count})`)
    .join(', ')
}

function capacityLine(capacity: WeeklyReportCapacity): string {
  if (!capacity.available) return capacity.message
  return capacity.explanation
}

function buildMarkdown(summary: WeeklyReportSummary): string {
  const { bySeverity } = summary
  const lines: string[] = []

  lines.push(`# Weekly Health Report — ${summary.hostLabel}`)
  lines.push(
    `**Window:** ${summary.weekStart} → ${summary.weekEnd} (last ${WINDOW_DAYS} days) · Generated ${summary.generatedAt}`
  )
  lines.push('')
  lines.push('## Summary')
  lines.push(
    `- **${summary.totalFindings} findings** recorded (${bySeverity.critical} critical, ${bySeverity.warning} warning, ${bySeverity.info} info)`
  )
  lines.push(
    `- **Top categories:** ${formatCategoryBreakdown(summary.byCategory)}`
  )
  lines.push(
    `- **${summary.baselinesFitted} metrics** have adaptive statistical baselines fitted to this cluster (vs. fixed defaults)`
  )
  lines.push('')
  lines.push('## Top findings')
  if (summary.topFindings.length === 0) {
    lines.push('No notable findings this week.')
  } else {
    summary.topFindings.forEach((f, i) => {
      lines.push(
        `${i + 1}. **[${f.severity.toUpperCase()}] ${f.title}** — ${f.detail}`
      )
    })
  }
  lines.push('')
  lines.push('## Capacity outlook')
  lines.push(capacityLine(summary.capacity))
  lines.push('')
  lines.push('## Recommendations')
  lines.push(
    `This report is generated automatically from chmonitor's AI insights engine, ` +
      `statistical baselines, and capacity forecasting. Recommendations are advisory ` +
      `only — nothing above was applied automatically. Open the AI agent ` +
      `(\`/agents?host=${summary.hostId}\`) to dig deeper into any finding above.`
  )

  return lines.join('\n')
}

/**
 * Build a host's weekly health report from real insights + baselines +
 * capacity forecast. Never throws — a failure in any one input (ClickHouse,
 * D1) degrades that section to an empty/unavailable state rather than
 * aborting the whole report, so callers can always persist *something*.
 */
export async function buildWeeklyReport(
  hostId: number,
  hostLabel = `Host ${hostId}`
): Promise<WeeklyReport> {
  const weekStart = dateNDaysAgo(WINDOW_DAYS)
  const weekEnd = dateNDaysAgo(0)
  const generatedAt = new Date().toISOString()

  let rows: Array<{
    event_time: string
    severity: string
    category: string
    title: string
    detail: string
    metric: string
  }> = []
  try {
    const store = await resolveInsightsStore()
    const listed = await store.list(hostId, {
      since: WINDOW_SINCE,
      limit: 1000,
    })
    rows = listed.filter((r) =>
      INSIGHT_SOURCES.includes(r.source as (typeof INSIGHT_SOURCES)[number])
    )
  } catch (err) {
    debug(
      `[weekly-report] failed to read insights for host ${hostId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  const bySeverity: Record<InsightSeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  }
  const byCategory: Record<string, number> = {}
  for (const row of rows) {
    bySeverity[toSeverity(row.severity)]++
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1
  }

  const topFindings = buildTopFindings(hostId, rows)

  let baselinesFitted = 0
  try {
    baselinesFitted = (await listBaselines(String(hostId))).length
  } catch (err) {
    debug(
      `[weekly-report] failed to list baselines for host ${hostId}: ${err instanceof Error ? err.message : String(err)}`
    )
  }

  let capacity: WeeklyReportCapacity
  try {
    capacity = await forecastDiskFull(hostId)
  } catch (err) {
    capacity = {
      available: false,
      reason: 'error',
      message: `Capacity forecast unavailable: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const summary: WeeklyReportSummary = {
    hostId,
    hostLabel,
    weekStart,
    weekEnd,
    generatedAt,
    totalFindings: rows.length,
    bySeverity,
    byCategory,
    topFindings,
    baselinesFitted,
    capacity,
  }

  return {
    summary,
    markdown: buildMarkdown(summary),
    html: renderWeeklyReportHtml(summary),
  }
}

function truncateForWebhook(markdown: string): string {
  if (markdown.length <= MAX_WEBHOOK_TEXT_LENGTH) return markdown
  return `${markdown.slice(0, MAX_WEBHOOK_TEXT_LENGTH - 15)}\n…(truncated)`
}

/**
 * Best-effort delivery to the existing outbound alert webhook
 * (`HEALTH_ALERT_WEBHOOK_URL`). SSRF-guarded: `validateHostUrl` rejects
 * private/loopback/link-local/metadata destinations before the fetch, mirroring
 * `/api/v1/health/webhook`'s proxy guard. Never throws — returns `false` on any
 * failure (blocked URL, network error, non-2xx response) so a delivery problem
 * never blocks persistence.
 */
async function deliverWeeklyReportWebhook(
  url: string,
  report: WeeklyReport
): Promise<boolean> {
  try {
    const ssrfError = await validateHostUrl(url)
    if (ssrfError) {
      warn(`[weekly-report] blocked SSRF-unsafe webhook URL: ${ssrfError}`)
      return false
    }

    const text = truncateForWebhook(report.markdown)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, content: text }),
        signal: controller.signal,
      })
      return res.ok
    } finally {
      clearTimeout(timeout)
    }
  } catch (err) {
    warn(
      `[weekly-report] webhook delivery failed for host ${report.summary.hostId}: ${err instanceof Error ? err.message : String(err)}`
    )
    return false
  }
}

/** Outcome of running the weekly report pipeline for one host. */
export interface WeeklyReportRunResult {
  readonly hostId: number
  /** Whether the report was successfully written to the weekly_reports store. */
  readonly persisted: boolean
  /** Whether a configured channel accepted the report. */
  readonly delivered: boolean
  /** Whether any delivery channel was configured at all (independent of success). */
  readonly channelConfigured: boolean
  readonly summary: WeeklyReportSummary
}

/**
 * Build, persist, and best-effort deliver one host's weekly report.
 *
 * DELIVER-OR-PERSIST: persistence is attempted unconditionally (fail-open —
 * plans 25/email and 37/Slack-native are not merged yet, so there may be no
 * delivery channel at all). Delivery is attempted only when the existing
 * outbound alert webhook (`HEALTH_ALERT_WEBHOOK_URL`) is configured, and a
 * failed delivery never throws or blocks the already-persisted report.
 */
export async function runWeeklyReportForHost(
  hostId: number,
  hostLabel?: string
): Promise<WeeklyReportRunResult> {
  const report = await buildWeeklyReport(hostId, hostLabel)
  const weekStart = report.summary.weekStart
  const generatedAt = Date.now()

  const persisted = await persistWeeklyReport({
    hostId: String(hostId),
    weekStart,
    summaryJson: JSON.stringify(report.summary),
    html: report.html,
    delivered: false,
    generatedAt,
  })

  const webhookUrl = (process.env.HEALTH_ALERT_WEBHOOK_URL ?? '').trim()
  const channelConfigured = Boolean(webhookUrl)

  let delivered = false
  if (channelConfigured) {
    try {
      delivered = await deliverWeeklyReportWebhook(webhookUrl, report)
    } catch {
      delivered = false
    }

    if (delivered) {
      // Update the SAME (host_id, week_start) row in place so the persisted
      // record reflects delivery — never re-attempt persistence of the base
      // report if this best-effort update fails.
      await persistWeeklyReport({
        hostId: String(hostId),
        weekStart,
        summaryJson: JSON.stringify(report.summary),
        html: report.html,
        delivered: true,
        generatedAt,
      })
    }
  }

  return {
    hostId,
    persisted,
    delivered,
    channelConfigured,
    summary: report.summary,
  }
}
