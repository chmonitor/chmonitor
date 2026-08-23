/** Public telemetry analytics HTML. Chrome matches the landing site. */
export const TELEMETRY_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>chmonitor Telemetry</title>
  <meta name="description" content="Anonymous adoption stats for the open-source ClickHouse monitoring dashboard and the chm CLI." />
  <link rel="canonical" href="https://telemetry.chmonitor.dev/" />
  <link rel="icon" href="https://chmonitor.dev/favicon.ico" sizes="any" />
  <link rel="icon" type="image/svg+xml" href="https://chmonitor.dev/favicon.svg" />
  <link rel="preload" href="https://chmonitor.dev/fonts/geist-latin.woff2" as="font" type="font/woff2" crossorigin />
  <style>
    @font-face{font-family:'Geist';font-style:normal;font-weight:400 700;font-display:swap;src:url('https://chmonitor.dev/fonts/geist-latin.woff2') format('woff2')}
    @font-face{font-family:'Geist Mono';font-style:normal;font-weight:400;font-display:swap;src:url('https://chmonitor.dev/fonts/geist-mono-latin-400.woff2') format('woff2')}
    :root{
      --bg:#ffffff;--bg-soft:#fafafa;--fg:#26251e;--fg-soft:#5a5852;--muted-fg:#807d72;
      --border:#e7e6e2;--border-soft:#f1f0ed;--border-hover:#cfcdc4;--muted:#f1f0ed;--card:#ffffff;
      --primary:#26251e;--primary-fg:#ffffff;--brand:#f54e00;--orange:#b03800;--emerald:#1f8a65;
      --radius:8px;--radius-card:12px;--maxw:1080px;--accent:#f54e00;--code-bg:#f1f0ed;
    }
    :root[data-theme="dark"]{
      --bg:#0a0a0a;--bg-soft:#0d0d0d;--fg:#ffffff;--fg-soft:#c9cbd1;--muted-fg:#9ca3af;
      --border:rgba(255,255,255,.10);--border-soft:rgba(255,255,255,.06);--border-hover:rgba(255,255,255,.20);
      --muted:#1a1a1a;--card:#141414;--primary:#ffffff;--primary-fg:#0a0a0a;--brand:#f97316;--orange:#fb923c;
      --emerald:#35b184;--accent:#f97316;--code-bg:#1a1a1a;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    button{border:0 solid transparent}
    html{scroll-behavior:smooth}
    body{background:var(--bg);color:var(--fg);font-family:'Geist',ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;line-height:1.5;min-height:100vh}
    a{color:inherit;text-decoration:none}
    .wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
    .mono{font-family:'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace}

    header.nav{position:sticky;top:0;z-index:80;background:transparent;border-bottom:1px solid transparent}
    header.nav[data-scrolled]{background:color-mix(in oklab, var(--bg) 86%, transparent);backdrop-filter:blur(10px);border-bottom-color:var(--border-soft)}
    .nav-row{display:flex;align-items:center;justify-content:space-between;gap:24px;height:64px}
    .brand{display:flex;align-items:center;gap:10px;font-weight:600;font-size:15px;letter-spacing:-.02em}
    .mark{width:22px;height:22px;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
    .mark img,.mark svg{width:100%;height:100%;object-fit:contain;display:block}
    .nav-links{display:flex;align-items:center;gap:4px}
    .nav-links>a,.nav-trigger{display:inline-flex;align-items:center;height:36px;padding:0 12px;border-radius:var(--radius);font-size:14px;font-weight:500;color:var(--muted-fg);white-space:nowrap;background:none;border:none;cursor:pointer;font-family:inherit;gap:5px}
    .nav-links>a:hover,.nav-trigger:hover{background:var(--muted);color:var(--fg)}
    .nav-trigger svg{width:13px;height:13px;opacity:.7}
    .nav-group{position:relative}
    .nav-menu{position:absolute;top:calc(100% + 10px);left:50%;transform:translateX(-50%) translateY(6px);min-width:230px;padding:6px;background:var(--card);border:1px solid var(--border);border-radius:12px;box-shadow:0 4px 12px -6px rgba(0,0,0,.18);display:flex;flex-direction:column;opacity:0;visibility:hidden;pointer-events:none;z-index:60}
    .nav-group:hover .nav-menu,.nav-group:focus-within .nav-menu{opacity:1;visibility:visible;pointer-events:auto;transform:translateX(-50%) translateY(0)}
    .nav-menu a{display:flex;flex-direction:column;gap:2px;padding:9px 11px;border-radius:6px;font-size:14px;font-weight:500;color:var(--fg-soft)}
    .nav-menu a:hover{background:var(--muted);color:var(--fg)}
    .nav-menu a small{font-size:12px;font-weight:400;color:var(--muted-fg)}
    .nav-cta{display:flex;align-items:center;gap:10px}
    .nav-cta-desktop{display:flex;align-items:center;gap:10px}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:40px;padding:0 16px;border-radius:var(--radius);font-size:14px;font-weight:500;white-space:nowrap;border:1px solid transparent;cursor:pointer}
    .btn svg{width:16px;height:16px}
    .btn-primary{background:var(--primary);color:var(--primary-fg)}
    .btn-primary:hover{opacity:.9}
    .btn-ghost{background:var(--card);color:var(--fg);border-color:var(--border)}
    .btn-ghost:hover{background:var(--muted)}
    .nav-toggle{display:none;align-items:center;justify-content:center;width:44px;height:44px;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);color:var(--fg-soft);cursor:pointer}
    .nav-toggle svg{width:18px;height:18px}
    .nav-toggle .i-close{display:none}
    .nav-toggle[aria-expanded="true"] .i-open{display:none}
    .nav-toggle[aria-expanded="true"] .i-close{display:block}
    .nav-drawer{position:fixed;inset:0;z-index:70;visibility:hidden;pointer-events:none}
    .nav-drawer[data-open="true"]{visibility:visible;pointer-events:auto}
    .nav-drawer-backdrop{position:absolute;inset:0;background:rgba(9,9,11,.56)}
    .nav-drawer-panel{position:absolute;top:64px;right:0;height:calc(100dvh - 64px);width:min(360px, calc(100vw - 56px));background:var(--bg);border-left:1px solid var(--border);overflow-y:auto;display:flex;flex-direction:column}
    .nav-drawer-body{padding:12px 16px;display:flex;flex-direction:column;gap:2px;flex:1}
    .nav-drawer-body a{min-height:44px;display:flex;align-items:center;padding:0 10px;border-radius:var(--radius);font-size:15px;color:var(--fg-soft)}
    .nav-drawer-body a:hover{background:var(--muted);color:var(--fg)}
    .nav-drawer-foot{padding:16px;border-top:1px solid var(--border-soft);display:flex;flex-direction:column;gap:10px}
    .nav-drawer-foot .btn{width:100%}
    .theme-toggle{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:var(--radius);border:1px solid var(--border);background:var(--card);color:var(--fg-soft);cursor:pointer}
    .theme-toggle svg{width:16px;height:16px}
    .theme-toggle .i-sun,.theme-toggle .i-system{display:none}
    :root[data-theme="dark"] .theme-toggle .i-sun{display:block}
    :root[data-theme="dark"] .theme-toggle .i-moon{display:none}
    :root[data-theme-state="auto"] .theme-toggle .i-system{display:block}
    :root[data-theme-state="auto"] .theme-toggle .i-moon,:root[data-theme-state="auto"] .theme-toggle .i-sun{display:none}

    .page{padding:48px 0 24px}
    .eyebrow{font-family:'Geist Mono',ui-monospace,monospace;font-size:11.5px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--muted-fg)}
    h1{font-size:clamp(28px,4vw,40px);font-weight:600;letter-spacing:-.03em;line-height:1.1;margin:8px 0 10px}
    .lede{color:var(--muted-fg);font-size:16px;max-width:58ch}
    .notices{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:28px 0 32px}
    .notice{border:1px solid var(--border);border-radius:var(--radius-card);padding:14px 16px;background:var(--card);font-size:13.5px;color:var(--fg-soft);line-height:1.55}
    .notice strong{color:var(--fg);font-weight:600}
    .notice code{font-family:'Geist Mono',ui-monospace,monospace;font-size:12px;background:var(--code-bg);padding:2px 7px;border-radius:6px;color:var(--fg);font-weight:600}
    .notice a{text-decoration:underline;text-underline-offset:3px}

    .tabs{display:flex;gap:4px;border:1px solid var(--border);width:fit-content;padding:4px;border-radius:10px;background:var(--card);margin-bottom:28px}
    .tab{appearance:none;background:none;border:none;border-radius:7px;padding:8px 16px;font:inherit;font-size:13.5px;font-weight:600;color:var(--muted-fg);cursor:pointer}
    .tab:hover{color:var(--fg)}
    .tab.active{color:var(--fg);background:var(--muted)}

    .loading,.empty{padding:64px 0;color:var(--muted-fg);font-size:14px;text-align:center}
    .error{padding:16px;margin:24px 0;color:#cf2d56;border:1px solid var(--border);border-radius:var(--radius-card);font-size:14px}

    .stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
    #panel-cli .stats-grid{grid-template-columns:repeat(2,1fr)}
    .stat-card{border:1px solid var(--border);background:var(--card);padding:18px;border-radius:var(--radius-card)}
    .stat-label{font-size:11.5px;color:var(--muted-fg);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;font-weight:600}
    .stat-value{font-size:2rem;font-weight:650;line-height:1.05;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
    .stat-sub{font-size:12px;color:var(--muted-fg);margin-top:6px}

    .sections-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
    .section{border:1px solid var(--border);background:var(--card);border-radius:var(--radius-card);padding:18px;min-width:0}
    .section.wide{grid-column:1/-1}
    .section h2{font-size:12px;font-weight:600;margin-bottom:14px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted-fg)}

    .bar-chart{display:flex;flex-direction:column;gap:10px}
    .bar-item{display:flex;align-items:center;gap:10px;font-size:13.5px;min-width:0}
    .bar-label{width:168px;flex-shrink:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;display:flex;align-items:center;gap:8px}
    .bar-logo{flex:0 0 16px;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;overflow:hidden}
    .bar-logo svg,.bar-logo img{width:16px;height:16px;display:block}
    .bar-logo .flag{font-size:14px;line-height:1}
    .bar-track{flex-grow:1;height:8px;border-radius:99px;background:var(--muted);overflow:hidden;min-width:0}
    .bar-fill{height:100%;border-radius:99px;background:var(--brand);transition:width .5s ease}
    .bar-value{width:64px;text-align:right;font-weight:600;flex-shrink:0;font-variant-numeric:tabular-nums;font-size:13px}

    site-footer,footer.site{display:block;border-top:1px solid var(--border);margin-top:48px}
    .foot-inner{padding:48px 0 40px}
    .foot-top{display:flex;flex-wrap:wrap;justify-content:space-between;gap:40px}
    .foot-brand{max-width:280px}
    .foot-brand p{font-size:13.5px;color:var(--muted-fg);margin-top:14px}
    .foot-cols{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:32px}
    .foot-col h5{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted-fg);margin-bottom:14px}
    .foot-col a{display:block;font-size:14px;color:var(--fg-soft);margin-bottom:10px}
    .foot-col a:hover{color:var(--fg)}
    .foot-bottom{margin-top:40px;padding-top:24px;border-top:1px solid var(--border-soft);display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--muted-fg)}

    @media (max-width:1024px){
      .nav-links,.nav-cta-desktop{display:none}
      .nav-toggle{display:inline-flex}
    }
    @media (max-width:760px){
      .stats-grid,.sections-grid,.notices,.foot-cols{grid-template-columns:1fr 1fr}
    }
    @media (max-width:560px){
      .wrap{padding:0 16px}
      .stats-grid,.notices,.foot-cols{grid-template-columns:1fr}
      .stat-value{font-size:1.7rem}
      .bar-item{flex-wrap:wrap}
      .bar-track{width:100%;order:3}
      .bar-value{margin-left:auto}
    }
  </style>
  <script>
    (function () {
      try {
        var legacy = localStorage.getItem('chm-theme')
        var saved = localStorage.getItem('chm-theme-state') || (legacy === 'dark' || legacy === 'light' ? legacy : null) || 'auto'
        document.documentElement.setAttribute('data-theme-state', saved)
        if (saved === 'auto') {
          document.documentElement.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        } else {
          document.documentElement.setAttribute('data-theme', saved)
        }
      } catch (e) {
        document.documentElement.setAttribute('data-theme', 'dark')
      }
    })()
  </script>
