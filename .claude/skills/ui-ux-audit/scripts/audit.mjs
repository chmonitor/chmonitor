#!/usr/bin/env bun
/**
 * UI/UX audit runner for the chmonitor dashboard (apps/dashboard).
 *
 * For every dashboard route it: navigates, waits for data/skeletons to settle,
 * captures console errors + failed network calls, runs an axe-core accessibility
 * scan, checks for horizontal-overflow and stuck-skeleton layout problems, takes
 * a full-page screenshot, and (when a baseline exists) diffs against it for visual
 * regression. Routes with findings also get a Playwright trace.zip + a runnable
 * repro snippet so any issue can be replayed deterministically later.
 *
 * Targets:
 *   --target=local  (default)  http://localhost:3000, auth bypassed (auth=none)
 *   --target=live              https://dash.chmonitor.dev, Clerk session reused
 *                              from ~/.config/chmonitor/clerk-state.json
 *
 * Usage (run from the qa-tools dir so `playwright` resolves — see setup.sh):
 *   bun audit.mjs --target=local
 *   bun audit.mjs --target=local --only=/explorer,/sql
 *   bun audit.mjs --target=live --baseline=/path/to/baseline-shots
 *   BASE_URL=http://localhost:5173 bun audit.mjs
 */
import { chromium } from 'playwright'
import { AxeBuilder } from '@axe-core/playwright'
import { readdirSync, statSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- args ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/)
    return m ? [m[1], m[2] ?? true] : [a, true]
  }),
)
const TARGET = args.target || 'local'
const HOST = args.host || '0'
const A11Y = args.a11y !== 'off'
const SETTLE = Number(args.settle || 3500)
const HOME = process.env.HOME
const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
// repo root: walk up from skill dir until we find apps/dashboard
const APP_DIRS = ['apps/dashboard']
function appRoutesRel(repo) {
  for (const a of APP_DIRS) {
    if (existsSync(join(repo, a, 'src/routes'))) return join(a, 'src/routes')
  }
  return null
}
function findRepoRoot(start) {
  let d = start
  for (let i = 0; i < 8; i++) {
    if (appRoutesRel(d)) return d
    d = dirname(d)
  }
  return null
}
const REPO = args.repo || findRepoRoot(SKILL_DIR)

const BASE_URL =
  process.env.BASE_URL ||
  (TARGET === 'live' ? 'https://dash.chmonitor.dev' : 'http://localhost:3000')
const STATE = `${HOME}/.config/chmonitor/clerk-state.json`
const STAMP = args.stamp || new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const OUT = args.out || `/tmp/chm-ui-audit/${TARGET}-${STAMP}`
const SHOTS = join(OUT, 'shots')
const TRACES = join(OUT, 'traces')
const REPRO = join(OUT, 'repro')
const DIFFS = join(OUT, 'diffs')
for (const d of [OUT, SHOTS, TRACES, REPRO, DIFFS]) mkdirSync(d, { recursive: true })
const BASELINE = args.baseline || null

const log = (...a) => console.log(`[audit ${new Date().toISOString().slice(11, 19)}]`, ...a)

// ---------- route discovery (TanStack Start file-based routes) ----------
function discoverRoutes() {
  if (args.only) return String(args.only).split(',').map((s) => s.trim()).filter(Boolean)
  if (!REPO) { log('WARN: repo root not found, falling back to /overview'); return ['/overview'] }
  const root = join(REPO, appRoutesRel(REPO) || 'apps/dashboard/src/routes')
  const out = new Set()
  const walk = (dir, urlPrefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const isDir = statSync(full).isDirectory()
      // skip non-route files/dirs: -components, _lib, __root, route.tsx (layouts)
      if (name.startsWith('-') || name.startsWith('_')) continue
      // api/ holds server route handlers, not visitable pages
      if (isDir && name === 'api') continue
      if (isDir) {
        // pathless group "(group)" contributes nothing to the URL
        const seg = name.startsWith('(') && name.endsWith(')') ? '' : `/${name}`
        walk(full, urlPrefix + seg)
        continue
      }
      if (!name.endsWith('.tsx')) continue
      if (name === 'route.tsx' || name === '__root.tsx') continue
      if (name.includes('$')) continue // dynamic params — skip (need sample values)
      const base = name.replace(/\.tsx$/, '')
      const path = base === 'index' ? urlPrefix || '/' : `${urlPrefix}/${base}`
      out.add(path || '/')
    }
  }
  walk(root, '')
  return [...out].sort()
}

