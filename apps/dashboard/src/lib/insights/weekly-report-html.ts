/**
 * Presentation-quality HTML renderer for the weekly health report.
 *
 * A PURE function of a {@link WeeklyReportSummary} — no I/O, no imports from the
 * data-assembly path — so it is unit-testable in isolation and can be called
 * both by `buildWeeklyReport` (to persist the rendered narrative) and by the
 * view route (to re-render from a persisted summary).
 *
 * The output is a fully self-contained HTML document: all CSS is inlined in a
 * single `<style>` block, there are NO external `<link>`/`<script src>`/font/
 * image requests, so the document renders identically whether it is emailed,
 * persisted in D1, or downloaded and opened standalone. Colors are the
 * dashboard's own OKLCH design tokens (see `styles.css` / product-design.md) so
 * the report reads as part of the same product, and it is dark-mode aware via
 * `prefers-color-scheme`.
 *
 * HONESTY INVARIANT: this renderer only ever restates what the insights engine,
 * statistical baselines, and capacity forecaster actually computed. It never
 * claims any change was applied — chmonitor recommends, it does not act.
 */

import type {
  WeeklyReportCapacity,
  WeeklyReportSummary,
  WeeklyTopFinding,
} from './weekly-report'
import type { InsightSeverity } from './types'

/** Escape untrusted finding text before interpolating into markup. */
function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const SEVERITY_LABEL: Record<InsightSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Info',
}

/** Percentage (0–100, rounded) of `part` out of `total`; 0 when total is 0. */
function pct(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 100)
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  const i = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  )
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * The design tokens, inlined. Mirrors `apps/dashboard/src/styles.css` (light in
 * `:root`, dark via `prefers-color-scheme`) so the report matches the product.
 */
