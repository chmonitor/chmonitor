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
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
      color: #333;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      padding: 40px;
    }

    h1 {
      font-size: 2.5rem;
      margin-bottom: 10px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .subtitle {
      color: #666;
      margin-bottom: 30px;
      font-size: 1.1rem;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #666;
      font-size: 1.2rem;
    }

    .error {
      background: #fee;
      border: 1px solid #fcc;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      color: #c33;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }

    .stat-card {
      background: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      border: 1px solid #e9ecef;
    }

    .stat-label {
      font-size: 0.9rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 8px;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: bold;
      color: #667eea;
    }

    .section {
      margin-bottom: 40px;
    }

    .section h2 {
      font-size: 1.5rem;
      margin-bottom: 20px;
      color: #333;
      border-bottom: 2px solid #667eea;
      padding-bottom: 10px;
    }

    .bar-chart {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .bar-item {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .bar-label {
      min-width: 120px;
      font-weight: 500;
      color: #555;
    }

    .bar-track {
      flex: 1;
      background: #e9ecef;
      height: 24px;
      border-radius: 4px;
      overflow: hidden;
      position: relative;
    }

    .bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
      transition: width 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding-right: 8px;
    }

    .bar-value {
      color: white;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .info-box {
      background: #e7f3ff;
      border: 1px solid #b3d9ff;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 30px;
    }

    .info-box h3 {
      color: #004085;
      margin-bottom: 10px;
    }

    .info-box p {
      color: #004085;
      line-height: 1.6;
    }

    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e9ecef;
      text-align: center;
      color: #666;
      font-size: 0.9rem;
    }

    @media (max-width: 768px) {
      .container {
        padding: 20px;
      }

      h1 {
        font-size: 2rem;
      }

      .stats-grid {
        grid-template-columns: 1fr;
      }

      .bar-item {
        flex-direction: column;
        align-items: flex-start;
      }

      .bar-label {
        margin-bottom: 4px;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 chmonitor Telemetry</h1>
    <p class="subtitle">Anonymous ClickHouse monitoring adoption analytics</p>

    <div id="loading" class="loading">Loading analytics...</div>
    <div id="error" class="error" style="display: none;"></div>

    <div id="content" style="display: none;">
      <div class="info-box">
        <h3>🔒 Privacy-First Analytics</h3>
        <p>
          All data is <strong>100% anonymous</strong>. No IPs, hostnames, or identifying information.
          Only COUNT(DISTINCT) of SHA-256 hashed instance IDs. Each install generates a unique
          hash that cannot be reversed to identify the original instance.
        </p>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">Total Installs</div>
          <div class="stat-value" id="total">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Data Source</div>
          <div class="stat-value" id="source">-</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">Last Updated</div>
          <div class="stat-value" id="updated" style="font-size: 1rem;">-</div>
        </div>
      </div>

      <div class="section">
        <h2>🚀 Deployment Targets</h2>
        <div id="deploy-targets" class="bar-chart"></div>
      </div>

      <div class="section">
        <h2>📦 ClickHouse Versions</h2>
        <div id="ch-versions" class="bar-chart"></div>
      </div>

      <div class="section">
        <h2>🌍 Geographic Distribution</h2>
        <div id="countries" class="bar-chart"></div>
      </div>

      <div class="section">
        <h2>💻 Platform Distribution</h2>
        <div id="platforms" class="bar-chart"></div>
      </div>

      <div class="footer">
        <p>
          Data updates every hour • Powered by <a href="https://chmonitor.dev" style="color: #667eea;">chmonitor</a> •
          <a href="https://github.com/chmonitor/chmonitor" style="color: #667eea;">GitHub</a>
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
        document.getElementById('source').textContent = data.source.split('(')[0].trim();
        document.getElementById('updated').textContent = new Date(data.generated_at).toLocaleString();

        // Render deployment targets
        renderBarChart('deploy-targets', data.by_deploy_target);

        // Render ClickHouse versions
        renderBarChart('ch-versions', data.by_ch_version);

        // Render countries
        renderBarChart('countries', data.by_country);

        // Render platforms
        renderBarChart('platforms', data.by_platform);

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
                <div class="bar-fill" style="width: \${percentage}%;">
                  <span class="bar-value">\${item.installs.toLocaleString()}</span>
                </div>
              </div>
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