// network calls that are expected to fail / be noisy and should not count as findings
const IGNORABLE = [
  /\/api\/v1\/notifications/, // best-effort
  /favicon/,
  /analytics|seline|vercel-insights|gtag|google-analytics/,
]
function isIgnorable(url) { return IGNORABLE.some((re) => re.test(url)) }

// ---------- per-route audit ----------
async function auditRoute(ctx, route) {
  const page = await ctx.newPage()
  const consoleErrors = []
  const failedRequests = []
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)) })
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 300)))
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() >= 400 && !isIgnorable(u)) failedRequests.push(`${r.status()} ${u.replace(BASE_URL, '')}`.slice(0, 120))
  })

  const url = `${BASE_URL}${route}${route.includes('?') ? '&' : '?'}host=${HOST}`
  const findings = []
  let crashed = false
  let tracing = false
  try {
    await ctx.tracing.start({ screenshots: true, snapshots: true, title: route })
    tracing = true
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    // let SWR/Query fire and charts mount
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(SETTLE)

    // stuck skeleton: loading placeholders still present after settle
    const stillLoading = await page
      .locator('.animate-pulse, [data-loading="true"], [aria-busy="true"]')
      .count()
      .catch(() => 0)
    if (stillLoading > 0) {
      // give it one more chance, then flag
      await page.waitForTimeout(4000)
      const again = await page.locator('.animate-pulse, [data-loading="true"]').count().catch(() => 0)
      if (again > 0) findings.push({ type: 'stuck-skeleton', severity: 'medium', detail: `${again} loading placeholder(s) still visible after ${(SETTLE + 4000) / 1000}s` })
    }

    // horizontal overflow (a very common dashboard regression)
    const overflow = await page.evaluate(() => {
      const de = document.documentElement
      const w = window.innerWidth
      const over = de.scrollWidth - w
      const culprits = []
      if (over > 4) {
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect()
          if (r.right > w + 4 && r.width > 40 && r.height > 8) {
            culprits.push((el.tagName.toLowerCase()) + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').slice(0, 2).join('.') : ''))
            if (culprits.length >= 4) break
          }
        }
      }
      return { over, culprits }
    })
    if (overflow.over > 4) findings.push({ type: 'horizontal-overflow', severity: 'medium', detail: `page overflows viewport by ${overflow.over}px`, culprits: overflow.culprits })

    // explicit error / crash states in the content
    const errText = await page.evaluate(() => {
      const re = /(something went wrong|unexpected error|failed to load|application error|cannot read|is not a function|is not a constructor)/i
      const main = document.querySelector('main') || document.body
      const t = (main.innerText || '').slice(0, 4000)
      const m = t.match(re)
      return m ? m[0] : null
    })
    if (errText) findings.push({ type: 'error-state', severity: 'high', detail: `error text rendered: "${errText}"` })

    // accessibility (axe-core) — serious+critical only by default to cut noise
    if (A11Y) {
      try {
        const res = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .analyze()
        const serious = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
        for (const v of serious) {
          findings.push({
            type: 'a11y',
            severity: v.impact === 'critical' ? 'high' : 'medium',
            rule: v.id,
            detail: v.help,
            nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
            helpUrl: v.helpUrl,
          })
        }
      } catch (e) { findings.push({ type: 'a11y-error', severity: 'low', detail: 'axe scan failed: ' + e.message.slice(0, 120) }) }
    }

    if (consoleErrors.length) findings.push({ type: 'console-error', severity: 'high', detail: `${consoleErrors.length} console error(s)`, sample: consoleErrors.slice(0, 5) })
    if (failedRequests.length) findings.push({ type: 'failed-request', severity: TARGET === 'local' ? 'medium' : 'high', detail: `${failedRequests.length} request(s) >=400`, sample: failedRequests.slice(0, 6) })
  } catch (e) {
    crashed = true
    findings.push({ type: 'navigation-crash', severity: 'high', detail: e.message.slice(0, 200) })
  }

  // screenshot (always)
  const shotName = (route.replace(/[/?=&]/g, '_') || '_root') + '.png'
  const shotPath = join(SHOTS, shotName)
  await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {})

  // visual regression vs baseline
  if (BASELINE) {
    const basePath = join(BASELINE, shotName)
    if (existsSync(basePath) && existsSync(shotPath)) {
      try {
        const a = PNG.sync.read(readFileSync(basePath))
        const b = PNG.sync.read(readFileSync(shotPath))
        if (a.width === b.width && a.height === b.height) {
          const diff = new PNG({ width: a.width, height: a.height })
          const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.1 })
          const pct = (n / (a.width * a.height)) * 100
          if (pct > 0.5) {
            writeFileSync(join(DIFFS, shotName), PNG.sync.write(diff))
            findings.push({ type: 'visual-regression', severity: 'medium', detail: `${pct.toFixed(2)}% pixels changed vs baseline`, diff: join('diffs', shotName) })
          }
        } else {
          findings.push({ type: 'visual-regression', severity: 'medium', detail: `dimensions changed (${a.width}x${a.height} -> ${b.width}x${b.height})` })
        }
      } catch { /* baseline unreadable */ }
    }
  }

  // trace + repro only when there is something to reproduce
  if (tracing) {
    if (findings.length) {
      const traceName = (route.replace(/[/?=&]/g, '_') || '_root') + '.zip'
      await ctx.tracing.stop({ path: join(TRACES, traceName) }).catch(() => {})
      // A repro-write failure (ENOENT etc.) must never abort the whole sweep and
      // lose report.json — log and continue.
      try {
        writeReproSnippet(route, url, findings)
      } catch (e) {
        log(`WARN: repro write failed for ${route}: ${e.message?.slice(0, 80)}`)
      }
    } else {
      await ctx.tracing.stop().catch(() => {})
    }
  }

  await page.close()
  return { route, url, shot: join('shots', shotName), crashed, findings }
}