const STYLE = `
  :root {
    --bg: oklch(0.985 0 0);
    --surface: oklch(1 0 0);
    --fg: oklch(0.205 0 0);
    --muted-fg: oklch(0.556 0 0);
    --border: oklch(0.922 0 0);
    --subtle: oklch(0.97 0 0);
    --primary: oklch(0.488 0.243 264.376);
    --crit: oklch(0.577 0.245 27.325);
    --warn: oklch(0.769 0.188 70.08);
    --info: oklch(0.6 0.118 264);
    --crit-bg: oklch(0.577 0.245 27.325 / 0.1);
    --warn-bg: oklch(0.769 0.188 70.08 / 0.14);
    --info-bg: oklch(0.6 0.118 264 / 0.1);
    --shadow: 0 1px 2px oklch(0 0 0 / 0.04), 0 8px 24px oklch(0 0 0 / 0.05);
    --radius: 12px;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: oklch(0.145 0 0);
      --surface: oklch(0.205 0 0);
      --fg: oklch(0.985 0 0);
      --muted-fg: oklch(0.708 0 0);
      --border: oklch(1 0 0 / 0.1);
      --subtle: oklch(0.269 0 0);
      --primary: oklch(0.62 0.19 265.638);
      --crit: oklch(0.704 0.191 22.216);
      --warn: oklch(0.828 0.189 84);
      --info: oklch(0.7 0.13 264);
      --crit-bg: oklch(0.704 0.191 22.216 / 0.16);
      --warn-bg: oklch(0.828 0.189 84 / 0.16);
      --info-bg: oklch(0.7 0.13 264 / 0.14);
      --shadow: 0 1px 2px oklch(0 0 0 / 0.3), 0 8px 24px oklch(0 0 0 / 0.35);
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
      Helvetica, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 56px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    overflow: hidden;
  }
  .hero { padding: 28px 28px 24px; }
  .eyebrow {
    font-size: 11px; font-weight: 700; letter-spacing: 0.08em;
    text-transform: uppercase; color: var(--primary); margin: 0 0 6px;
  }
  h1 { font-size: 24px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 6px; }
  .window { font-size: 13px; color: var(--muted-fg); margin: 0; }
  .stat-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
  .stat {
    flex: 1 1 120px; min-width: 110px; padding: 14px 16px;
    border: 1px solid var(--border); border-radius: 10px; background: var(--bg);
  }
  .stat .num { font-size: 26px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; }
  .stat .lbl { font-size: 12px; color: var(--muted-fg); margin-top: 2px; }
  .stat.crit .num { color: var(--crit); }
  .stat.warn .num { color: var(--warn); }
  .sevbar { display: flex; height: 8px; border-radius: 999px; overflow: hidden; margin-top: 22px; background: var(--subtle); }
  .sevbar span { display: block; height: 100%; }
  .sevbar .s-crit { background: var(--crit); }
  .sevbar .s-warn { background: var(--warn); }
  .sevbar .s-info { background: var(--info); }
  .legend { display: flex; gap: 16px; margin-top: 10px; font-size: 12px; color: var(--muted-fg); }
  .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 3px; margin-right: 6px; vertical-align: middle; }
  section { margin-top: 28px; }
  .sec-title {
    font-size: 12px; font-weight: 700; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--muted-fg); margin: 0 0 12px;
  }
  .finding {
    display: flex; gap: 14px; padding: 16px 18px; border: 1px solid var(--border);
    border-left-width: 4px; border-radius: 10px; margin-bottom: 10px; background: var(--surface);
  }
  .finding.crit { border-left-color: var(--crit); }
  .finding.warn { border-left-color: var(--warn); }
  .finding.info { border-left-color: var(--info); }
  .badge {
    flex: 0 0 auto; align-self: flex-start; font-size: 10.5px; font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase; padding: 3px 9px;
    border-radius: 999px; white-space: nowrap;
  }
  .badge.crit { color: var(--crit); background: var(--crit-bg); }
  .badge.warn { color: var(--warn); background: var(--warn-bg); }
  .badge.info { color: var(--info); background: var(--info-bg); }
  .finding .body { min-width: 0; }
  .finding .ttl { font-weight: 650; font-size: 14.5px; margin: 0 0 3px; }
  .finding .dtl { font-size: 13px; color: var(--muted-fg); margin: 0; }
  .finding .meta { font-size: 11.5px; color: var(--muted-fg); margin: 6px 0 0; opacity: 0.85; }
  .empty { padding: 20px; text-align: center; color: var(--muted-fg); font-size: 13.5px; border: 1px dashed var(--border); border-radius: 10px; }
  .cat { margin-bottom: 9px; }
  .cat-head { display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 5px; }
  .cat-head .n { color: var(--muted-fg); font-variant-numeric: tabular-nums; }
  .track { height: 7px; background: var(--subtle); border-radius: 999px; overflow: hidden; }
  .track span { display: block; height: 100%; background: var(--primary); border-radius: 999px; }
  .cap {
    padding: 18px 20px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface);
  }
  .cap .headline { font-size: 15px; font-weight: 650; margin: 0 0 8px; }
  .cap .prose { font-size: 13px; color: var(--muted-fg); margin: 0; }
  .cap-metrics { display: flex; flex-wrap: wrap; gap: 18px; margin: 14px 0 4px; }
  .cap-metrics div { font-size: 12px; color: var(--muted-fg); }
  .cap-metrics strong { display: block; font-size: 17px; color: var(--fg); font-weight: 700; font-variant-numeric: tabular-nums; }
  .util { margin-top: 14px; }
  .util .track { height: 9px; }
  .util .track span { background: var(--primary); }
  .util.hot .track span { background: var(--crit); }
  .footer {
    margin-top: 26px; padding-top: 18px; border-top: 1px solid var(--border);
    font-size: 12px; color: var(--muted-fg); line-height: 1.6;
  }
  .footer strong { color: var(--fg); font-weight: 650; }
`

function renderStatCards(s: WeeklyReportSummary): string {
  return `
    <div class="stat-row">
      <div class="stat"><div class="num">${s.totalFindings}</div><div class="lbl">Findings this week</div></div>
      <div class="stat crit"><div class="num">${s.bySeverity.critical}</div><div class="lbl">Critical</div></div>
      <div class="stat warn"><div class="num">${s.bySeverity.warning}</div><div class="lbl">Warning</div></div>
      <div class="stat"><div class="num">${s.baselinesFitted}</div><div class="lbl">Adaptive baselines</div></div>
    </div>`
}

function renderSeverityBar(s: WeeklyReportSummary): string {
  const { critical, warning, info } = s.bySeverity
  const total = critical + warning + info
  if (total === 0) return ''
  return `
    <div class="sevbar" role="img" aria-label="Severity distribution">
      <span class="s-crit" style="width:${pct(critical, total)}%"></span>
      <span class="s-warn" style="width:${pct(warning, total)}%"></span>
      <span class="s-info" style="width:${pct(info, total)}%"></span>
    </div>
    <div class="legend">
      <span><i style="background:var(--crit)"></i>${critical} critical</span>
      <span><i style="background:var(--warn)"></i>${warning} warning</span>
      <span><i style="background:var(--info)"></i>${info} info</span>
    </div>`
}

