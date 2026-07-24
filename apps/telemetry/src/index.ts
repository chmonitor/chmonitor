// chmonitor telemetry collector — the ingest endpoint that CHM_TELEMETRY_ENDPOINT
// points at. Receives the anonymous instance ping (and optional aggregate
// events) emitted by apps/dashboard/src/lib/telemetry and records them to
// Cloudflare Analytics Engine.
//
// Privacy contract (mirrors the dashboard client, defense-in-depth):
//   - Accepts ONLY a closed, validated shape. Unknown fields are ignored.
//   - instance_hash is a SHA-256 hex digest of a random local id — opaque, not
//     reversible to any identity. It is the only per-instance value, used purely
//     to count distinct installs.
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
      // Serve the analytics dashboard HTML (simple two-tab page:
      // Dashboard (OSS) installs vs CLI usage — separate streams).
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>chmonitor Telemetry</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }

    :root {
      --bg: #ffffff;
      --fg: #18181b;
      --fg-muted: #71717a;
      --border: #e4e4e7;
      --card: #fafafa;
      --accent: #f97316;
      --code-bg: #f4f4f5;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0b0e;
        --fg: #f4f4f5;
        --fg-muted: #8a8a93;
        --border: #26262c;
        --card: #131316;
        --code-bg: #1e1e24;
      }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background: var(--bg);
      color: var(--fg);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .nav-bar {
      border-bottom: 1px solid var(--border);
      padding: 14px 24px;
    }

    .nav-container {
      max-width: 720px;
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
      max-width: 720px;
      margin: 44px auto 0;
      padding: 0 24px 64px;
    }

    header { margin-bottom: 28px; }

    h1 {
      font-size: 1.9rem;
      font-weight: 800;
      letter-spacing: -0.03em;
      margin-bottom: 6px;
    }

    .subtitle {
      color: var(--fg-muted);
      font-size: 0.95rem;
      max-width: 560px;
    }

    .privacy-note {
      font-size: 0.85rem;
      color: var(--fg-muted);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }

    .privacy-note strong { color: var(--fg); font-weight: 650; }

    .opt-out {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      font-size: 0.85rem;
      color: var(--fg-muted);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      margin-bottom: 32px;
    }

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

    .opt-out a { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }

    .tabs {
      display: flex;
      gap: 4px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 28px;
    }

    .tab {
      appearance: none;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      padding: 10px 14px;
      font: inherit;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--fg-muted);
      cursor: pointer;
    }

    .tab:hover { color: var(--fg); }

    .tab.active {
      color: var(--fg);
      border-bottom-color: var(--accent);
    }

    .loading, .empty {
      padding: 60px 0;
      color: var(--fg-muted);
      font-size: 0.9rem;
      text-align: center;
    }

    .error {
      padding: 20px;
      margin: 32px 0;
      color: #dc2626;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 0.9rem;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-bottom: 36px;
    }

    .stat-card {
      border: 1px solid var(--border);
      background: var(--card);
      padding: 20px;
      border-radius: 12px;
    }

    .stat-label {
      font-size: 0.75rem;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 6px;
      font-weight: 650;
    }

    .stat-value {
      font-size: 2.2rem;
      font-weight: 800;
      line-height: 1.1;
      letter-spacing: -0.03em;
    }

    .section { margin-bottom: 36px; }

    .section h2 {
      font-size: 1rem;
      font-weight: 700;
      margin-bottom: 14px;
      letter-spacing: -0.01em;
    }

    .bar-chart { display: flex; flex-direction: column; gap: 10px; }

    .bar-item { display: flex; align-items: center; font-size: 0.875rem; }

    .bar-label {
      width: 140px;
      flex-shrink: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-weight: 550;
    }

    .bar-track {
      flex-grow: 1;
      height: 7px;
      background: var(--code-bg);
      margin: 0 16px;
      border-radius: 4px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--accent);
      border-radius: 4px;
      transition: width 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .bar-value {
      width: 64px;
      text-align: right;
      font-weight: 700;
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
    }

    .footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
      color: var(--fg-muted);
    }

    .footer a { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }

    @media (max-width: 600px) {
      .container { margin-top: 28px; }
      h1 { font-size: 1.55rem; }
      .stats-grid { grid-template-columns: 1fr; }
      .bar-item { flex-wrap: wrap; }
      .bar-track { width: 100%; margin: 8px 0 2px; order: 3; }
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
        </div>
        <div class="stat-card">
          <div class="stat-label">Environments</div>
          <div class="stat-value" id="total-places">0</div>
        </div>
      </div>

      <div class="section">
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

      <div class="section">
        <h2>Countries</h2>
        <div id="countries" class="bar-chart"></div>
      </div>

      <div class="section">
        <h2>Platforms</h2>
        <div id="platforms" class="bar-chart"></div>
      </div>

      <div class="section" id="ch-flavor-section" style="display: none;">
        <h2>ClickHouse Flavors</h2>
        <div id="ch-flavors" class="bar-chart"></div>
      </div>
    </div>

    <div id="panel-cli" role="tabpanel" style="display: none;">
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">CLI Installs</div>
          <div class="stat-value" id="cli-installs">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Active CLI Users</div>
          <div class="stat-value" id="cli-active">0</div>
        </div>
      </div>

      <div class="section">
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
        renderBarChart('deploy-targets', Object.entries(data.by_deploy_target || {}).map(([target, installs]) => ({
          deploy_target: target,
          installs: installs
        })));
        renderBarChart('ch-versions', data.by_ch_version);
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
        .map(item => {
          const percentage = (item.installs / maxValue) * 100;
          const key = Object.keys(item).find(k => k !== 'installs');
          const label = item[key];

          return \`
            <div class="bar-item">
              <div class="bar-label">\${formatLabel(label)}</div>
              <div class="bar-track">
                <div class="bar-fill" style="width: \${percentage}%;"></div>
              </div>
              <div class="bar-value">\${item.installs.toLocaleString()}</div>
            </div>
          \`;
        })
        .join('');
    }

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

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO ping_daily (day, instance_hash, deploy_target, ch_version, ch_flavor, country, platform, chm_version, install_place) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
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
            installPlace || null
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

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT OR IGNORE INTO cli_daily (day, install_id, event, command, cli_version, os, arch) VALUES (?, ?, ?, ?, ?, ?, ?)'
        )
          .bind(
            day,
            installId,
            event,
            command,
            cliVersion || null,
            os || null,
            arch || null
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
