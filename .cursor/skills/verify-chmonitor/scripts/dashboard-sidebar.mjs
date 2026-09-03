#!/usr/bin/env node
// Drive the dashboard sidebar contract in headless Chrome and write evidence.
//
//   VERIFY_DASH_URL=http://localhost:3000 node .cursor/skills/verify-chmonitor/scripts/dashboard-sidebar.mjs
//
// Needs `puppeteer-core` in $VERIFY_PUPPETEER_DIR: `npm i --prefix "$dir" puppeteer-core`.
// Exit 1 when any check fails; the JSON report lists every check either way.

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.VERIFY_DASH_URL ?? 'http://localhost:3000'
const RUN_ID = process.env.VERIFY_RUN_ID ?? new Date().toISOString().replace(/[:.]/g, '-')
const EVIDENCE = process.env.VERIFY_EVIDENCE ?? `/tmp/verify-chmonitor/evidence/${RUN_ID}`
const PUPPETEER_DIR = process.env.VERIFY_PUPPETEER_DIR ?? '/tmp/verify-chmonitor/puppeteer'
const SETTINGS_KEY = 'clickhouse-monitor-user-settings' // pragma: allowlist secret
const SIDEBAR = '[data-sidebar="sidebar"]'
const OVERLAY = `${SIDEBAR}[data-mobile="true"]`

mkdirSync(EVIDENCE, { recursive: true })
const puppeteer = createRequire(path.join(PUPPETEER_DIR, 'package.json'))('puppeteer-core')