function writeReproSnippet(route, url, findings) {
  const id = (route.replace(/[/?=&]/g, '_') || '_root')
  const types = [...new Set(findings.map((f) => f.type))].join(', ')
  const snippet = `#!/usr/bin/env bun
// Repro for ${route} — issues: ${types}
// Run from ~/.config/chmonitor/qa-tools:  bun ${join('${OUT}', 'repro', id + '.mjs')}
import { chromium } from 'playwright'
const live = ${TARGET === 'live'}
const ctx = live
  ? await chromium.launchPersistentContext('${HOME}/.config/chmonitor/clerk-userdata', { headless: false, viewport: { width: 1440, height: 900 } })
  : await (await chromium.launch({ headless: false })).newContext()
const page = await ctx.newPage()
const errs = []
page.on('console', m => m.type()==='error' && errs.push(m.text()))
page.on('pageerror', e => errs.push('pageerror: '+e.message))
await page.goto('${url}', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
console.log('--- console errors ---'); console.log(errs.join('\\n') || '(none)')
console.log('--- findings expected ---')
console.log(${JSON.stringify(findings, null, 0).replace(/`/g, '\\`')})
console.log('Leaving the browser open 60s so you can inspect. Trace: traces/${id}.zip (bun x playwright show-trace ...)')
await page.waitForTimeout(60000)
await ctx.close()
`
  writeFileSync(join(REPRO, id + '.mjs'), snippet)
}

// ---------- main ----------
const USERDATA = `${HOME}/.config/chmonitor/clerk-userdata`
const routes = discoverRoutes()
log(`target=${TARGET} base=${BASE_URL} routes=${routes.length} out=${OUT}`)

// Live uses a PERSISTENT browser profile (userDataDir). Unlike an exported
// storageState snapshot, this keeps Clerk's entire client state on disk
// (cookies + localStorage + IndexedDB), so the short-lived session JWT refreshes
// itself on load and the audit stays authorized. Populate it once with
// live-login.mjs (headed). Local uses a throwaway context (auth bypassed).
let browser = null
let ctx
if (TARGET === 'live') {
  if (!existsSync(USERDATA)) {
    log(`ERROR: live needs an authenticated profile at ${USERDATA}. Run live-login.mjs (headed) first.`)
    process.exit(2)
  }
  ctx = await chromium.launchPersistentContext(USERDATA, {
    headless: !args.headed,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })
} else {
  browser = await chromium.launch({ headless: !args.headed })
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
}

// Warm up Clerk on live: the saved __session JWT is short-lived, so load the app
// once and wait until Clerk refreshes the session (a data call returns 200) before
// auditing — otherwise the first cold load falsely 401s every route. Re-save the
// freshened cookies so the next run starts warmer.
if (TARGET === 'live') {
  const warm = await ctx.newPage()
  let authed = false
  warm.on('response', (r) => { if (r.url().includes('/api/v1/hosts') && r.status() === 200) authed = true })
  await warm.goto(`${BASE_URL}/overview?host=${HOST}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
  for (let i = 0; i < 25 && !authed; i++) await warm.waitForTimeout(1000)
  log(authed ? 'Clerk session warm (authorized)' : 'WARN: session did not authorize within 25s — re-mint with live-login.mjs (headed)')
  await warm.close()
}

