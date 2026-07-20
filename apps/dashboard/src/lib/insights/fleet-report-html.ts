/**
 * Fleet (multi-host) health report renderer.
 *
 * When a report subscription covers more than one host, the fan-out builds ONE
 * combined delivery instead of N separate emails: a fleet overview comparison
 * table (host, findings, critical, queries, ingested, disk %) followed by the
 * SAME per-host sections the single-host report renders (reused via
 * `renderHostSections`), so no host's detail is lost.
 *
 * Pure, deterministic, and fully self-contained like `weekly-report-html.ts` —
 * and bound by the same HONESTY INVARIANT: it only restates what was actually
 * computed; a section absent from a host's summary shows `—`, never an
 * invented value.
 */

import type { WeeklyReportSummary } from './types'

import {
  esc,
  formatBytes,
  formatQuantity,
  REPORT_STYLE,
  renderHostSections,
} from './weekly-report-html'

const DASH = '—'

function diskUsedPct(s: WeeklyReportSummary): string {
  if (!s.capacity.available || s.capacity.totalBytes <= 0) return DASH
  const used = Math.max(0, s.capacity.totalBytes - s.capacity.freeBytes)
  return `${Math.round((used / s.capacity.totalBytes) * 100)}%`
}

function overviewRow(s: WeeklyReportSummary): string {
  const queries = s.queryActivity
    ? formatQuantity(s.queryActivity.totalQueries)
    : DASH
  const ingested = s.ingestion ? formatBytes(s.ingestion.totalBytes) : DASH
  const crit = s.bySeverity.critical
  return `
      <tr>
        <td class="host-name">${esc(s.hostLabel)}</td>
        <td>${s.totalFindings}</td>
        <td class="${crit > 0 ? 'crit-n' : ''}">${crit}</td>
        <td>${queries}</td>
        <td>${ingested}</td>
        <td>${diskUsedPct(s)}</td>
      </tr>`
}

/**
 * Render N per-host summaries into one self-contained fleet report document.
 */
export function renderFleetReportHtml(
  summaries: readonly WeeklyReportSummary[]
): string {
  const first = summaries[0]
  const periodLabel = first?.period === 'monthly' ? 'Monthly' : 'Weekly'
  const title = `${periodLabel} Fleet Health Report — ${summaries.length} hosts`
  const window = first
    ? `${esc(first.weekStart)} → ${esc(first.weekEnd)} · generated ${esc(first.generatedAt.slice(0, 10))}`
    : ''
  const totalFindings = summaries.reduce((acc, s) => acc + s.totalFindings, 0)
  const totalCritical = summaries.reduce(
    (acc, s) => acc + s.bySeverity.critical,
    0
  )

  const hostBlocks = summaries
    .map(
      (s) => `
    <div class="host-block">
      ${renderHostSections(s)}
    </div>`
    )
    .join('')

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${esc(title)}</title>
<style>${REPORT_STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <p class="eyebrow">chmonitor · ${periodLabel} fleet digest</p>
        <h1>${summaries.length} hosts · ${totalFindings} findings${totalCritical > 0 ? ` · ${totalCritical} critical` : ''}</h1>
        <p class="window">${window}</p>
      </div>
    </div>

    <section>
      <p class="sec-title">Fleet overview</p>
      <div class="panel fleet-table-wrap">
        <table class="fleet-table">
          <thead>
            <tr><th>Host</th><th>Findings</th><th>Critical</th><th>Queries</th><th>Ingested</th><th>Disk used</th></tr>
          </thead>
          <tbody>${summaries.map(overviewRow).join('')}</tbody>
        </table>
      </div>
    </section>

    ${hostBlocks}

    <div class="footer">
      <strong>How this report was built.</strong> Composed automatically from
      chmonitor's AI insights engine, statistical baselines, capacity
      forecasting, and system-table metrics for every host above. Every item is
      a recommendation for your review — <strong>nothing here was applied
      automatically</strong>. chmonitor recommends; it does not change your
      clusters.
    </div>
  </div>
</body>
</html>`
}
