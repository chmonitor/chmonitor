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
  CHM_TELEMETRY_AE: AnalyticsEngineDataset
  // Optional forever-retention store. Analytics Engine keeps data for only 3
  // months; when a D1 binding is present we ALSO record one deduped row per
  // install per UTC day, which D1 keeps indefinitely (CF-native, free tier).
  // Deploy works without it (AE-only) until the binding is configured.
  CHM_TELEMETRY_DB?: D1Database
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
      --border: #e5e5e5;
      --bg-box: #f5f5f5;
      --accent: #2383e2;
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
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(8px);
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
    }

    .logo span {
      color: var(--accent);
      margin: 0 1px;
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
      background: var(--fg);
      color: #ffffff;
      padding: 10px 20px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: background 0.15s ease;
    }

    .btn-primary:hover {
      background: #333333;
    }

    .container {
      max-width: 680px;
      margin: 80px auto 0;
      padding: 0 24px;
    }

    header {
      margin-bottom: 60px;
      text-align: center;
    }

    h1 {
      font-size: 3rem;
      font-weight: 800;
      color: var(--fg);
      margin-bottom: 16px;
      letter-spacing: -0.04em;
      line-height: 1.15;
    }

    .subtitle {
      color: var(--fg-muted);
      font-size: 1.25rem;
      font-weight: 400;
      max-width: 500px;
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
      border: 1px solid #d44c47;
      padding: 24px;
      margin: 40px 0;
      color: #d44c47;
      background: #fff;
      border-radius: 8px;
      font-size: 0.95rem;
    }

    .info-box {
      border: 1px solid var(--border);
      background: #ffffff;
      padding: 28px;
      margin-bottom: 48px;
      border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .info-box h3 {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--fg);
      margin-bottom: 8px;
      letter-spacing: -0.02em;
    }

    .info-box p {
      font-size: 0.9rem;
      color: var(--fg-muted);
      line-height: 1.6;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr;
      margin-bottom: 48px;
    }

    .stat-card {
      border: 1px solid var(--border);
      background: #ffffff;
      padding: 36px 28px;
      border-radius: 12px;
      text-align: left;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .stat-label {
      font-size: 0.85rem;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 12px;
      font-weight: 600;
    }

    .stat-value {
      font-size: 4rem;
      font-weight: 800;
      color: var(--fg);
      line-height: 1;
      letter-spacing: -0.05em;
    }

    .section {
      margin-bottom: 56px;
    }

    .section h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--fg);
      margin-bottom: 24px;
      letter-spacing: -0.03em;
      border-bottom: 1px solid var(--border);
      padding-bottom: 12px;
    }

    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 16px;
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
      font-weight: 500;
      letter-spacing: -0.01em;
    }

    .bar-track {
      flex-grow: 1;
      height: 8px;
      background: #f5f5f5;
      margin: 0 24px;
      border-radius: 4px;
      overflow: hidden;
    }

    .bar-fill {
      height: 100%;
      background: var(--fg);
      border-radius: 4px;
      transition: width 0.6s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .bar-value {
      width: 80px;
      text-align: right;
      font-weight: 600;
      flex-shrink: 0;
      color: var(--fg);
    }

    .footer {
      margin-top: 80px;
      padding: 40px 0;
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
      color: var(--accent);
    }

    @media (max-width: 600px) {
      .container {
        margin-top: 40px;
      }
      h1 {
        font-size: 2.25rem;
      }
      .subtitle {
        font-size: 1.1rem;
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
      <a href="https://chmonitor.dev" class="logo">chm<span>/</span>nitor</a>
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

        // Render deployment targets
        const deployTargetsArray = Object.entries(data.by_deploy_target || {}).map(([target, installs]) => ({
          deploy_target: target,
          installs: installs
        }));
        renderBarChart('deploy-targets', deployTargetsArray);

        // Render ClickHouse versions
        renderBarChart('ch-versions', data.by_ch_version);

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

      env.CHM_TELEMETRY_AE.writeDataPoint({
        // index1 — distinct-install key. Count installs with uniqExact(index1).
        indexes: [instanceHash],
        // blob1=kind, blob2=deploy_target, blob3=ch_version, blob4=ch_flavor, blob5=country, blob6=platform
        blobs: ['ping', deployTarget, chVersion, chFlavor, country, platform],
        doubles: [1],
      })

      // Forever retention (optional): AE keeps only 3 months, so when a D1
      // binding is present also record one deduped row per install per UTC day.
      // INSERT OR IGNORE on (day, instance_hash) keeps storage to one row per
      // install per day; D1 retains it indefinitely. Runs after the response.
      if (env.CHM_TELEMETRY_DB) {
        const day = new Date().toISOString().slice(0, 10) // YYYY-MM-DD (UTC)
        ctx.waitUntil(
          env.CHM_TELEMETRY_DB.prepare(
            'INSERT OR IGNORE INTO ping_daily (day, instance_hash, deploy_target, ch_version, ch_flavor, country, platform) VALUES (?, ?, ?, ?, ?, ?, ?)'
          )
            .bind(
              day,
              instanceHash,
              deployTarget,
              chVersion || null,
              chFlavor || null,
              country || null,
              platform || null
            )
            .run()
            .then(() => undefined)
            .catch(() => undefined)
        )
      }
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

      env.CHM_TELEMETRY_AE.writeDataPoint({
        // events carry no instance identity — index by event name.
        indexes: [event],
        // blob1=kind, blob2=event, blob3=deploy_target, blob4=ch_version, blob5=ch_flavor
        blobs: ['event', event, deployTarget, chVersion, chFlavor],
        doubles: [1],
      })
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
    const [totalRow, byTarget, byVersion, byFlavor, byCountry, byPlatform] =
      await Promise.all([
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
      ])

    const byDeployTarget: Record<string, number> = {}
    for (const r of byTarget.results ?? []) {
      byDeployTarget[r.deploy_target] = Number(r.n)
    }

    return json(
      summaryShape({
        total: Number(totalRow?.n ?? 0),
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
  by_deploy_target: Record<string, number>
  by_ch_version: { ch_version: string; installs: number }[]
  by_ch_flavor: { ch_flavor: string; installs: number }[]
  by_country: { country: string; installs: number }[]
  by_platform: { platform: string; installs: number }[]
  source: string
  generated_at: string
}

function summaryShape(input: {
  total: number
  byDeployTarget: Record<string, number>
  byChVersion: { ch_version: string; installs: number }[]
  byChFlavor: { ch_flavor: string; installs: number }[]
  byCountry: { country: string; installs: number }[]
  byPlatform: { platform: string; installs: number }[]
  scopedToDeployTarget?: string | null
}): SummaryBody {
  return {
    summary: 'chmonitor install counts',
    anonymous: true,
    enabled: true,
    scoped_to_deploy_target: input.scopedToDeployTarget ?? null,
    total_installs: input.total,
    by_deploy_target: input.byDeployTarget,
    by_ch_version: input.byChVersion,
    by_ch_flavor: input.byChFlavor,
    by_country: input.byCountry,
    by_platform: input.byPlatform,
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