const results = []
for (const route of routes) {
  const r = await auditRoute(ctx, route)
  const n = r.findings.length
  log(`${n ? '✗' : '✓'} ${route}  (${n} finding${n === 1 ? '' : 's'})`)
  results.push(r)
}
await ctx.close()
if (browser) await browser.close()

// ---------- report ----------
const all = results.flatMap((r) => r.findings.map((f) => ({ route: r.route, ...f })))
const bySeverity = (s) => all.filter((f) => f.severity === s).length
const summary = {
  target: TARGET,
  baseUrl: BASE_URL,
  routesAudited: results.length,
  routesWithFindings: results.filter((r) => r.findings.length).length,
  totalFindings: all.length,
  high: bySeverity('high'),
  medium: bySeverity('medium'),
  low: bySeverity('low'),
  byType: all.reduce((acc, f) => ((acc[f.type] = (acc[f.type] || 0) + 1), acc), {}),
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ summary, results }, null, 2))
writeFileSync(join(OUT, 'report.html'), renderHtml(summary, results))
log('SUMMARY ' + JSON.stringify(summary))
log('report -> ' + join(OUT, 'report.html'))

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) }
function renderHtml(summary, results) {
  const sevColor = { high: '#dc2626', medium: '#d97706', low: '#6b7280' }
  const cards = results
    .filter((r) => r.findings.length)
    .map((r) => {
      const items = r.findings
        .map((f) => `<li><b style="color:${sevColor[f.severity]}">[${f.severity}] ${esc(f.type)}</b> ${esc(f.detail || f.rule || '')}${f.sample ? `<pre>${esc(f.sample.join('\n'))}</pre>` : ''}${f.nodes ? `<pre>${esc(f.nodes.join('\n'))}</pre>` : ''}</li>`)
        .join('')
      return `<section><h3>${esc(r.route)} <span class=count>${r.findings.length}</span></h3>
        <a href="${r.shot}" target=_blank><img src="${r.shot}" loading=lazy></a>
        <ul>${items}</ul>
        <p class=repro>repro: <code>bun ${join(OUT, 'repro', (r.route.replace(/[/?=&]/g, '_') || '_root') + '.mjs')}</code></p></section>`
    })
    .join('')
  const clean = results.filter((r) => !r.findings.length).map((r) => esc(r.route)).join(', ')
  return `<!doctype html><meta charset=utf8><title>CHM UI/UX audit — ${summary.target}</title>
<style>body{font:14px/1.5 system-ui;margin:0;background:#0b0b0c;color:#e5e5e5}
header{padding:20px 28px;background:#111;position:sticky;top:0;border-bottom:1px solid #222}
h1{margin:0 0 6px;font-size:18px} .pill{display:inline-block;padding:2px 8px;border-radius:99px;margin-right:6px;font-size:12px}
section{padding:18px 28px;border-bottom:1px solid #1a1a1a} h3{margin:0 0 10px} .count{background:#dc2626;border-radius:99px;padding:1px 8px;font-size:12px}
img{max-width:520px;border:1px solid #333;border-radius:8px;vertical-align:top}
ul{margin:10px 0} pre{background:#161616;padding:8px;border-radius:6px;overflow:auto;font-size:12px;color:#bbb}
.repro code{background:#161616;padding:2px 6px;border-radius:4px;font-size:12px} .ok{padding:18px 28px;color:#888}</style>
<header><h1>ClickHouse Monitor — UI/UX audit (${summary.target})</h1>
<div><span class=pill style="background:#dc2626">${summary.high} high</span>
<span class=pill style="background:#d97706">${summary.medium} medium</span>
<span class=pill style="background:#444">${summary.low} low</span>
<span class=pill style="background:#222">${summary.routesWithFindings}/${summary.routesAudited} routes</span></div>
<div style="margin-top:6px;color:#888;font-size:12px">${esc(JSON.stringify(summary.byType))}</div></header>
${cards}
<div class=ok><b>Clean routes (${results.length - summary.routesWithFindings}):</b> ${clean}</div>`
}
