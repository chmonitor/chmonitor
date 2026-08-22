// chmonitor telemetry collector — the ingest endpoint that CHM_TELEMETRY_ENDPOINT
// points at. Receives the anonymous instance ping (and optional aggregate
// events) emitted by apps/dashboard/src/lib/telemetry and records them to
// Cloudflare Analytics Engine.
//
// Privacy contract (mirrors the dashboard client, defense-in-depth):
//   - Accepts ONLY a closed, validated shape. Unknown fields are ignored.
//   - instance_hash is a SHA-256 hex digest of a random local id — opaque, not
//     reversible to any identity. It is the per-install counter. Optional
//     license_key is the Polar checkout id when CHM_LICENSE_KEY is set (honor
//     system; not a feature gate). It is persisted but never returned by
//     GET /v1/summary.
//   - ch_version is accepted only as MAJOR.MINOR (e.g. "24.8"); anything else is
//     dropped. deploy_target / ch_flavor are coerced to a known enum or dropped.
//   - No IPs, hostnames, query text, or free-text are stored. The request IP is
//     never written to Analytics Engine.
//
// Auth: /v1/ping and /v1/event are unauthenticated, write-only ingest paths.
// The ONLY read-back over HTTP is GET /v1/summary — a public, AGGREGATE-ONLY
// view (distinct-install counts by deploy_target / ch_version). No
// instance_hash, IP, hostname, or free-text is ever exposed by it — only
// integer COUNT(DISTINCT instance_hash) values. The raw dataset remains
// queryable only from the project's Cloudflare account (D1 + Analytics Engine).

export interface Env {
  CHM_TELEMETRY_DB: D1Database
}

const MAX_BODY_BYTES = 2048

// These enums intentionally mirror the dashboard's canonical definitions
// (apps/dashboard/src/lib/telemetry/environment.ts → DeployTarget/ChFlavor,
// events.ts → TELEMETRY_EVENTS). They are duplicated rather than imported to
// keep this worker a zero-dependency standalone deploy unit; keep them in sync.
const DEPLOY_TARGETS = new Set(['docker', 'helm', 'cf', 'dev', 'unknown'])
const CH_FLAVORS = new Set(['oss', 'altinity', 'cloud', 'unknown'])
const PLATFORMS = new Set([
  'windows',
  'macos',
  'linux',
  'android',
  'ios',
  'unknown',
])
// ISO 3166-1 alpha-2 codes (common countries only - validate format, not membership)
const COUNTRY_CODE = /^[a-z]{2}$/i
const EVENTS = new Set([
  'app_loaded',
  'cluster_connected',
  'health_viewed',
  'queries_viewed',
  'ai_query_sent',
])

// ─── CLI telemetry (source=cli) — a SEPARATE tracking stream ─────────────────
// Emitted by rust/ch-monitor-cli (`chm`) and scripts/install.sh. Recorded to the
// cli_daily table, never mixed with the dashboard's ping_daily / events streams.
// Mirror rust/ch-monitor-cli/src/telemetry.rs — keep these in sync.
const CLI_EVENTS = new Set(['cli_install', 'cli_run', 'cli_diagnose'])
const CLI_COMMANDS = new Set([
  'hosts',
  'chart',
  'table',
  'tui',
  'diagnose',
  'install',
  'update',
  '',
])
const ARCHES = new Set(['x86_64', 'aarch64', 'unknown'])

const HEX64 = /^[0-9a-f]{64}$/
const MAJOR_MINOR = /^\d{1,3}\.\d{1,3}$/
// CHM product version (e.g. '0.3.1') — semver-like, 1-3 dot-separated numbers.
const SEMVER = /^\d{1,3}\.\d{1,3}(\.\d{1,5})?$/

const CORS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

const noContent = () => new Response(null, { status: 204, headers: CORS })
const bad = (status: number, msg: string) =>
  new Response(msg, { status, headers: CORS })

/** Coerce to a known enum value or fall back. */
function asEnum(v: unknown, set: Set<string>, fallback: string): string {
  return typeof v === 'string' && set.has(v) ? v : fallback
}

/** Accept only a MAJOR.MINOR version string, else ''. */
function asVersion(v: unknown): string {
  return typeof v === 'string' && MAJOR_MINOR.test(v) ? v : ''
}

/** Accept a semver-like CHM version string (e.g. '0.3.1'), else ''. */
function asChmVersion(v: unknown): string {
  return typeof v === 'string' && SEMVER.test(v) ? v : ''
}

/** Accept a Polar checkout / order id (UUID charset), else ''. */
function asLicenseKey(v: unknown): string {
  if (typeof v !== 'string') return ''
  const trimmed = v.trim()
  if (trimmed.length < 8 || trimmed.length > 80) return ''
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,79}$/.test(trimmed)) return ''
  return trimmed
}

