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
      // Serve the analytics dashboard HTML
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>chmonitor Telemetry Analytics</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg: #ffffff;
      --fg: #1a1a1a;
      --fg-muted: #666666;
      --border: #f0f0f3;
      --bg-box: #f5f5f5;
      --accent: #f97316;
    }

    body {
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background: var(--bg);
      color: var(--fg);
      padding: 0;
      margin: 0;
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .nav-bar {
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 100;
      padding: 16px 24px;
    }

    .nav-container {
      max-width: 1000px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .logo {
      font-size: 1.25rem;
      font-weight: 800;
      color: var(--fg);
      text-decoration: none;
      letter-spacing: -0.03em;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .logo span {
      color: var(--fg);
    }

    .nav-links {
      display: flex;
      gap: 32px;
    }

    .nav-links a {
      color: var(--fg-muted);
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: color 0.15s ease;
    }

    .nav-links a:hover {
      color: var(--fg);
    }

    .btn-primary {
      background: #09090b;
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 650;
      transition: all 0.15s ease;
    }

    .btn-primary:hover {
      background: #27272a;
      transform: translateY(-1px);
    }

    .container {
      max-width: 680px;
      margin: 60px auto 0;
      padding: 0 24px;
    }

    header {
      margin-bottom: 48px;
      text-align: center;
    }

    h1 {
      font-size: 3rem;
      font-weight: 850;
      color: var(--fg);
      margin-bottom: 16px;
      letter-spacing: -0.04em;
      line-height: 1.1;
    }

    .subtitle {
      color: var(--fg-muted);
      font-size: 1.15rem;
      font-weight: 450;
      max-width: 520px;
      margin: 0 auto;
      letter-spacing: -0.01em;
      line-height: 1.5;
    }

    .loading {
      padding: 80px 0;
      color: var(--fg-muted);
      font-size: 0.95rem;
      text-align: center;
    }

    .error {
      border: none;
      padding: 24px;
      margin: 40px 0;
      color: #df3c3c;
      background: #fef2f2;
      border-radius: 12px;
      font-size: 0.95rem;
    }

    .info-box {
      border: none;
      background: #fffbeb;
      padding: 28px;
      margin-bottom: 40px;
      border-radius: 14px;
    }

    .info-box h3 {
      font-size: 1.1rem;
      font-weight: 700;
      color: #92400e;
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .info-box p {
      font-size: 0.9rem;
      color: #b45309;
      line-height: 1.6;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 48px;
    }

    .stat-card {
      border: none;
      background: #f0f7ff;
      padding: 32px 28px;
      border-radius: 14px;
      text-align: left;
      transition: transform 0.2s ease;
    }

    .stat-card:hover {
      transform: translateY(-2px);
    }

    .stat-card.environments {
      background: #f5f3ff;
    }

    .stat-card.environments .stat-label {
      color: #6b21a8;
    }

    .stat-card.environments .stat-value {
      color: #581c87;
    }

    .stat-label {
      font-size: 0.8rem;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
      font-weight: 700;
    }

    .stat-value {
      font-size: 3.5rem;
      font-weight: 900;
      color: #1e40af;
      line-height: 1;
      letter-spacing: -0.05em;
    }

    .section {
      margin-bottom: 48px;
    }

    .section h2 {
      font-size: 1.35rem;
      font-weight: 800;
      color: var(--fg);
      margin-bottom: 20px;
      letter-spacing: -0.03em;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }

    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .bar-item {
      display: flex;
      align-items: center;
      font-size: 0.9rem;
    }

    .bar-label {
      width: 160px;
      flex-shrink: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      color: var(--fg);
      font-weight: 550;
      letter-spacing: -0.01em;
    }

    .bar-track {
      flex-grow: 1;
      height: 8px;
      background: #f4f4f7;
      margin: 0 20px;
      border-radius: 4px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: #f97316;
      border-radius: 4px;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .bar-value {
      width: 80px;
      text-align: right;
      font-weight: 700;
      flex-shrink: 0;
      color: var(--fg);
    }

    .footer {
      margin-top: 64px;
      padding: 32px 0;
      border-top: 1px solid var(--border);
      font-size: 0.85rem;
      color: var(--fg-muted);
      text-align: left;
    }

    .footer a {
      color: var(--fg);
      text-decoration: underline;
      text-underline-offset: 4px;
    }

    .footer a:hover {
      color: #f97316;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0b0b0e;
        --fg: #f4f4f5;
        --fg-muted: #8a8a93;
        --border: #1e1e24;
      }

      .nav-bar {
        background: rgba(11, 11, 14, 0.85);
      }

      .logo span {
        color: #f4f4f5;
      }

      .btn-primary {
        background: #fafafa;
        color: #09090b;
      }

      .btn-primary:hover {
        background: #e4e4e7;
      }

      .info-box {
        background: #1e1910;
      }

      .info-box h3 {
        color: #fef08a;
      }

      .info-box p {
        color: #fef08a;
        opacity: 0.85;
      }

      .stat-card {
        background: #111827;
      }

      .stat-card.environments {
        background: #1e1b4b;
      }

      .stat-card.environments .stat-label {
        color: #c084fc;
      }

      .stat-card.environments .stat-value {
        color: #e9d5ff;
      }

      .stat-label {
        color: #60a5fa;
      }

      .stat-value {
        color: #93c5fd;
      }

      .bar-track {
        background: #181820;
      }
    }

    @media (max-width: 600px) {
      .container {
        margin-top: 32px;
      }
      h1 {
        font-size: 2.25rem;
      }
      .subtitle {
        font-size: 1.05rem;
      }
      .stats-grid {
        grid-template-columns: 1fr;
        gap: 16px;
      }
      .bar-item {
        flex-wrap: wrap;
      }
      .bar-track {
        width: 100%;
        margin: 12px 0 4px;
        order: 3;
      }
      .bar-value {
        margin-left: auto;
      }
    }
  </style>
</head>
<body>
  <nav class="nav-bar">
    <div class="nav-container">
      <a href="https://chmonitor.dev" class="logo">
        <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="chmonitor">
          <rect x="3.3" y="13.05" width="3.8" height="15.45" fill="#f97316"/><rect x="8.7" y="3.5" width="3.8" height="25" fill="#f97316"/><rect x="14.1" y="13.25" width="3.8" height="15.25" fill="#f97316"/><rect x="19.5" y="6.25" width="3.8" height="22.25" fill="#f97316"/><rect x="24.9" y="16.8" width="3.8" height="11.7" fill="#f97316"/><rect x="3.3" y="9.75" width="3.8" height="3.3" fill="#10b981"/>
        </svg>
        <span>chmonitor</span>
      </a>
      <div class="nav-links">
        <a href="https://chmonitor.dev">Overview</a>
        <a href="https://docs.chmonitor.dev">Docs</a>
        <a href="https://github.com/chmonitor/chmonitor">GitHub</a>
      </div>
      <a href="https://github.com/chmonitor/chmonitor" class="btn-primary">Get Started</a>
    </div>
  </nav>

  <div class="container">
    <header>
      <h1>Telemetry Analytics.</h1>
      <p class="subtitle">Adoption statistics and installation insights for the open-source ClickHouse monitoring dashboard.</p>
    </header>

    <div id="loading" class="loading">Loading analytics...</div>
    <div id="error" class="error" style="display: none;"></div>

    <div id="content" style="display: none;">
      <div class="info-box">
        <h3>Privacy-First Analytics</h3>
        <p>
          All data is 100% anonymous. No IPs, hostnames, or identifying information are recorded.
          Only COUNT(DISTINCT) of SHA-256 hashed instance IDs are processed. Each install generates a unique
          hash that cannot be reversed to identify the original instance.
        </p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Installs</div>
          <div class="stat-value" id="total">0</div>
        </div>
        <div class="stat-card environments">
          <div class="stat-label">Total Environments</div>
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
        <h2>Geographic Distribution</h2>
        <div id="countries" class="bar-chart"></div>
      </div>

      <div class="section">
        <h2>Platform Distribution</h2>
        <div id="platforms" class="bar-chart"></div>
      </div>

      <div class="section" id="ch-flavor-section" style="display: none;">
        <h2>ClickHouse Flavors</h2>
        <div id="ch-flavors" class="bar-chart"></div>
      </div>

      <div class="footer">
        <p>
          Data updates every hour • Powered by <a href="https://chmonitor.dev">chmonitor</a> •
          <a href="https://github.com/chmonitor/chmonitor">GitHub</a>
        </p>
      </div>
    </div>
  </div>

  <script>
    async function loadAnalytics() {
      const loading = document.getElementById('loading');
      const error = document.getElementById('error');
      const content = document.getElementById('content');

      try {
        const response = await fetch('https://telemetry.chmonitor.dev/v1/summary');

        if (!response.ok) {
          throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        loading.style.display = 'none';
        content.style.display = 'block';

        // Update stats cards
        document.getElementById('total').textContent = data.total_installs.toLocaleString();
        if (data.total_places !== undefined) {
          document.getElementById('total-places').textContent = data.total_places.toLocaleString();
        }

        // Render deployment targets
        const deployTargetsArray = Object.entries(data.by_deploy_target || {}).map(([target, installs]) => ({
          deploy_target: target,
          installs: installs
        }));
        renderBarChart('deploy-targets', deployTargetsArray);

        // Render ClickHouse versions
        renderBarChart('ch-versions', data.by_ch_version);

        // Render chmonitor versions
        if (data.by_chm_version) {
          renderBarChart('chm-versions', data.by_chm_version);
        }

        // Render countries
        renderBarChart('countries', data.by_country);

        // Render platforms
        renderBarChart('platforms', data.by_platform);

        // Render ClickHouse flavors (if available)
        if (data.by_ch_flavor && data.by_ch_flavor.length > 0) {
          document.getElementById('ch-flavor-section').style.display = 'block';
          renderBarChart('ch-flavors', data.by_ch_flavor);
        }

      } catch (err) {
        loading.style.display = 'none';
        error.style.display = 'block';
        error.textContent = \`Failed to load analytics: \${err.message}\`;
        console.error('Analytics loading error:', err);
      }
    }

    function renderBarChart(containerId, data) {
      const container = document.getElementById(containerId);
      if (!data || data.length === 0) {
        container.innerHTML = '<p style="color: #999;">No data available</p>';
        return;
      }

      const maxValue = Math.max(...data.map(item => item.installs));

      container.innerHTML = data
        .sort((a, b) => b.installs - a.installs)
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
      if (label === 'unknown') return 'Unknown';
      if (label === 'docker') return 'Docker';
      if (label === 'helm') return 'Helm';
      if (label === 'cf') return 'Cloudflare';
      if (label === 'dev') return 'Development';
      if (label === 'windows') return 'Windows';
      if (label === 'macos') return 'macOS';
      if (label === 'linux') return 'Linux';
      if (label === 'android') return 'Android';
      if (label === 'ios') return 'iOS';
      if (label === 'oss') return 'OSS';
      if (label === 'altinity') return 'Altinity';
      if (label === 'cloud') return 'Cloud';
      return label;
    }

    // Load analytics on page load
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

      const day = new Date().toISOString().slice(0, 10)
      ctx.waitUntil(
        env.CHM_TELEMETRY_DB.prepare(
          'INSERT INTO events (day, event, deploy_target, ch_version, ch_flavor) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(day, event, deployTarget, chVersion || null, chFlavor || null)
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
        `SELECT COUNT(DISTINCT install_place) AS n FROM ping_daily ${where} WHERE install_place IS NOT NULL`
      ).first<{ n: number }>(),
    ])

    const byDeployTarget: Record<string, number> = {}
    for (const r of byTarget.results ?? []) {
      byDeployTarget[r.deploy_target] = Number(r.n)
    }

    return json(
      summaryShape({
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