function renderFinding(f: WeeklyTopFinding): string {
  const sev = f.severity
  const metric = f.metric ? ` · ${esc(f.metric)}` : ''
  return `
    <div class="finding ${sev}">
      <span class="badge ${sev}">${SEVERITY_LABEL[sev]}</span>
      <div class="body">
        <p class="ttl">${esc(f.title)}</p>
        <p class="dtl">${esc(f.detail)}</p>
        <p class="meta">${esc(f.category)}${metric}</p>
      </div>
    </div>`
}

function renderTopFindings(s: WeeklyReportSummary): string {
  if (s.topFindings.length === 0) {
    return `<div class="empty">No notable findings this week — the cluster stayed within its baselines.</div>`
  }
  return s.topFindings.map(renderFinding).join('')
}

function renderCategories(s: WeeklyReportSummary): string {
  const entries = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return ''
  const max = entries[0][1]
  const bars = entries
    .slice(0, 6)
    .map(
      ([cat, n]) => `
      <div class="cat">
        <div class="cat-head"><span>${esc(cat)}</span><span class="n">${n}</span></div>
        <div class="track"><span style="width:${pct(n, max)}%"></span></div>
      </div>`
    )
    .join('')
  return `
    <section>
      <p class="sec-title">Findings by category</p>
      ${bars}
    </section>`
}

function renderCapacity(cap: WeeklyReportCapacity): string {
  if (!cap.available) {
    return `
      <div class="cap">
        <p class="headline">Capacity outlook unavailable</p>
        <p class="prose">${esc(cap.message)}</p>
      </div>`
  }

  const usedBytes = Math.max(0, cap.totalBytes - cap.freeBytes)
  const usedPct = pct(usedBytes, cap.totalBytes)
  const hot = usedPct >= 80 || (cap.daysToFull !== null && cap.daysToFull <= 30)
  const fullLine =
    cap.daysToFull === null || cap.willExceedHorizon
      ? `No disk-full date within the ${cap.horizonDays}-day horizon`
      : `~${cap.daysToFull} day(s) to full${cap.fullDate ? ` (≈ ${esc(cap.fullDate.slice(0, 10))})` : ''}`

  return `
    <div class="cap">
      <p class="headline">${esc(fullLine)}</p>
      <div class="cap-metrics">
        <div><strong>${esc(cap.readableDailyGrowth)}/day</strong>growth rate</div>
        <div><strong>${formatBytes(cap.freeBytes)}</strong>free of ${formatBytes(cap.totalBytes)}</div>
        <div><strong>${esc(cap.confidence)}</strong>confidence · ${cap.sampleDays}d history</div>
      </div>
      <div class="util ${hot ? 'hot' : ''}">
        <div class="cat-head"><span>Disk utilization</span><span class="n">${usedPct}%</span></div>
        <div class="track"><span style="width:${usedPct}%"></span></div>
      </div>
      <p class="prose" style="margin-top:14px">${esc(cap.explanation)}</p>
    </div>`
}

/**
 * Render a {@link WeeklyReportSummary} into a fully self-contained,
 * presentation-quality HTML document. Pure and deterministic.
 */
export function renderWeeklyReportHtml(s: WeeklyReportSummary): string {
  const title = `Weekly Health Report — ${esc(s.hostLabel)}`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light dark" />
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="hero">
        <p class="eyebrow">chmonitor · Weekly digest</p>
        <h1>${esc(s.hostLabel)}</h1>
        <p class="window">${esc(s.weekStart)} → ${esc(s.weekEnd)} · generated ${esc(s.generatedAt.slice(0, 10))}</p>
        ${renderStatCards(s)}
        ${renderSeverityBar(s)}
      </div>
    </div>

    <section>
      <p class="sec-title">Top findings</p>
      ${renderTopFindings(s)}
    </section>

    ${renderCategories(s)}

    <section>
      <p class="sec-title">Capacity outlook</p>
      ${renderCapacity(s.capacity)}
    </section>

    <div class="footer">
      <strong>How this report was built.</strong> Composed automatically from
      chmonitor's AI insights engine, statistical baselines, and capacity
      forecasting over the last 7 days. Every item above is a recommendation for
      your review — <strong>nothing here was applied automatically</strong>.
      chmonitor recommends; it does not change your cluster. Open the AI agent
      (<code>/agents?host=${s.hostId}</code>) to investigate any finding.
    </div>
  </div>
</body>
</html>`
}