const chrome =
  process.env.VERIFY_CHROME ??
  ['/usr/local/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
if (!chrome) throw new Error('no Chrome binary; set VERIFY_CHROME')

const checks = []
function check(id, ok, detail) {
  checks.push({ id, ok: Boolean(ok), detail })
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${JSON.stringify(detail)}`)
}

function launch(hover) {
  const pointer = hover
    ? 'primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'
    : 'primaryHoverType=1,availableHoverTypes=1,primaryPointerType=2,availablePointerTypes=2'
  return puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', `--blink-settings=${pointer}`],
  })
}

async function page(browser, { width, height, mobile, settings }) {
  const ctx = await browser.createBrowserContext()
  const p = await ctx.newPage()
  await p.setViewport({ width, height, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
  if (settings) {
    await p.evaluateOnNewDocument((key, value) => localStorage.setItem(key, JSON.stringify(value)), SETTINGS_KEY, settings)
  }
  return p
}

async function open(p, route) {
  await p.goto(`${BASE}${route}`, { waitUntil: 'networkidle2', timeout: 90_000 })
  await p.waitForSelector('[data-sidebar="trigger"]', { timeout: 60_000 })
  await sleep(600)
}

async function openOverlay(p) {
  await p.click('[data-sidebar="trigger"]')
  await p.waitForSelector(OVERLAY, { visible: true })
  await sleep(800)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const shot = (p, name) => p.screenshot({ path: path.join(EVIDENCE, `sidebar-${name}.png`) })

function rowActions(p) {
  return p.evaluate((sel) => {
    const root = document.querySelector(sel)
    const rect = root.getBoundingClientRect()
    return [...root.querySelectorAll('[data-sidebar="menu-item"], [data-sidebar="menu-sub-item"]')].map((row) => {
      const actions = [...row.querySelectorAll(':scope > button, :scope > [data-sidebar="menu-action"]')]
        .filter((b) => b.querySelector('svg') && b.getAttribute('aria-label'))
        .map((b) => {
          const cs = getComputedStyle(b)
          const r = b.getBoundingClientRect()
          return { label: b.getAttribute('aria-label'), shown: cs.display !== 'none' && Number(cs.opacity) > 0 && r.width > 0 }
        })
      const icon = row.querySelector('svg')?.getBoundingClientRect()
      return {
        label: (row.querySelector('a, button')?.textContent ?? '').trim().slice(0, 30),
        sub: row.getAttribute('data-sidebar') === 'menu-sub-item',
        shown: actions.filter((a) => a.shown).map((a) => a.label),
        hidden: actions.filter((a) => !a.shown).map((a) => a.label),
        iconInside: icon ? icon.left >= rect.left && icon.right <= rect.right : true,
      }
    })
  }, SIDEBAR)
}

function contentOverflow(p) {
  return p.evaluate((sel) => {
    const c = document.querySelector(`${sel} [data-sidebar="content"]`)
    return { overflowX: getComputedStyle(c).overflowX, scrollY: c.scrollHeight - c.clientHeight, docOverflowX: document.documentElement.scrollWidth - window.innerWidth }
  }, SIDEBAR)
}

const touch = await launch(false)
const desktop = await launch(true)
try {
  for (const width of [375, 768]) {
    const p = await page(touch, { width, height: 812, mobile: true })
    await open(p, '/running-queries?host=0')
    await openOverlay(p)
    await shot(p, `${width}-overlay`)
    const rows = (await rowActions(p)).filter((r) => r.label)
    const leaves = rows.filter((r) => r.shown.some((l) => l.startsWith('Pin ')) || r.hidden.some((l) => l.startsWith('Pin ')))
    const groups = rows.filter((r) => r.hidden.concat(r.shown).some((l) => l.startsWith('Customize ')))
    check(`${width}-leaf-single-pin`, leaves.length > 0 && leaves.every((r) => r.shown.length === 1 && r.shown[0].startsWith('Pin ')), leaves.map((r) => [r.label, r.shown]))
    check(`${width}-group-customize-visible`, groups.length > 0 && groups.every((r) => r.shown.some((l) => l.startsWith('Customize '))), groups.map((r) => [r.label, r.shown]))
    const hideAdd = await p.$$eval(`${OVERLAY} [aria-label^="Hide "], ${OVERLAY} [aria-label^="Add a hidden"]`, (els) => els.map((e) => [e.getAttribute('aria-label'), getComputedStyle(e).display]))
    check(`${width}-hide-add-not-tappable`, hideAdd.length > 0 && hideAdd.every(([, d]) => d === 'none'), hideAdd.slice(0, 4))
    check(`${width}-icons-inside-sheet`, rows.every((r) => r.iconInside), rows.filter((r) => !r.iconInside).map((r) => r.label))
    check(`${width}-no-sideways-scroll`, (await contentOverflow(p)).overflowX === 'hidden', await contentOverflow(p))
    await p.browserContext().close()
  }

  {
    const p = await page(desktop, { width: 1280, height: 800 })
    await open(p, '/running-queries?host=0')
    const rest = (await rowActions(p)).filter((r) => r.label)
    check('1280-rest-hover-only', rest.every((r) => r.shown.length === 0), rest.filter((r) => r.shown.length).map((r) => [r.label, r.shown]))
    const sub = await p.$(`${SIDEBAR} [data-sidebar="menu-sub-item"]`)
    const box = await sub.boundingBox()
    await p.mouse.move(box.x + 40, box.y + box.height / 2)
    await sleep(400)
    const hovered = (await rowActions(p)).find((r) => r.sub && r.shown.length)
    check('1280-hover-reveals-hide-add-pin', hovered && ['Hide', 'Add', 'Pin'].every((k) => hovered.shown.some((l) => l.startsWith(k))), hovered?.shown)
    await shot(p, '1280-hover-sub')
    const group = await p.$(`${SIDEBAR} [data-sidebar="menu-item"]:has([data-group="Tables"])`)
    const gbox = await group.boundingBox()
    await p.mouse.move(gbox.x + 40, gbox.y + gbox.height / 2)
    await sleep(400)
    const hoveredGroup = (await rowActions(p)).find((r) => r.label.startsWith('Tables'))
    check('1280-hover-reveals-group-customize', hoveredGroup?.shown.some((l) => l === 'Customize Tables'), hoveredGroup?.shown)
    const leaf = await p.$(`${SIDEBAR} [data-sidebar="menu-item"]:has(a[href*="/overview"])`)
    const lbox = await leaf.boundingBox()
    await p.mouse.move(lbox.x + 40, lbox.y + lbox.height / 2)
    await sleep(400)
    const hoveredLeaf = (await rowActions(p)).find((r) => r.label === 'Overview')
    check('1280-hover-reveals-leaf-hide-pin', hoveredLeaf && ['Hide', 'Pin'].every((k) => hoveredLeaf.shown.some((l) => l.startsWith(k))), hoveredLeaf?.shown)

    await open(p, '/overview?host=0')
    await p.keyboard.down('Control')
    await p.keyboard.press('k')
    await p.keyboard.up('Control')
    await p.waitForSelector('[cmdk-input]', { visible: true })
    await p.type('[cmdk-input]', 'History Queries')
    await sleep(400)
    await p.keyboard.press('Enter')
    await p.waitForFunction(() => location.pathname === '/history-queries', { timeout: 15_000 })
    await sleep(1000)
    const active = await p.$$eval(`${SIDEBAR} [data-active]`, (els) => els.map((e) => e.textContent?.trim().slice(0, 30)))
    check('palette-child-opens-group', active.some((t) => t?.startsWith('Queries')) && active.some((t) => t?.startsWith('History Queries')), { url: p.url(), active })
    await shot(p, '1280-palette-history')

    await p.keyboard.down('Control')
    await p.keyboard.press('k')
    await p.keyboard.up('Control')
    await p.waitForSelector('[cmdk-input]', { visible: true })
    await p.type('[cmdk-input]', 'Merges')
    await sleep(400)
    const hint = await p.$$eval('[cmdk-item]', (els) => els.slice(0, 1).map((e) => e.textContent ?? ''))
    await p.keyboard.press('Enter')
    await p.waitForFunction(() => location.pathname === '/merges', { timeout: 15_000 })
    await sleep(1200)
    const keep = await p.$('[data-testid="keep-in-sidebar"]')
    check('palette-hidden-page-keep-in-sidebar', Boolean(keep) && hint[0]?.includes('Hidden'), { hint: hint[0]?.slice(0, 40), keep: Boolean(keep) })
    await shot(p, '1280-merges-keep-in-sidebar')
    await p.browserContext().close()
  }

  const fresh = await (async () => {
    const p = await page(desktop, { width: 1280, height: 800 })
    await open(p, '/overview?host=0')
    const s = await p.evaluate((k) => JSON.parse(localStorage.getItem(k) ?? '{}'), SETTINGS_KEY)
    await p.browserContext().close()
    return s
  })()
  check('fresh-profile-is-custom-essential', fresh.workspacePreset === 'custom' && Array.isArray(fresh.hiddenMenuHrefs) && fresh.hiddenMenuHrefs.length > 20, { preset: fresh.workspacePreset, hidden: fresh.hiddenMenuHrefs?.length })

  const profiles = {
    full: { workspacePreset: 'full', hiddenMenuHrefs: [] },
    dba: { workspacePreset: 'dba', hiddenMenuHrefs: [] },
    'all-hidden': { workspacePreset: 'custom', hiddenMenuHrefs: [...fresh.hiddenMenuHrefs, '/overview', '/agents', '/insights', '/health', '/running-queries', '/history-queries', '/tables-overview', '/explorer', '/sql'] },
  }
  for (const [name, settings] of Object.entries(profiles)) {
    const p = await page(touch, { width: 375, height: 812, mobile: true, settings })
    await open(p, '/overview?host=0')
    await openOverlay(p)
    const rows = await p.$$eval(`${OVERLAY} [data-sidebar="menu"] > [data-sidebar="menu-item"]`, (els) => els.map((e) => (e.querySelector('a, button')?.textContent ?? '').trim().slice(0, 20)))
    const overflow = await contentOverflow(p)
    const expect = { full: (r) => r.includes('Merges') && r.includes('Keeper') && !r.includes('More'), dba: (r) => r.includes('Merges') && !r.includes('AI Agent') && r.includes('More'), 'all-hidden': (r) => r.includes('More') && !r.includes('Overview') }[name]
    check(`profile-${name}-375`, expect(rows) && overflow.docOverflowX <= 0, { rows, overflow })
    await shot(p, `375-profile-${name}`)
    await p.browserContext().close()
  }

  {
    const p = await page(touch, { width: 375, height: 812, mobile: true })
    await open(p, '/overview?host=0')
    await openOverlay(p)
    await p.click('[data-testid="group-customize-button"][data-group="Queries"]')
    await p.waitForSelector('[data-testid="group-customize-dialog"]', { visible: true })
    await sleep(500)
    await shot(p, '375-customize-dialog')
    const geom = await p.evaluate(() => {
      const d = document.querySelector('[data-testid="group-customize-dialog"]')
      const r = d.getBoundingClientRect()
      return { left: Math.round(r.left), right: Math.round(r.right), innerWidth: window.innerWidth, scrollW: d.scrollWidth, clientW: d.clientWidth }
    })
    check('375-customize-dialog-fits', geom.left >= 0 && geom.right <= geom.innerWidth && geom.scrollW <= geom.clientW, geom)
    await p.click('[data-testid="group-customize-remove"][data-href="/history-queries"]')
    await sleep(400)
    await p.click('[data-testid="group-customize-done"]')
    await sleep(500)
    const stored = await p.evaluate((k) => JSON.parse(localStorage.getItem(k)).hiddenMenuHrefs.includes('/history-queries'), SETTINGS_KEY)
    const sub = await p.$$eval(`${OVERLAY} [data-sidebar="menu-sub"] a`, (els) => els.map((a) => a.getAttribute('href')))
    check('375-customize-remove-updates-rail', stored && !sub.includes('/history-queries'), { stored, sub })
    await p.browserContext().close()
  }

  {
    const p = await page(desktop, { width: 1280, height: 800 })
    await open(p, '/insights-settings?host=0')
    await p.waitForSelector('[aria-label^="View insight:"]', { timeout: 20_000 })
    await p.click('[aria-label^="View insight:"]')
    await p.waitForSelector('[data-slot="dialog-content"]', { visible: true })
    await p.click('[data-slot="dialog-content"] [data-slot="dialog-close"]')
    await sleep(600)
    const stillOpen = Boolean(await p.$('[data-slot="dialog-content"]'))
    check('insight-dialog-x-closes', !stillOpen, { stillOpen })
    await shot(p, '1280-insight-after-x')
    await p.browserContext().close()
  }
  // Needs a two-host dashboard with host 1 unreachable; A → B must not render A's rows.
  const MULTI = process.env.VERIFY_DASH_MULTIHOST_URL
  if (MULTI) {
    const p = await page(desktop, { width: 1280, height: 800 })
    const requests = []
    p.on('request', (r) => {
      const u = r.url()
      if (u.includes('/api/v1/')) requests.push({ t: Date.now(), host: new URL(u).searchParams.get('hostId') ?? new URL(u).searchParams.get('host') })
    })
    await p.goto(`${MULTI}/running-queries?host=0`, { waitUntil: 'networkidle2', timeout: 90_000 })
    await p.waitForSelector('[data-testid="host-switcher"]', { timeout: 60_000 })
    await sleep(2500)
    const sample = () => p.evaluate(() => {
      const main = document.querySelector('main')?.innerText ?? ''
      return { kpi: main.match(/RUNNING OVER TIME\n([\d,]+)/)?.[1] ?? null, showing: main.match(/Showing \d+ of \d+ active quer\w+/)?.[0] ?? null, switcher: document.querySelector('[data-testid="host-switcher"]')?.textContent?.trim().slice(0, 40) }
    })
    const a = await sample()
    check('multihost-A-has-data', a.kpi !== null && a.kpi !== '0', a)
    const links = await p.$$eval(`${SIDEBAR} a[href^="/"]`, (els) => els.map((e) => e.getAttribute('href')))
    check('multihost-A-links-carry-host', links.length > 0 && links.every((h) => h.includes('host=0')), links.filter((h) => !h.includes('host=0')))

    const tSwitch = Date.now()
    await p.focus('[data-testid="host-switcher"]')
    await p.keyboard.press('Enter')
    await p.waitForSelector('[data-testid="host-option-1"]', { visible: true })
    let focused = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))
    if (focused !== 'host-option-1') {
      await p.keyboard.press('ArrowDown')
      focused = await p.evaluate(() => document.activeElement?.getAttribute('data-testid'))
    }
    await p.keyboard.press('Enter')
    await p.waitForFunction(() => new URL(location.href).searchParams.get('host') === '1', { timeout: 15_000 })
    check('multihost-keyboard-switch', focused === 'host-option-1' && p.url().includes('/running-queries?host=1'), { focused, url: p.url() })
    const timeline = []
    for (const at of [1000, 4000, 9000]) {
      await sleep(at - (Date.now() - tSwitch) > 0 ? at - (Date.now() - tSwitch) : 0)
      timeline.push({ at, ...(await sample()) })
    }
    await shot(p, '1280-multihost-B')
    check('multihost-B-no-A-rows', timeline.every((s) => (s.kpi === '0' || s.kpi === null) && (s.showing ?? '').startsWith('Showing 0 of 0')), timeline)
    check('multihost-B-switcher-no-A-status', timeline.every((s) => !s.switcher?.includes('Alpha') && !/v\d+\.\d+/.test(s.switcher ?? '')), timeline.map((s) => s.switcher))
    const toA = requests.filter((r) => r.t >= tSwitch && r.host === '0').length
    check('multihost-B-no-host0-requests', toA === 0, { requestsAfterSwitch: requests.filter((r) => r.t >= tSwitch).length, toHost0: toA })
    const linksB = await p.$$eval(`${SIDEBAR} a[href^="/"]`, (els) => els.map((e) => e.getAttribute('href')))
    check('multihost-B-links-carry-host', linksB.length > 0 && linksB.every((h) => h.includes('host=1')), linksB.filter((h) => !h.includes('host=1')))

    await p.keyboard.down('Control')
    await p.keyboard.press('k')
    await p.keyboard.up('Control')
    await p.waitForSelector('[cmdk-input]', { visible: true })
    await p.type('[cmdk-input]', 'Switch to Alpha')
    await sleep(400)
    const rows = await p.$$eval('[cmdk-item]', (els) => els.map((e) => e.textContent?.slice(0, 40)))
    await p.keyboard.press('Enter')
    await p.waitForFunction(() => new URL(location.href).searchParams.get('host') === '0', { timeout: 15_000 })
    check('multihost-palette-switch-keeps-path', rows[0]?.startsWith('Switch to Alpha') && p.url().includes('/running-queries?host=0'), { rows: rows.slice(0, 2), url: p.url() })
    await p.browserContext().close()
  }
} finally {
  await touch.close()
  await desktop.close()
}

const failed = checks.filter((c) => !c.ok)
writeFileSync(path.join(EVIDENCE, 'sidebar-navigation.json'), JSON.stringify({ base: BASE, runId: RUN_ID, chrome, checks }, null, 2))
console.log(`${checks.length - failed.length}/${checks.length} checks ok → ${EVIDENCE}/sidebar-navigation.json`)
process.exit(failed.length ? 1 : 0)