</head>
<body>
  <header class="nav">
    <div class="wrap nav-row">
      <a class="brand" href="https://chmonitor.dev">
        <span class="mark" aria-hidden="true">
          <img src="https://chmonitor.dev/brand/logo-chmonitor.svg" alt="" width="22" height="22" />
        </span>
        chmonitor
      </a>
      <nav class="nav-links">
        <div class="nav-group">
          <button type="button" class="nav-trigger">Features <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></button>
          <div class="nav-menu">
            <a href="https://chmonitor.dev/features/ai-agent">AI Agent<small>Schema-aware recommendations</small></a>
            <a href="https://chmonitor.dev/cli">CLI<small>chm doctor, TUI and API</small></a>
            <a href="https://chmonitor.dev/features/queries">Query monitoring<small>Running, slow, failed &amp; expensive</small></a>
            <a href="https://chmonitor.dev/features/alerting">Alerting<small>Health checks with webhooks</small></a>
          </div>
        </div>
        <a href="https://chmonitor.dev/customers">Customers</a>
        <a href="https://chmonitor.dev/pricing">Pricing</a>
        <a href="https://docs.chmonitor.dev" target="_blank" rel="noopener">Docs</a>
        <div class="nav-group">
          <button type="button" class="nav-trigger">Resources <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></button>
          <div class="nav-menu">
            <a href="https://blog.chmonitor.dev">Blog<small>Release notes and updates</small></a>
            <a href="https://chmonitor.dev/changelog">Changelog<small>Full ship log</small></a>
            <a href="https://docs.chmonitor.dev">Docs<small>Setup and API guides</small></a>
            <a href="https://telemetry.chmonitor.dev">Telemetry<small>Anonymous adoption stats</small></a>
          </div>
        </div>
      </nav>
      <div class="nav-cta">
        <div class="nav-cta-desktop">
          <a class="btn btn-ghost" href="https://github.com/chmonitor/chmonitor" target="_blank" rel="noopener">Star</a>
          <a class="btn btn-primary" href="https://dash.chmonitor.dev" target="_blank" rel="noopener">Dashboard</a>
        </div>
        <button type="button" class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="mobile-menu">
          <svg class="i-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          <svg class="i-close" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
  </header>
  <div class="nav-drawer" id="mobile-menu" data-open="false" aria-hidden="true">
    <div class="nav-drawer-backdrop" data-nav-close></div>
    <nav class="nav-drawer-panel" role="dialog" aria-modal="true" aria-label="Site menu">
      <div class="nav-drawer-body">
        <a href="https://chmonitor.dev/features/ai-agent">AI Agent</a>
        <a href="https://chmonitor.dev/cli">CLI</a>
        <a href="https://chmonitor.dev/customers">Customers</a>
        <a href="https://chmonitor.dev/pricing">Pricing</a>
        <a href="https://docs.chmonitor.dev">Docs</a>
        <a href="https://blog.chmonitor.dev">Blog</a>
        <a href="https://chmonitor.dev/changelog">Changelog</a>
      </div>
      <div class="nav-drawer-foot">
        <a class="btn btn-ghost" href="https://github.com/chmonitor/chmonitor">Star on GitHub</a>
        <a class="btn btn-primary" href="https://dash.chmonitor.dev">Dashboard</a>
      </div>
    </nav>
  </div>

  <main class="page">
    <div class="wrap">
      <p class="eyebrow">Public stats</p>
      <h1>Telemetry</h1>
      <p class="lede">Anonymous adoption stats for the open-source ClickHouse monitoring dashboard and the <code class="mono">chm</code> CLI.</p>

      <div class="notices">
        <div class="notice">
          <strong>Privacy-first, on by default.</strong>
          100% anonymous — no IPs, hostnames, queries, or identifying information.
          Only COUNT(DISTINCT) of opaque SHA-256 instance ids.
        </div>
        <div class="notice">
          <strong>Disable tracking:</strong>
          <code>CHM_TELEMETRY=off</code>
          — one env var, works for the dashboard, CLI, and installer.
          <a href="https://docs.chmonitor.dev/operate/advanced/telemetry">Details</a>
        </div>
      </div>

      <div class="tabs" role="tablist">
        <button class="tab active" id="tab-dashboard" role="tab" aria-selected="true" onclick="showTab('dashboard')">Dashboard (OSS)</button>
        <button class="tab" id="tab-cli" role="tab" aria-selected="false" onclick="showTab('cli')">CLI (chm)</button>
      </div>

      <div id="loading" class="loading">Loading analytics…</div>
      <div id="error" class="error" style="display:none;"></div>

      <div id="panel-dashboard" role="tabpanel" style="display:none;">
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">Total Installs</div><div class="stat-value" id="total">0</div><div class="stat-sub">distinct instances</div></div>
          <div class="stat-card"><div class="stat-label">Environments</div><div class="stat-value" id="total-places">0</div><div class="stat-sub">install locations</div></div>
          <div class="stat-card"><div class="stat-label">Top Target</div><div class="stat-value" id="top-target">—</div><div class="stat-sub" id="top-target-sub">&nbsp;</div></div>
          <div class="stat-card"><div class="stat-label">Latest CH</div><div class="stat-value" id="top-version">—</div><div class="stat-sub" id="top-version-sub">&nbsp;</div></div>
        </div>
        <div class="sections-grid">
          <div class="section wide"><h2>Deployment Targets</h2><div id="deploy-targets" class="bar-chart"></div></div>
          <div class="section"><h2>ClickHouse Versions</h2><div id="ch-versions" class="bar-chart"></div></div>
          <div class="section"><h2>chmonitor Versions</h2><div id="chm-versions" class="bar-chart"></div></div>
          <div class="section" id="ch-flavor-section" style="display:none;"><h2>ClickHouse Flavors</h2><div id="ch-flavors" class="bar-chart"></div></div>
          <div class="section"><h2>Countries</h2><div id="countries" class="bar-chart"></div></div>
          <div class="section"><h2>Platforms</h2><div id="platforms" class="bar-chart"></div></div>
        </div>
      </div>

      <div id="panel-cli" role="tabpanel" style="display:none;">
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">CLI Installs</div><div class="stat-value" id="cli-installs">0</div><div class="stat-sub">all time</div></div>
          <div class="stat-card"><div class="stat-label">Active CLI Users</div><div class="stat-value" id="cli-active">0</div><div class="stat-sub">last 30 days</div></div>
        </div>
        <div class="sections-grid">
          <div class="section wide"><h2>Installs Over Time (30d)</h2><div id="cli-installs-time" class="bar-chart"></div></div>
          <div class="section"><h2>Runs by Command</h2><div id="cli-commands" class="bar-chart"></div></div>
          <div class="section"><h2>CLI Versions</h2><div id="cli-versions" class="bar-chart"></div></div>
          <div class="section"><h2>Operating System</h2><div id="cli-os" class="bar-chart"></div></div>
          <div class="section"><h2>Architecture</h2><div id="cli-arch" class="bar-chart"></div></div>
        </div>
      </div>
    </div>
  </main>

  <footer class="site">
    <div class="wrap foot-inner">
      <div class="foot-top">
        <div class="foot-brand">
          <a class="brand" href="https://chmonitor.dev">
            <span class="mark" aria-hidden="true"><img src="https://chmonitor.dev/brand/logo-chmonitor.svg" alt="" width="22" height="22" /></span>
            chmonitor
          </a>
          <p>chmonitor reads your cluster's system tables and turns them into views your whole team can act on.</p>
        </div>
        <div class="foot-cols">
          <div class="foot-col">
            <h5>Product</h5>
            <a href="https://chmonitor.dev">Overview</a>
            <a href="https://chmonitor.dev/pricing">Pricing</a>
            <a href="https://chmonitor.dev/customers">Customers</a>
            <a href="https://chmonitor.dev/cli">CLI</a>
            <a href="https://dash.chmonitor.dev">Dashboard</a>
            <a href="https://blog.chmonitor.dev">Blog</a>
          </div>
          <div class="foot-col">
            <h5>Use cases</h5>
            <a href="https://chmonitor.dev/features/ai-agent">AI Agent</a>
            <a href="https://chmonitor.dev/monitor-queries">Query monitoring</a>
            <a href="https://chmonitor.dev/cluster-health">Cluster health</a>
            <a href="https://chmonitor.dev/replication">Replication</a>
          </div>
          <div class="foot-col">
            <h5>Open source</h5>
            <a href="https://github.com/chmonitor/chmonitor">GitHub</a>
            <a href="https://docs.chmonitor.dev">Documentation</a>
            <a href="https://github.com/chmonitor/chmonitor/issues">Issues</a>
            <a href="https://chmonitor.dev/changelog">Changelog</a>
          </div>
          <div class="foot-col">
            <h5>Legal &amp; trust</h5>
            <a href="https://github.com/chmonitor/chmonitor/blob/main/LICENSE">License (GPL-3.0)</a>
            <a href="https://docs.chmonitor.dev/operate/advanced/commercial-license">Commercial license</a>
            <a href="https://docs.chmonitor.dev/operate/advanced/telemetry">Telemetry</a>
            <a href="https://chmonitor.dev/brand">Brand</a>
          </div>
        </div>
      </div>
      <div class="foot-bottom">
        <span>© 2026 chmonitor · Open source (GPL-3.0) · Data updates hourly</span>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="mono" style="font-size:12px">Not affiliated with ClickHouse, Inc.</span>
          <button type="button" class="theme-toggle" aria-label="Toggle theme" title="Toggle theme">
            <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>
            <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
            <svg class="i-system" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
          </button>
        </div>
      </div>
    </div>
  </footer>

  <script>
    (function () {
      var nav = document.querySelector('header.nav')
      function onScroll() { if (nav) nav.toggleAttribute('data-scrolled', window.scrollY > 8) }
      onScroll(); window.addEventListener('scroll', onScroll, { passive: true })

      var drawer = document.getElementById('mobile-menu')
      var toggle = document.querySelector('.nav-toggle')
      function setOpen(open) {
        drawer.setAttribute('data-open', String(open))
        drawer.setAttribute('aria-hidden', String(!open))
        toggle.setAttribute('aria-expanded', String(open))
      }
      toggle.addEventListener('click', function () { setOpen(drawer.getAttribute('data-open') !== 'true') })
      drawer.querySelectorAll('[data-nav-close]').forEach(function (el) { el.addEventListener('click', function () { setOpen(false) }) })

      document.addEventListener('click', function (e) {
        var btn = e.target.closest('.theme-toggle')
        if (!btn) return
        var html = document.documentElement
        var state = html.getAttribute('data-theme-state') || 'auto'
        var next = state === 'auto' ? 'dark' : state === 'dark' ? 'light' : 'auto'
        html.setAttribute('data-theme-state', next)
        try { localStorage.setItem('chm-theme-state', next) } catch (err) {}
        if (next === 'auto') {
          html.setAttribute('data-theme', window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        } else {
          html.setAttribute('data-theme', next)
        }
      })
    })()

    function showTab(name) {
      for (const t of ['dashboard', 'cli']) {
        const active = t === name
        document.getElementById('tab-' + t).classList.toggle('active', active)
        document.getElementById('tab-' + t).setAttribute('aria-selected', String(active))
        document.getElementById('panel-' + t).style.display = active ? 'block' : 'none'
      }
      try { history.replaceState(null, '', '#' + name) } catch {}
    }

    async function loadAnalytics() {
      const loading = document.getElementById('loading')
      const error = document.getElementById('error')
      try {
        const response = await fetch('/v1/summary')
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const data = await response.json()
        if (data.error) throw new Error(data.error)
        loading.style.display = 'none'

        document.getElementById('total').textContent = data.total_installs.toLocaleString()
        if (data.total_places !== undefined) {
          document.getElementById('total-places').textContent = data.total_places.toLocaleString()
        }
        const targets = Object.entries(data.by_deploy_target || {}).map(([target, installs]) => ({
          deploy_target: target, installs
        }))
        renderBarChart('deploy-targets', targets)
        const topTarget = [...targets].sort((a, b) => b.installs - a.installs)[0]
        if (topTarget && topTarget.installs > 0) {
          document.getElementById('top-target').textContent = formatLabel(topTarget.deploy_target)
          const share = data.total_installs > 0 ? Math.round((topTarget.installs / data.total_installs) * 100) : 0
          document.getElementById('top-target-sub').textContent = share + '% of installs'
        }
        renderBarChart('ch-versions', data.by_ch_version)
        const topVersion = [...(data.by_ch_version || [])].filter(v => v.ch_version !== 'unknown').sort((a, b) => b.installs - a.installs)[0]
        if (topVersion) {
          document.getElementById('top-version').textContent = topVersion.ch_version
          document.getElementById('top-version-sub').textContent = topVersion.installs.toLocaleString() + ' installs'
        }
        renderBarChart('chm-versions', data.by_chm_version || [])
        renderBarChart('countries', data.by_country)
        renderBarChart('platforms', data.by_platform)
        const flavors = (data.by_ch_flavor || []).filter((f) =>
          ['oss', 'altinity', 'cloud'].includes(String(f.ch_flavor))
        )
        if (flavors.length > 0) {
          document.getElementById('ch-flavor-section').style.display = 'block'
          renderBarChart('ch-flavors', flavors)
        }

        const cli = data.cli || {}
        document.getElementById('cli-installs').textContent = (cli.installs || 0).toLocaleString()
        document.getElementById('cli-active').textContent = (cli.active_users || 0).toLocaleString()
        renderBarChart('cli-installs-time', (cli.installs_over_time || []).map(d => ({ day: d.day, installs: d.installs })), false)
        renderBarChart('cli-commands', (cli.by_command || []).map(c => ({ command: c.command, installs: c.runs })))
        renderBarChart('cli-versions', cli.by_cli_version || [])
        renderBarChart('cli-os', cli.by_os || [])
        renderBarChart('cli-arch', cli.by_arch || [])
        showTab(location.hash === '#cli' ? 'cli' : 'dashboard')
      } catch (err) {
        loading.style.display = 'none'
        error.style.display = 'block'
        error.textContent = 'Failed to load analytics: ' + err.message
      }
    }

    function renderBarChart(containerId, data, sortByValue = true) {
      const container = document.getElementById(containerId)
      if (!data || data.length === 0) {
        container.innerHTML = '<p class="empty" style="padding:12px 0;text-align:left">No data yet</p>'
        return
      }
      const maxValue = Math.max(...data.map(item => item.installs))
      const rows = sortByValue ? [...data].sort((a, b) => b.installs - a.installs) : data
      container.innerHTML = rows.map(item => {
        const percentage = maxValue ? (item.installs / maxValue) * 100 : 0
        const key = Object.keys(item).find(k => k !== 'installs')
        const label = item[key]
        return '<div class="bar-item"><div class="bar-label">' + logoFor(key, label) + '<span>' + escapeHtml(formatLabel(label)) + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + percentage + '%"></div></div><div class="bar-value">' + item.installs.toLocaleString() + '</div></div>'
      }).join('')
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
    }

    function wrapLogo(inner) {
      return inner ? '<span class="bar-logo">' + inner + '</span>' : '<span class="bar-logo"></span>'
    }

    function logoFor(key, label) {
      const s = String(label).toLowerCase().trim()
      const unknown = !s || s === 'unknown'
      if (key === 'country') return wrapLogo(unknown ? UNKNOWN_SVG : flagFor(s) || UNKNOWN_SVG)
      if (unknown) return wrapLogo(UNKNOWN_SVG)
      if (key === 'deploy_target') {
        if (s === 'docker') return wrapLogo(DOCKER_SVG)
        if (s === 'helm') return wrapLogo(HELM_SVG)
        if (s === 'cf' || s === 'cloudflare') return wrapLogo(CF_SVG)
        if (s === 'dev') return wrapLogo(DEV_SVG)
        return wrapLogo(UNKNOWN_SVG)
      }
      if (key === 'platform' || key === 'os') {
        if (s === 'android' || s.includes('android')) return wrapLogo(ANDROID_SVG)
        if (s === 'ios' || s === 'iphone' || s === 'ipad') return wrapLogo(APPLE_SVG)
        if (s === 'linux' || s.includes('linux')) return wrapLogo(LINUX_SVG)
        if (s.includes('win')) return wrapLogo(WINDOWS_SVG)
        if (s.includes('darwin') || s.includes('mac')) return wrapLogo(APPLE_SVG)
        return wrapLogo(UNKNOWN_SVG)
      }
      if (key === 'arch') {
        if (s.includes('arm') || s === 'aarch64') return wrapLogo(ARM_SVG)
        if (s.includes('86') || s === 'x86_64' || s === 'amd64') return wrapLogo(X86_SVG)
        return wrapLogo(UNKNOWN_SVG)
      }
      if (key === 'ch_flavor') {
        if (s === 'altinity') return wrapLogo(ALTINITY_SVG)
        return wrapLogo(CLICKHOUSE_SVG)
      }
      if (key === 'ch_version') return wrapLogo(CLICKHOUSE_SVG)
      if (key === 'chm_version' || key === 'cli_version') return wrapLogo(CHMONITOR_SVG)
      return wrapLogo(UNKNOWN_SVG)
    }

    function flagFor(code) {
      const cc = code.length === 2 ? code : ({
        'united states':'us', usa:'us', 'united kingdom':'gb', uk:'gb'
      })[code]
      if (!cc || cc.length !== 2) return ''
      const pts = [...cc.toUpperCase()].map(c => 127397 + c.charCodeAt(0))
      return '<span class="flag">' + String.fromCodePoint(...pts) + '</span>'
    }

    const CHMONITOR_SVG = '<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="3.3" y="13.05" width="3.8" height="15.45" fill="#f97316"/><rect x="8.7" y="3.5" width="3.8" height="25" fill="#f97316"/><rect x="14.1" y="13.25" width="3.8" height="15.25" fill="#f97316"/><rect x="19.5" y="6.25" width="3.8" height="22.25" fill="#f97316"/><rect x="24.9" y="16.8" width="3.8" height="11.7" fill="#f97316"/><rect x="3.3" y="9.75" width="3.8" height="3.3" fill="#10b981"/></svg>'
    const CLICKHOUSE_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M21.333 10H24v4h-2.667ZM16 1.335h2.667v21.33H16Zm-5.333 0h2.666v21.33h-2.666ZM0 22.665V1.335h2.667v21.33zm5.333-21.33H8v21.33H5.333Z"/></svg>'
    const DOCKER_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#2496ed" d="M4.5 9.2h2.1v2.1H4.5Zm2.5 0h2.1v2.1H7Zm2.5 0h2.1v2.1H9.5Zm2.5 0h2.1v2.1H12Zm-7.5 2.5h2.1v2.1H4.5Zm2.5 0h2.1v2.1H7Zm2.5 0h2.1v2.1H9.5Zm2.5 0h2.1v2.1H12Zm2.5-2.5h2.1v2.1H14.5ZM2.8 12.2c-.4 1.8.1 3.2 1.1 4.2 1.3 1.3 3.3 1.6 5.5 1.6 3.8 0 7.1-1.4 8.7-4.2.7.1 2.3 0 3.1-1.5.3-.6.4-1.3.2-1.9-.6.1-1.6.2-2.4 0 .3-.9.3-1.8 0-2.6l-.4-.2-.3.4c-.2.3-.6 1-.4 2 .3-.1.7-.2 1.2-.2H3.2c-.3 0-.5.2-.4.6Z"/></svg>'
    const HELM_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="#0f1689" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>'
    const CF_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#f6821f" d="M8.2 16.8h11.1c.5 0 .9-.3 1.1-.7.6-1.3.4-2.5-.6-3.3-.5-.4-1.2-.6-1.9-.5l-.3-1.2c-.3-1.2-1.4-2-2.6-2-1.1 0-2.1.7-2.5 1.7-.3-.1-.6-.2-.9-.2-1.2 0-2.2.9-2.4 2.1H8.6c-1.2 0-2.2 1-2.2 2.2 0 1.1.8 2.1 1.8 2Z"/><path fill="#fbad41" d="M6.6 16.8h12.1a2.2 2.2 0 0 0 .4-4.3c-.2 1.3-1.3 2.3-2.7 2.3H6.6c-.6 0-1.1.5-1.1 1.1s.5.9 1.1.9Z"/></svg>'
    const DEV_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/></svg>'
    const UNKNOWN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.2-3 4"/><circle cx="12" cy="17.2" r="1" fill="currentColor" stroke="none"/></svg>'
    const LINUX_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><ellipse cx="12" cy="15.6" rx="6" ry="6.4" fill="currentColor"/><ellipse cx="12" cy="16.4" rx="3.4" ry="4.2" fill="#fafafa"/><circle cx="12" cy="8" r="4.1" fill="currentColor"/><circle cx="10.5" cy="7.6" r="1" fill="#fafafa"/><circle cx="13.5" cy="7.6" r="1" fill="#fafafa"/><circle cx="10.6" cy="7.7" r=".4" fill="#18181b"/><circle cx="13.6" cy="7.7" r=".4" fill="#18181b"/><path d="M11.2 8.8h1.6L12 10.4Z" fill="#f97316"/><ellipse cx="9.7" cy="21.8" rx="2.1" ry=".7" fill="#f97316"/><ellipse cx="14.3" cy="21.8" rx="2.1" ry=".7" fill="#f97316"/></svg>'
    const ANDROID_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#3DDC84" d="M17.6 9.48 19.44 6.3a.6.6 0 0 0-.26-.85.62.62 0 0 0-.83.22l-1.88 3.24a11.4 11.4 0 0 0-8.94 0L5.65 5.67a.62.62 0 0 0-.83-.22.6.6 0 0 0-.26.85L6.4 9.48C2.86 11.31 0 15.02 0 19.4h24c0-4.38-2.86-8.09-6.4-9.92ZM7 16.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm10 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>'
    const APPLE_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="M16.7 20c-.8.8-1.7.7-2.6.4-.9-.4-1.7-.4-2.7 0-1.2.5-1.8.4-2.5-.4C4.6 15.7 5.2 9.2 9.8 9c1.1.1 1.9.6 2.6.7 1-.2 1.9-.8 3-.7 1.3.1 2.2.6 2.8 1.5-2.6 1.6-2 5 .4 6-.5 1.2-1.1 2.5-2 3.4ZM12.5 8.9c-.1-1.9 1.4-3.4 3.1-3.5.3 2.2-2 3.8-3.1 3.5Z"/></svg>'
    const WINDOWS_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#0078d4" d="M3 5.4 11.2 4.3v7.2H3V5.4Zm0 13.2 8.2 1.1v-7.1H3v6Zm9.2 1.3L21 21.2v-9.4h-8.8v7.1Zm0-15.8v7.2H21V2.2l-8.8 1.6Z"/></svg>'
    const ARM_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><text x="12" y="16" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" font-family="ui-sans-serif,system-ui">ARM</text></svg>'
    const X86_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/></svg>'
    const ALTINITY_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="#e63946" d="M12 3 3 21h4.2L12 9.6 16.8 21H21L12 3Z"/></svg>'

    function formatLabel(label) {
      const names = {
        unknown: 'Unknown', docker: 'Docker', helm: 'Helm', cf: 'Cloudflare',
        dev: 'Development', windows: 'Windows', macos: 'macOS', linux: 'Linux',
        android: 'Android', ios: 'iOS', oss: 'ClickHouse OSS', altinity: 'Altinity',
        cloud: 'ClickHouse Cloud', x86_64: 'x86_64', aarch64: 'aarch64', amd64: 'x86_64'
      }
      if (label == null || String(label).trim() === '') return 'Unknown'
      if (typeof label === 'string' && /^[a-z]{2}$/.test(label)) return label.toUpperCase()
      return names[label] || label
    }

    loadAnalytics()
  </script>
</body>
</html>
`