async function readBody(req: Request): Promise<unknown | null> {
  const len = Number(req.headers.get('content-length') ?? '0')
  if (len > MAX_BODY_BYTES) return null
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    const { pathname } = new URL(req.url)

    if (req.method === 'OPTIONS') return noContent()

    if (req.method === 'GET' && pathname === '/health') {
      return new Response('OK\n', {
        status: 200,
        headers: { 'content-type': 'text/plain', ...CORS },
      })
    }

    if (req.method === 'GET' && pathname === '/') {
      // Serve the analytics dashboard HTML (two-tab page: Dashboard (OSS)
      // installs vs CLI usage — separate streams). Design: dark-first
      // dithered-bar aesthetic with per-item logos.
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>chmonitor Telemetry</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #0b0b0e;
      --bg-soft: #101014;
      --fg: #f4f4f5;
      --fg-muted: #8a8a93;
      --border: #26262c;
      --card: #131316;
      --card-hover: #17171c;
      --code-bg: #1e1e24;
      --accent: #f97316;
      --accent-dim: #f9731622;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg: #ffffff;
        --bg-soft: #fafafa;
        --fg: #18181b;
        --fg-muted: #71717a;
        --border: #e4e4e7;
        --card: #ffffff;
        --card-hover: #fafafa;
        --code-bg: #f4f4f5;
        --accent: #ea580c;
        --accent-dim: #ea580c18;
      }
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background:
        radial-gradient(1200px 500px at 50% -200px, var(--accent-dim), transparent),
        var(--bg);
      color: var(--fg);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      min-height: 100vh;
    }

    .nav-bar {
      position: sticky;
      top: 0;
      z-index: 10;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      background: color-mix(in srgb, var(--bg) 78%, transparent);
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
    }

    .nav-container {
      max-width: 960px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo {
      font-size: 1.05rem;
      font-weight: 750;
      color: var(--fg);
      text-decoration: none;
      letter-spacing: -0.02em;
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .nav-links { display: flex; gap: 22px; }

    .nav-links a {
      color: var(--fg-muted);
      text-decoration: none;
      font-size: 0.875rem;
      font-weight: 500;
    }

    .nav-links a:hover { color: var(--fg); }

    .container {
      max-width: 960px;
      margin: 48px auto 0;
      padding: 0 24px 72px;
    }

    header { margin-bottom: 28px; }

    h1 {
      font-size: clamp(1.7rem, 4vw, 2.3rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 6px;
    }

    .subtitle {
      color: var(--fg-muted);
      font-size: 0.98rem;
      max-width: 620px;
    }

    .subtitle code {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.85em;
      background: var(--code-bg);
      padding: 2px 7px;
      border-radius: 6px;
      font-weight: 600;
    }

    .notice-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 36px;
    }

    .privacy-note, .opt-out {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 0.85rem;
      color: var(--fg-muted);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 13px 16px;
      background: var(--card);
    }

    .privacy-note strong, .opt-out strong { color: var(--fg); font-weight: 650; }

    .opt-out code {
      font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
      font-size: 0.8rem;
      background: var(--code-bg);
      padding: 3px 9px;
      border-radius: 6px;
      color: var(--fg);
      font-weight: 600;
      white-space: nowrap;
    }

    .opt-out a, .privacy-note a { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }

    .tabs {
      display: flex;
      gap: 4px;
      border: 1px solid var(--border);
      width: fit-content;
      padding: 4px;
      border-radius: 12px;
      background: var(--card);
      margin-bottom: 32px;
    }

    .tab {
      appearance: none;
      background: none;
      border: none;
      border-radius: 9px;
      padding: 8px 18px;
      font: inherit;
      font-size: 0.88rem;
      font-weight: 620;
      color: var(--fg-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .tab:hover { color: var(--fg); }

    .tab.active {
      color: var(--fg);
      background: var(--accent-dim);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent);
    }

    .loading, .empty {
      padding: 64px 0;
      color: var(--fg-muted);
      font-size: 0.9rem;
      text-align: center;
    }

    .error {
      padding: 20px;
      margin: 32px 0;
      color: #dc2626;
      border: 1px solid var(--border);
      border-radius: 12px;
      font-size: 0.9rem;
    }

    /* ── Hero stats ─────────────────────────────────────────────── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 14px;
      margin-bottom: 40px;
    }

    #panel-cli .stats-grid { grid-template-columns: repeat(2, 1fr); }

    .stat-card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--border);
      background:
        radial-gradient(140px 90px at 100% 0%, var(--accent-dim), transparent),
        var(--card);
      padding: 20px;
      border-radius: 14px;
      transition: border-color 0.15s ease;
    }

    .stat-card:hover { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }

    .stat-label {
      font-size: 0.72rem;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 8px;
      font-weight: 700;
    }

    .stat-value {
      font-size: 2.4rem;
      font-weight: 800;
      line-height: 1.05;
      letter-spacing: -0.03em;
      font-variant-numeric: tabular-nums;
    }

    .stat-sub { font-size: 0.75rem; color: var(--fg-muted); margin-top: 6px; }

    /* ── Sections in a responsive card grid ─────────────────────── */
    .sections-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 14px;
    }

    .section {
      border: 1px solid var(--border);
      background: var(--card);
      border-radius: 14px;
      padding: 20px;
      min-width: 0;
    }

    .section.wide { grid-column: 1 / -1; }

    .section h2 {
      font-size: 0.82rem;
      font-weight: 720;
      margin-bottom: 16px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      color: var(--fg-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ── Dithered bar charts ────────────────────────────────────── */
    .bar-chart { display: flex; flex-direction: column; gap: 11px; }

    .bar-item {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.86rem;
      min-width: 0;
    }

    .bar-label {
      width: 150px;
      flex-shrink: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 570;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .bar-logo {
      flex-shrink: 0;
      width: 17px;
      height: 17px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }

    .bar-logo svg { width: 100%; height: 100%; display: block; }
    .bar-logo .flag { font-size: 15px; line-height: 1; }

    .bar-track {
      flex-grow: 1;
      height: 18px;
      margin-right: 4px;
      border-radius: 4px;
      position: relative;
      overflow: hidden;
      min-width: 0;
      background: repeating-conic-gradient(var(--code-bg) 0% 25%, transparent 0% 50%) 0 0 / 6px 6px;
    }

    .bar-fill {
      position: absolute;
      inset: 0 auto 0 0;
      border-radius: 4px;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    /* Bayer-dither fade: solid accent near the label, dissolving into
       checkerboard dots as the value edge approaches. */
    .bar-fill::after {
      content: '';
      position: absolute;
      inset: 0;
      background-image: radial-gradient(circle at 1.5px 1.5px, transparent 1.1px, var(--fill-solid) 1.2px);
      background-size: 3px 3px;
      opacity: 0.9;
    }

    .bar-value {
      width: 64px;
      text-align: right;
      font-weight: 720;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      font-size: 0.82rem;
    }

    .footer {
      margin-top: 52px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--fg-muted);
    }

    .footer a { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }

    @media (max-width: 760px) {
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .sections-grid { grid-template-columns: 1fr; }
      .notice-row { grid-template-columns: 1fr; }
    }

    @media (max-width: 520px) {
      .container { margin-top: 30px; }
      .stats-grid { grid-template-columns: 1fr; }
      .stat-value { font-size: 2rem; }
      .bar-item { flex-wrap: wrap; }
      .bar-track { width: 100%; order: 3; height: 14px; }
      .bar-value { margin-left: auto; }
      .nav-links { display: none; }
    }
  </style>
</head>
<body>
  <nav class="nav-bar">
    <div class="nav-container">
      <a href="https://chmonitor.dev" class="logo">
        <svg width="26" height="26" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="chmonitor">
          <rect x="3.3" y="13.05" width="3.8" height="15.45" fill="#f97316"/><rect x="8.7" y="3.5" width="3.8" height="25" fill="#f97316"/><rect x="14.1" y="13.25" width="3.8" height="15.25" fill="#f97316"/><rect x="19.5" y="6.25" width="3.8" height="22.25" fill="#f97316"/><rect x="24.9" y="16.8" width="3.8" height="11.7" fill="#f97316"/><rect x="3.3" y="9.75" width="3.8" height="3.3" fill="#10b981"/>
        </svg>
        <span>chmonitor</span>
      </a>
      <div class="nav-links">
        <a href="https://chmonitor.dev">Overview</a>
        <a href="https://docs.chmonitor.dev">Docs</a>
        <a href="https://github.com/chmonitor/chmonitor">GitHub</a>
      </div>
    </div>
  </nav>

  <div class="container">
    <header>
      <h1>Telemetry</h1>
      <p class="subtitle">Anonymous adoption stats for the open-source ClickHouse monitoring dashboard and the <code>chm</code> CLI.</p>
    </header>

    <div class="privacy-note">
      <strong>Privacy-first, on by default.</strong>
      100% anonymous — no IPs, hostnames, queries, or identifying information.
      Only COUNT(DISTINCT) of opaque SHA-256 instance ids.
    </div>

    <div class="opt-out">
      <span><strong style="color:var(--fg);font-weight:650;">Disable tracking:</strong></span>
      <code>CHM_TELEMETRY=off</code>
      <span>— one env var, works for the dashboard, CLI, and installer.
      <a href="https://docs.chmonitor.dev/operate/advanced/telemetry">Details</a></span>
    </div>

    <div class="tabs" role="tablist">
      <button class="tab active" id="tab-dashboard" role="tab" aria-selected="true" onclick="showTab('dashboard')">Dashboard (OSS)</button>
      <button class="tab" id="tab-cli" role="tab" aria-selected="false" onclick="showTab('cli')">CLI (chm)</button>
    </div>

    <div id="loading" class="loading">Loading analytics...</div>
    <div id="error" class="error" style="display: none;"></div>

    <div id="panel-dashboard" role="tabpanel" style="display: none;">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Installs</div>
          <div class="stat-value" id="total">0</div>
          <div class="stat-sub">distinct instances</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Environments</div>
          <div class="stat-value" id="total-places">0</div>
          <div class="stat-sub">install locations</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Top Target</div>
          <div class="stat-value" id="top-target">—</div>
          <div class="stat-sub" id="top-target-sub">&nbsp;</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Latest CH</div>
          <div class="stat-value" id="top-version">—</div>
          <div class="stat-sub" id="top-version-sub">&nbsp;</div>
        </div>
      </div>

      <div class="sections-grid">
        <div class="section wide">
          <h2>Deployment Targets</h2>
          <div id="deploy-targets" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>ClickHouse Versions</h2>
          <div id="ch-versions" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>chmonitor Versions</h2>
          <div id="chm-versions" class="bar-chart"></div>
        </div>

        <div class="section" id="ch-flavor-section" style="display: none;">
          <h2>ClickHouse Flavors</h2>
          <div id="ch-flavors" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>Countries</h2>
          <div id="countries" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>Platforms</h2>
          <div id="platforms" class="bar-chart"></div>
        </div>
      </div>
    </div>

    <div id="panel-cli" role="tabpanel" style="display: none;">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">CLI Installs</div>
          <div class="stat-value" id="cli-installs">0</div>
          <div class="stat-sub">all time</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active CLI Users</div>
          <div class="stat-value" id="cli-active">0</div>
          <div class="stat-sub">last 30 days</div>
        </div>
      </div>

      <div class="sections-grid">
        <div class="section wide">
          <h2>Installs Over Time (30d)</h2>
          <div id="cli-installs-time" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>Runs by Command</h2>
          <div id="cli-commands" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>CLI Versions</h2>
          <div id="cli-versions" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>Operating System</h2>
          <div id="cli-os" class="bar-chart"></div>
        </div>

        <div class="section">
          <h2>Architecture</h2>
          <div id="cli-arch" class="bar-chart"></div>
        </div>
      </div>
    </div>

    <div class="footer" id="footer" style="display: none;">
      <p>
        Data updates hourly • Powered by <a href="https://chmonitor.dev">chmonitor</a> •
        <a href="https://github.com/chmonitor/chmonitor">GitHub</a>
      </p>
    </div>
  </div>

  <script>
    function showTab(name) {
      for (const t of ['dashboard', 'cli']) {
        const active = t === name;
        document.getElementById('tab-' + t).classList.toggle('active', active);
        document.getElementById('tab-' + t).setAttribute('aria-selected', String(active));
        document.getElementById('panel-' + t).style.display = active ? 'block' : 'none';
      }
      try { history.replaceState(null, '', '#' + name); } catch {}
    }

    async function loadAnalytics() {
      const loading = document.getElementById('loading');
      const error = document.getElementById('error');

      try {
        const response = await fetch('https://telemetry.chmonitor.dev/v1/summary');
        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }
        const data = await response.json();
        if (data.error) throw new Error(data.error);

        loading.style.display = 'none';
        document.getElementById('footer').style.display = 'block';

        // ── Dashboard (OSS) tab ──
        document.getElementById('total').textContent = data.total_installs.toLocaleString();
        if (data.total_places !== undefined) {
          document.getElementById('total-places').textContent = data.total_places.toLocaleString();
        }
        const targets = Object.entries(data.by_deploy_target || {}).map(([target, installs]) => ({
          deploy_target: target,
          installs: installs
        }));
        renderBarChart('deploy-targets', targets);
        const topTarget = [...targets].sort((a, b) => b.installs - a.installs)[0];
        if (topTarget && topTarget.installs > 0) {
          document.getElementById('top-target').textContent = formatLabel(topTarget.deploy_target);
          const share = data.total_installs > 0 ? Math.round((topTarget.installs / data.total_installs) * 100) : 0;
          document.getElementById('top-target-sub').textContent = share + '% of installs';
        }
        renderBarChart('ch-versions', data.by_ch_version);
        const topVersion = [...(data.by_ch_version || [])].filter(v => v.ch_version !== 'unknown').sort((a, b) => b.installs - a.installs)[0];
        if (topVersion) {
          document.getElementById('top-version').textContent = topVersion.ch_version;
          document.getElementById('top-version-sub').textContent = topVersion.installs.toLocaleString() + ' installs';
        }
        renderBarChart('chm-versions', data.by_chm_version || []);
        renderBarChart('countries', data.by_country);
        renderBarChart('platforms', data.by_platform);
        if (data.by_ch_flavor && data.by_ch_flavor.length > 0) {
          document.getElementById('ch-flavor-section').style.display = 'block';
          renderBarChart('ch-flavors', data.by_ch_flavor);
        }

        // ── CLI (chm) tab — a separate tracking stream ──
        const cli = data.cli || {};
        document.getElementById('cli-installs').textContent = (cli.installs || 0).toLocaleString();
        document.getElementById('cli-active').textContent = (cli.active_users || 0).toLocaleString();
        renderBarChart('cli-installs-time', (cli.installs_over_time || []).map(d => ({ day: d.day, installs: d.installs })), false);
        renderBarChart('cli-commands', (cli.by_command || []).map(c => ({ command: c.command, installs: c.runs })));
        renderBarChart('cli-versions', cli.by_cli_version || []);
        renderBarChart('cli-os', cli.by_os || []);
        renderBarChart('cli-arch', cli.by_arch || []);

        // Restore the tab from the URL hash, default to dashboard.
        showTab(location.hash === '#cli' ? 'cli' : 'dashboard');
      } catch (err) {
        loading.style.display = 'none';
        error.style.display = 'block';
        error.textContent = \`Failed to load analytics: \${err.message}\`;
        console.error('Analytics loading error:', err);
      }
    }

    function renderBarChart(containerId, data, sortByValue = true) {
      const container = document.getElementById(containerId);
      if (!data || data.length === 0) {
        container.innerHTML = '<p style="color: var(--fg-muted); font-size: 0.85rem;">No data yet</p>';
        return;
      }

      const maxValue = Math.max(...data.map(item => item.installs));
      const rows = sortByValue
        ? [...data].sort((a, b) => b.installs - a.installs)
        : data;

      container.innerHTML = rows
        .map((item, i) => {
          const percentage = (item.installs / maxValue) * 100;
          const key = Object.keys(item).find(k => k !== 'installs');
          const label = item[key];
          // Dither density ramps down with rank: #1 is fully solid, later
          // rows dissolve into sparser dot patterns.
          const rank = sortByValue ? i : null;

          return \`
            <div class="bar-item">
              <div class="bar-label">\${logoFor(key, label)}<span>\${formatLabel(label)}</span></div>
              <div class="bar-track">
                <div class="bar-fill" style="width: \${percentage}%; \${ditherStyle(rank)}"></div>
              </div>
              <div class="bar-value">\${item.installs.toLocaleString()}</div>
            </div>
          \`;
        })
        .join('');
    }

    function ditherStyle(rank) {
      if (rank === null || rank === 0) {
        // Solid fill for the top row (or chronological charts).
        return '--fill-solid: transparent;';
      }
      const opacities = [1, 0.55, 0.3, 0.16, 0.08, 0.04, 0.02, 0.01];
      const o = opacities[Math.min(rank - 1, opacities.length - 1)];
      if (o >= 1) return '--fill-solid: transparent;';
      return \`--fill-solid: color-mix(in srgb, var(--accent) \${Math.round(o * 100)}%, transparent);\`;
    }

    function logoFor(key, label) {
      const s = String(label).toLowerCase();
      if (key === 'country') {
        const flags = { 'united states': '🇺🇸', usa: '🇺🇸', us: '🇺🇸', germany: '🇩🇪', de: '🇩🇪', china: '🇨🇳', cn: '🇨🇳', japan: '🇯🇵', jp: '🇯🇵', france: '🇫🇷', fr: '🇫🇷', 'united kingdom': '🇬🇧', uk: '🇬🇧', gb: '🇬🇧', india: '🇮🇳', in: '🇮🇳', brazil: '🇧🇷', br: '🇧🇷', canada: '🇨🇦', ca: '🇨🇦', russia: '🇷🇺', ru: '🇷🇺', netherlands: '🇳🇱', nl: '🇳🇱', australia: '🇦🇺', au: '🇦🇺', singapore: '🇸🇬', sg: '🇸🇬', korea: '🇰🇷', kr: '🇰🇷', spain: '🇪🇸', es: '🇪🇸', italy: '🇮🇹', it: '🇮🇹', poland: '🇵🇱', pl: '🇵🇱', ukraine: '🇺🇦', ua: '🇺🇦', vietnam: '🇻🇳', vn: '🇻🇳', turkey: '🇹🇷', tr: '🇹🇷', sweden: '🇸🇪', se: '🇸🇪', switzerland: '🇨🇭', ch: '🇨🇭' };
        for (const [name, flag] of Object.entries(flags)) {
          if (s === name) return '<span class="flag">' + flag + '</span>';
        }
        return '';
      }
      if (key === 'deploy_target') {
        if (s === 'docker') return DOCKER_SVG;
        if (s === 'helm') return HELM_SVG;
        if (s === 'cf' || s === 'cloudflare') return CF_SVG;
        if (s === 'dev') return DEV_SVG;
        return '';
      }
      if (key === 'platform') {
        if (s === 'linux') return LINUX_SVG;
        if (s === 'macos') return APPLE_SVG;
        if (s === 'windows') return WINDOWS_SVG;
        return '';
      }
      if (key === 'os') {
        if (s.includes('win')) return WINDOWS_SVG;
        if (s.includes('darwin') || s.includes('mac')) return APPLE_SVG;
        if (s.includes('linux')) return LINUX_SVG;
        return '';
      }
      if (key === 'arch') {
        if (s.includes('arm') || s === 'aarch64') return ARM_SVG;
        if (s.includes('86')) return INTEL_SVG;
        return '';
      }
      if (key === 'ch_flavor') {
        if (s === 'altinity') return ALTINITY_SVG;
        if (s === 'cloud') return CF_SVG;
        if (s === 'oss') return CLICKHOUSE_SVG;
        return '';
      }
      return '';
    }

    const CLICKHOUSE_SVG = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="13" width="3.6" height="15" fill="#f97316"/><rect x="9" y="3" width="3.6" height="25" fill="#f97316"/><rect x="14" y="13" width="3.6" height="15" fill="#f97316"/><rect x="19" y="6" width="3.6" height="22" fill="#f97316"/><rect x="24" y="17" width="3.6" height="11" fill="#f97316"/><rect x="4" y="9.7" width="3.6" height="3.3" fill="#10b981"/></svg>';
    const DOCKER_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#2496ed"><path d="M13.98 11.08h2.12a.19.19 0 0 0 .19-.19V9.01a.19.19 0 0 0-.19-.19h-2.12a.18.18 0 0 0-.18.18v1.9c0 .1.08.18.18.18m-2.95-5.43h2.12a.19.19 0 0 0 .19-.19V3.57a.19.19 0 0 0-.19-.19h-2.12a.18.18 0 0 0-.19.18V5.46c0 .1.09.19.19.19m0 2.71h2.12a.19.19 0 0 0 .19-.19V6.28a.19.19 0 0 0-.19-.18h-2.12a.18.18 0 0 0-.19.18v1.89c0 .11.09.19.19.19m-2.93 0h2.12a.19.19 0 0 0 .19-.19V6.28A.18.18 0 0 0 10.22 6.1H8.1a.18.18 0 0 0-.19.18v1.89c0 .11.08.19.19.19m-2.96 0h2.11a.19.19 0 0 0 .19-.19V6.28A.18.18 0 0 0 7.26 6.1H5.14a.18.18 0 0 0-.19.18v1.89c0 .11.08.19.19.19m5.89 2.72h2.12a.19.19 0 0 0 .19-.19V9a.18.18 0 0 0-.19-.18h-2.12a.18.18 0 0 0-.19.18v1.9c0 .1.09.18.19.18m-2.93 0h2.12a.19.19 0 0 0 .19-.19V9a.18.18 0 0 0-.19-.18H8.1A.18.18 0 0 0 7.91 9v1.9c0 .1.08.18.19.18m-2.96 0h2.12a.19.19 0 0 0 .19-.19V9A.18.18 0 0 0 7.26 8.82H5.14A.18.18 0 0 0 4.95 9v1.9c0 .1.08.18.19.18m-2.92 0h2.12a.18.18 0 0 0 .18-.19V9a.18.18 0 0 0-.18-.18H2.03A.17.17 0 0 0 1.85 9v1.9c0 .1.07.18.18.18m21.54-1.19c-.06-.05-.67-.51-1.95-.51-.34 0-.68.03-1.01.09-.25-1.69-1.66-2.51-1.73-2.55l-.35-.2-.23.34a4.6 4.6 0 0 0-.59 1.43c-.22.94-.09 1.82.38 2.58-.56.31-1.47.39-1.67.4H.76a.76.76 0 0 0-.76.75 11.37 11.37 0 0 0 .7 4.06 6.03 6.03 0 0 0 2.49 3.12c1.23.75 3.22 1.19 5.48 1.19 1.02 0 2.04-.09 3.04-.29 1.4-.26 2.74-.75 3.96-1.45a10.85 10.85 0 0 0 2.7-2.22c1.3-1.47 2.08-3.11 2.65-4.56h.23c1.37 0 2.21-.55 2.68-1 .3-.3.55-.66.71-1.07l.1-.28Z"/></svg>';
    const HELM_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#277a9e" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="2.6" fill="#277a9e" stroke="none"/><path d="M4.5 9.5C6.2 7 9 5.5 12 5.5s5.8 1.5 7.5 4"/><path d="M4.5 14.5C6.2 17 9 18.5 12 18.5s5.8-1.5 7.5-4"/></svg>';
    const CF_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#f6821f" d="M16.51 17.42a1.4 1.4 0 0 0-.4-1.94 1.36 1.36 0 0 0-.83-.23l-6.95.1a.63.63 0 0 1-.52-.29.64.64 0 0 1-.1-.35.66.66 0 0 1 .61-.62l7-.1a8.28 8.28 0 0 0 6.55-4.77l.4-.93a.4.4 0 0 0 .02-.22 9.19 9.19 0 0 0-16.53-2.7A5.19 5.19 0 0 0 .44 9.87a7.07 7.07 0 0 0 .08 1.2.62.62 0 0 0 .61.53l15.02-.02a.33.33 0 0 1 .36.36Z"/><path fill="#fbad41" d="M20.9 9.63h-.32a.2.2 0 0 0-.19.26 6.14 6.14 0 0 1 .2 2.36 5.9 5.9 0 0 1-5.9 5.9H4.4a.6.6 0 0 0-.61.61.61.61 0 0 0 .61.62h10.3A7.12 7.12 0 0 0 21.8 12.3a7.3 7.3 0 0 0-.9-2.67Z"/></svg>';
    const DEV_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#a1a1aa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>';
    const LINUX_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#f4b60b"><path d="M12.7 2c-2 0-3.3 1.3-3.6 3.2-.1.8-.1 1.6-.3 2.3-.4 1.5-1.4 2.7-2.3 4-.9 1.2-1.7 2.5-1.9 4-.1 1 .1 2 .7 2.8.2-.9.7-1.6 1.3-2.2.1.7.3 1.4.8 2 .1-2.4 1.6-4.3 3-6.2.8-1 1.5-2.1 1.8-3.4.1.5 0 1-.1 1.5 1-.6 1.7-1.6 2-2.7.4.9.4 2 0 2.9.9-.5 1.6-1.4 1.9-2.4.4 1.5.1 3.1-.8 4.3-1 1.4-2.4 2.5-3.2 4-.5 1-.7 2.1-.5 3.2.5-.6 1.2-1 2-1.1-.2.6-.5 1.2-1 1.7 1.9.4 3.9-.2 5.3-1.5 1.6-1.5 2.3-3.8 1.9-5.9-.3-1.7-1.3-3.2-2.2-4.7-.8-1.3-1.6-2.7-1.8-4.2-.2-1.6-1.3-2.7-3-2.7Z"/></svg>';
    const APPLE_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#a1a1aa"><path d="M17.05 20.28c-.98.95-2.05.88-3.08.46-1.09-.44-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.46C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.08ZM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25Z"/></svg>';
    const WINDOWS_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#0078d4"><path d="M3 5.55 10.6 4.5v7.2H3V5.55Zm0 12.9L10.6 19.5v-7.13H3v6.08Zm8.6 6.16L21 21.75v-9.38h-9.4v7.24Zm0-15.78v7.24H21V2.25l-9.4 1.58Z" transform="scale(0.85) translate(2 1)"/></svg>';
    const ARM_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#0091bd"><circle cx="12" cy="12" r="9" opacity="0.25"/><circle cx="12" cy="12" r="5.5" opacity="0.5"/><circle cx="12" cy="12" r="2.5"/></svg>';
    const INTEL_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="#0068b5"><rect x="3" y="3" width="4" height="4" rx="1"/><rect x="10" y="3" width="4" height="4" rx="1"/><rect x="17" y="3" width="4" height="4" rx="1"/><rect x="3" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/><rect x="17" y="10" width="4" height="4" rx="1"/><rect x="3" y="17" width="4" height="4" rx="1"/><rect x="10" y="17" width="4" height="4" rx="1"/><rect x="17" y="17" width="4" height="4" rx="1"/></svg>';
    const ALTINITY_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="#e63946" d="M12 2 2 20h4.5L12 9.5 17.5 20H22L12 2Z"/></svg>';

    function formatLabel(label) {
      const names = {
        unknown: 'Unknown', docker: 'Docker', helm: 'Helm', cf: 'Cloudflare',
        dev: 'Development', windows: 'Windows', macos: 'macOS', linux: 'Linux',
        android: 'Android', ios: 'iOS', oss: 'OSS', altinity: 'Altinity', cloud: 'Cloud'
      };
      return names[label] || label;
    }

    loadAnalytics();
  </script>
</body>
</html>`

      return new Response(html, {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'public, max-age=300', // 5 min cache
          ...CORS,
        },
      })
    }

    if (req.method === 'GET' && pathname === '/v1/summary') {
      return handleSummary(env, req)
    }

    if (req.method !== 'POST') return bad(405, 'method not allowed')

    const body = await readBody(req)
    if (body === null || typeof body !== 'object') {
      return bad(400, 'invalid body')
    }
    const data = body as Record<string, unknown>

    if (pathname === '/v1/ping') {
      const instanceHash = data.instance_hash
      if (typeof instanceHash !== 'string' || !HEX64.test(instanceHash)) {
        return bad(400, 'invalid instance_hash')
      }
      const deployTarget = asEnum(data.deploy_target, DEPLOY_TARGETS, 'unknown')
      const chVersion = asVersion(data.ch_version)
      const chFlavor = asEnum(data.ch_flavor, CH_FLAVORS, 'unknown')
      const country =
        typeof data.country === 'string' && COUNTRY_CODE.test(data.country)
          ? data.country.toLowerCase()
          : 'unknown'
      const platform = asEnum(data.platform, PLATFORMS, 'unknown')
      const chmVersion = asChmVersion(data.chm_version)
      // install_place: a separate opaque hash identifying the deployment
      // environment (k8s cluster, Docker host, etc.). Must be a valid SHA-256
      // hex digest — same format as instance_hash.
      const installPlace =
        typeof data.install_place === 'string' && HEX64.test(data.install_place)
          ? data.install_place
          : ''
      const licenseKey = asLicenseKey(data.license_key)

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO ping_daily (day, instance_hash, deploy_target, ch_version, ch_flavor, country, platform, chm_version, install_place, license_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            day,
            instanceHash,
            deployTarget,
            chVersion || null,
            chFlavor || null,
            country || null,
            platform || null,
            chmVersion || null,
            installPlace || null,
            licenseKey || null
          )
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
      return noContent()
    }

    if (pathname === '/v1/event') {
      const event = data.event
      if (typeof event !== 'string' || !EVENTS.has(event)) {
        return bad(400, 'invalid event')
      }
      const props = (data.props ?? {}) as Record<string, unknown>
      const deployTarget = asEnum(
        props.deploy_target,
        DEPLOY_TARGETS,
        'unknown'
      )
      const chVersion = asVersion(props.ch_version)
      const chFlavor = asEnum(props.ch_flavor, CH_FLAVORS, 'unknown')

      // Dedupe per (day, event, deploy_target, ch_version, ch_flavor): no
      // instance_hash is sent here (unlike /v1/ping), so this coarser tuple
      // is the bound — see migrations/0004_dedupe_events.sql.
      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO events (day, event, deploy_target, ch_version, ch_flavor) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(day, event, deployTarget, chVersion || null, chFlavor || null)
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
      return noContent()
    }

    if (pathname === '/v1/cli') {
      // Separate CLI tracking stream (source=cli). Closed, validated shape;
      // unknown fields ignored. install_id is an opaque SHA-256 hex of a random
      // local UUID — for one-shot installs (install.sh) it may be ephemeral.
      const installId = data.install_id
      if (typeof installId !== 'string' || !HEX64.test(installId)) {
        return bad(400, 'invalid install_id')
      }
      const event =
        typeof data.event === 'string' && CLI_EVENTS.has(data.event)
          ? data.event
          : ''
      if (!event) return bad(400, 'invalid event')
      const command = asEnum(data.command, CLI_COMMANDS, '')
      const cliVersion = asChmVersion(data.cli_version)
      const os = asEnum(data.os, PLATFORMS, 'unknown')
      const arch = asEnum(data.arch, ARCHES, 'unknown')
      const licenseKey = asLicenseKey(data.license_key)

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO cli_daily (day, install_id, event, command, cli_version, os, arch, license_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            day,
            installId,
            event,
            command,
            cliVersion || null,
            os || null,
            arch || null,
            licenseKey || null
          )
          .run()
          .then(() => undefined)
          .catch(() => undefined)
      )
      return noContent()
    }

    return bad(404, 'not found')
  },
}

// ---------------------------------------------------------------------------
// GET /v1/summary — public, aggregate-only install counts (anonymous).
// ---------------------------------------------------------------------------
// Reads the D1 forever-store (ping_daily). Every number is a
// COUNT(DISTINCT instance_hash) — distinct installs. Optional
// ?deploy_target=docker|helm|cf|dev|unknown scopes total + by_ch_version to
// that target (by_deploy_target is always global). Cached at the edge for 1h.
// license_key is persisted on ping/cli rows but never returned here.
//
// Data accumulates from the moment the D1 binding was wired (2026-07-07)
// forward; Analytics Engine still holds the prior ~3 months but is not
// binding-readable, so historical totals are not reflected here.
async function handleSummary(env: Env, req: Request): Promise<Response> {
  const base = summaryShape({
    total: 0,
    byDeployTarget: {},
    byChVersion: [],
    byChFlavor: [],
    byCountry: [],
    byPlatform: [],
  })

  if (!env.CHM_TELEMETRY_DB) {
    return json({ ...base, enabled: false }, 503)
  }

  const { searchParams } = new URL(req.url)
  const targetParam = searchParams.get('deploy_target')
  const scoped =
    targetParam && DEPLOY_TARGETS.has(targetParam) ? targetParam : null

  // Same WHERE clause for total + by-version when scoped; by_deploy_target
  // stays global so the breakdown is always visible.
  const where = scoped ? 'WHERE deploy_target = ?' : ''
  const installPlacesWhere = scoped
    ? 'WHERE deploy_target = ? AND install_place IS NOT NULL'
    : 'WHERE install_place IS NOT NULL'
  const stmt = (sql: string) =>
    scoped
      ? env.CHM_TELEMETRY_DB!.prepare(sql).bind(scoped)
      : env.CHM_TELEMETRY_DB!.prepare(sql)

  try {
    const [
      totalRow,
      byTarget,
      byVersion,
      byFlavor,
      byCountry,
      byPlatform,
      byChmVersion,
      totalPlaces,
    ] = await Promise.all([
      stmt(
        `SELECT COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where}`
      ).first<{
        n: number
      }>(),
      env
        .CHM_TELEMETRY_DB!.prepare(
          'SELECT deploy_target, COUNT(DISTINCT instance_hash) AS n FROM ping_daily GROUP BY deploy_target'
        )
        .all<{ deploy_target: string; n: number }>(),
      stmt(
        `SELECT COALESCE(ch_version, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(ch_flavor, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(country, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC LIMIT 10`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(platform, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COALESCE(chm_version, 'unknown') AS v, COUNT(DISTINCT instance_hash) AS n FROM ping_daily ${where} GROUP BY v ORDER BY n DESC`
      ).all<{ v: string; n: number }>(),
      stmt(
        `SELECT COUNT(DISTINCT install_place) AS n FROM ping_daily ${installPlacesWhere}`
      ).first<{ n: number }>(),
    ])

    const byDeployTarget: Record<string, number> = {}
    for (const r of byTarget.results ?? []) {
      byDeployTarget[r.deploy_target] = Number(r.n)
    }

    const cli = await cliSummary(env)

    return json(
      summaryShape({
        cli,
        total: Number(totalRow?.n ?? 0),
        totalPlaces: Number(totalPlaces?.n ?? 0),
        byDeployTarget,
        byChVersion: (byVersion.results ?? []).map((r) => ({
          ch_version: r.v,
          installs: Number(r.n),
        })),
        byChFlavor: (byFlavor.results ?? []).map((r) => ({
          ch_flavor: r.v,
          installs: Number(r.n),
        })),
        byCountry: (byCountry.results ?? []).map((r) => ({
          country: r.v,
          installs: Number(r.n),
        })),
        byPlatform: (byPlatform.results ?? []).map((r) => ({
          platform: r.v,
          installs: Number(r.n),
        })),
        byChmVersion: (byChmVersion.results ?? []).map((r) => ({
          chm_version: r.v,
          installs: Number(r.n),
        })),
        scopedToDeployTarget: scoped,
      }),
      200
    )
  } catch {
    return json({ ...base, enabled: true, error: 'summary query failed' }, 500)
  }
}

interface CliSummary {
  installs: number
  active_users: number
  by_command: { command: string; runs: number }[]
  by_cli_version: { cli_version: string; installs: number }[]
  by_os: { os: string; installs: number }[]
  by_arch: { arch: string; installs: number }[]
  installs_over_time: { day: string; installs: number }[]
}

const EMPTY_CLI: CliSummary = {
  installs: 0,
  active_users: 0,
  by_command: [],
  by_cli_version: [],
  by_os: [],
  by_arch: [],
  installs_over_time: [],
}

// Aggregate-only CLI stats from cli_daily. Every number is a COUNT/COUNT
// DISTINCT of the opaque install_id — no per-install rows, IPs, or free-text
// are exposed. Best-effort: any query failure degrades to zeros.
async function cliSummary(env: Env): Promise<CliSummary> {
  try {
    const [installs, active, byCommand, byVersion, byOs, byArch, overTime] =
      await Promise.all([
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COUNT(*) AS n FROM cli_daily WHERE event = 'cli_install'"
        ).first<{ n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COUNT(DISTINCT install_id) AS n FROM cli_daily WHERE event != 'cli_install'"
        ).first<{ n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT command AS v, COUNT(*) AS n FROM cli_daily WHERE event != 'cli_install' AND command != '' GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COALESCE(cli_version, 'unknown') AS v, COUNT(DISTINCT install_id) AS n FROM cli_daily GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COALESCE(os, 'unknown') AS v, COUNT(DISTINCT install_id) AS n FROM cli_daily GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT COALESCE(arch, 'unknown') AS v, COUNT(DISTINCT install_id) AS n FROM cli_daily GROUP BY v ORDER BY n DESC"
        ).all<{ v: string; n: number }>(),
        env.CHM_TELEMETRY_DB.prepare(
          "SELECT day, COUNT(*) AS n FROM cli_daily WHERE event = 'cli_install' AND day >= date('now', '-30 days') GROUP BY day ORDER BY day ASC"
        ).all<{ day: string; n: number }>(),
      ])

    return {
      installs: Number(installs?.n ?? 0),
      active_users: Number(active?.n ?? 0),
      by_command: (byCommand.results ?? []).map((r) => ({
        command: r.v,
        runs: Number(r.n),
      })),
      by_cli_version: (byVersion.results ?? []).map((r) => ({
        cli_version: r.v,
        installs: Number(r.n),
      })),
      by_os: (byOs.results ?? []).map((r) => ({
        os: r.v,
        installs: Number(r.n),
      })),
      by_arch: (byArch.results ?? []).map((r) => ({
        arch: r.v,
        installs: Number(r.n),
      })),
      installs_over_time: (overTime.results ?? []).map((r) => ({
        day: r.day,
        installs: Number(r.n),
      })),
    }
  } catch {
    return EMPTY_CLI
  }
}

interface SummaryBody {
  summary: string
  anonymous: boolean
  enabled: boolean
  scoped_to_deploy_target: string | null
  total_installs: number
  total_places: number
  by_deploy_target: Record<string, number>
  by_ch_version: { ch_version: string; installs: number }[]
  by_ch_flavor: { ch_flavor: string; installs: number }[]
  by_country: { country: string; installs: number }[]
  by_platform: { platform: string; installs: number }[]
  by_chm_version: { chm_version: string; installs: number }[]
  cli: CliSummary
  source: string
  generated_at: string
}

function summaryShape(input: {
  total: number
  totalPlaces?: number
  byDeployTarget: Record<string, number>
  byChVersion: { ch_version: string; installs: number }[]
  byChFlavor: { ch_flavor: string; installs: number }[]
  byCountry: { country: string; installs: number }[]
  byPlatform: { platform: string; installs: number }[]
  byChmVersion?: { chm_version: string; installs: number }[]
  cli?: CliSummary
  scopedToDeployTarget?: string | null
}): SummaryBody {
  return {
    summary: 'chmonitor install counts',
    anonymous: true,
    enabled: true,
    scoped_to_deploy_target: input.scopedToDeployTarget ?? null,
    total_installs: input.total,
    total_places: input.totalPlaces ?? 0,
    by_deploy_target: input.byDeployTarget,
    by_ch_version: input.byChVersion,
    by_ch_flavor: input.byChFlavor,
    by_country: input.byCountry,
    by_platform: input.byPlatform,
    by_chm_version: input.byChmVersion ?? [],
    cli: input.cli ?? EMPTY_CLI,
    source: 'D1 ping_daily (COUNT DISTINCT of opaque SHA-256 instance id)',
    generated_at: new Date().toISOString(),
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600, stale-while-revalidate=86400',
      ...CORS,
    },
  })
}
