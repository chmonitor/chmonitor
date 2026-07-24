/**
 * Weekly Health Report view/download endpoint — GET /api/v1/insights/weekly-report
 *
 * Returns a persisted weekly report so it can be viewed or downloaded even when
 * NO delivery channel (email/Slack) is configured — the report is always
 * persisted by the cron, and this route surfaces it. Reads from the
 * `weekly_reports` D1 store (fail-open: returns 404 when D1 is unavailable or
 * the report doesn't exist yet).
 *
 * Query parameters:
 * - host (optional, default 0): host index to read the report for
 * - week (optional): the report's `week_start` (`YYYY-MM-DD`); defaults to the
 *   most recent persisted report for the host
 * - format (optional): `html` (default) returns the self-contained HTML
 *   document; `json` returns the parsed summary + metadata; `pdf` renders the
 *   HTML to PDF via Cloudflare Browser Rendering (#2794) and falls back to HTML
 *   when no `BROWSER` binding is configured (self-hosted) or the render fails.
 *
 * Auth posture mirrors GET /api/v1/insights — it inherits the deployment's auth
 * posture (self-hosted `none`, cloud Clerk/public-read via middleware) rather
 * than hard-gating on Clerk, so self-hosted stays whole.
 */

import { createFileRoute } from '@tanstack/react-router'

import type { WeeklyReportSummary } from '@/lib/insights/types'

import { env } from 'cloudflare:workers'
import { error, generateRequestId } from '@chm/logger'
import { renderReportPdf, reportPdfFilename } from '@/lib/insights/report-pdf'
import { renderWeeklyReportHtml } from '@/lib/insights/weekly-report-html'
import {
  getWeeklyReport,
  listWeeklyReports,
  type WeeklyReportRecord,
} from '@/lib/insights/weekly-report-store'

/** Re-render HTML from the stored summary when the persisted `html` is empty. */
function htmlFor(record: WeeklyReportRecord): string {
  if (record.html) return record.html
  try {
    const summary = JSON.parse(record.summaryJson) as WeeklyReportSummary
    return renderWeeklyReportHtml(summary)
  } catch {
    return '<!doctype html><meta charset="utf-8"><body>Report unavailable.</body>'
  }
}

export const Route = createFileRoute('/api/v1/insights/weekly-report')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestId = generateRequestId()
        try {
          const params = new URL(request.url).searchParams

          const hostId = Number.parseInt(params.get('host') ?? '0', 10)
          if (!Number.isInteger(hostId) || hostId < 0) {
            return Response.json(
              {
                error: 'Invalid host parameter: must be a non-negative integer',
              },
              { status: 400, headers: { 'X-Request-ID': requestId } }
            )
          }

          const week = params.get('week')?.trim()
          const record = week
            ? await getWeeklyReport(String(hostId), week)
            : (await listWeeklyReports(String(hostId), 1))[0]

          if (!record) {
            return Response.json(
              { error: 'No weekly report found for this host/week' },
              { status: 404, headers: { 'X-Request-ID': requestId } }
            )
          }

          if (params.get('format') === 'json') {
            let summary: unknown = null
            try {
              summary = JSON.parse(record.summaryJson)
            } catch {
              summary = null
            }
            return Response.json(
              {
                hostId: record.hostId,
                weekStart: record.weekStart,
                delivered: record.delivered,
                generatedAt: record.generatedAt,
                summary,
              },
              { headers: { 'X-Request-ID': requestId } }
            )
          }

          const html = htmlFor(record)

          if (params.get('format') === 'pdf') {
            const pdf = await renderReportPdf(
              html,
              env as unknown as Record<string, unknown>
            )
            if (pdf) {
              const filename = reportPdfFilename(
                record.hostId,
                'report',
                record.weekStart
              )
              return new Response(pdf, {
                status: 200,
                headers: {
                  'Content-Type': 'application/pdf',
                  'Content-Disposition': `attachment; filename="${filename}"`,
                  'X-Request-ID': requestId,
                },
              })
            }
            // Degrade to HTML with a signal header (no binding / render failed).
            return new Response(html, {
              status: 200,
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'X-Report-PDF': 'unavailable',
                'X-Request-ID': requestId,
              },
            })
          }

          return new Response(html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'X-Request-ID': requestId,
            },
          })
        } catch (err) {
          error('[GET /api/v1/insights/weekly-report] Unexpected error:', err, {
            requestId,
          })
          return Response.json(
            { error: err instanceof Error ? err.message : 'Unknown error' },
            { status: 500, headers: { 'X-Request-ID': requestId } }
          )
        }
      },
    },
  },
})
