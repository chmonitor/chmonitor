// Post-build smoke test: catch docs pages that crash instead of rendering.
//
// Why a real browser, not a plain fetch: this docs site prerenders a static
// SHELL for every page (see vite.config.ts `pages`/`prerender`), but the MDX
// body — including client components like fumadocs-ui's TypeTable
// ("use client") — only renders after the page hydrates in the browser. A
// crash there (e.g. the TypeTable `data=` vs `type=` prop bug, which throws
// "Cannot convert undefined or null to object" and trips the router's error
// boundary) never appears in the server-rendered HTML a plain `fetch()`
// would see — it only exists in the live DOM after hydration and shows up as
// a console error. Confirmed empirically while building this script: a page
// with the broken prop returns HTTP 200 with clean-looking prerendered HTML,
// but Chromium logs `TypeError: Cannot convert undefined or null to object`
// and renders the fumadocs/TanStack error boundary ("Something went wrong!")
// once client JS takes over. Only a headless browser catches that.
//
// Usage: run after `pnpm run build` (needs dist/ to exist). Starts its own
// `vite preview` server, visits every doc page from discoverDocPages(), and
// fails (exit 1, listing every failing URL) on:
//   - non-200 HTTP status
//   - a console error during load
//   - an error-boundary marker in the rendered DOM ("Something went wrong",
//     "Cannot convert", "Application error")
//
// Keep this fast: pages are checked with bounded concurrency and a per-page
// timeout so a full crawl of ~90 pages stays well under 2 minutes.

import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { discoverDocPages } from './discover-doc-pages.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const APP_ROOT = join(__dirname, '..')

const PORT = Number(process.env.SMOKE_PORT ?? 4173)
const BASE_URL = `http://localhost:${PORT}`
const CONCURRENCY = Number(process.env.SMOKE_CONCURRENCY ?? 8)
const PAGE_TIMEOUT_MS = 15_000
const SERVER_START_TIMEOUT_MS = 30_000

const ERROR_MARKERS = [
  'Something went wrong',
  'Cannot convert undefined or null to object',
  'Application error',
]

function startPreviewServer() {
  const proc = spawn(
    'pnpm',
    ['exec', 'vite', 'preview', '--port', String(PORT), '--strictPort'],
    { cwd: APP_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let output = ''
  proc.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  proc.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })

  return new Promise((resolve, reject) => {
    const start = Date.now()
    const check = setInterval(() => {
      if (output.includes('Local:') || output.includes(`:${PORT}`)) {
        clearInterval(check)
        // Give the server a moment past the log line before hitting it.
        setTimeout(() => resolve(proc), 300)
        return
      }
      if (Date.now() - start > SERVER_START_TIMEOUT_MS) {
        clearInterval(check)
        reject(
          new Error(
            `preview server did not start within ${SERVER_START_TIMEOUT_MS}ms:\n${output}`,
          ),
        )
      }
    }, 200)

    proc.on('exit', (code) => {
      clearInterval(check)
      if (code !== 0) {
        reject(new Error(`preview server exited early (code ${code}):\n${output}`))
      }
    })
  })
}

async function checkPage(browser, path) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const consoleErrors = []

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text())
  })
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message)
  })

  try {
    const response = await page.goto(`${BASE_URL}${path}`, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT_MS,
    })

    const status = response?.status() ?? 0
    if (status < 200 || status >= 400) {
      return { path, ok: false, reason: `HTTP ${status}` }
    }

    // Let client hydration finish and any render error surface.
    await page.waitForTimeout(300)

    const bodyText = await page.evaluate(() => document.body.innerText)
    const marker = ERROR_MARKERS.find((m) => bodyText.includes(m))
    if (marker) {
      return { path, ok: false, reason: `error boundary in DOM: "${marker}"` }
    }

    if (consoleErrors.length > 0) {
      return { path, ok: false, reason: `console error: ${consoleErrors[0]}` }
    }

    return { path, ok: true }
  } catch (error) {
    return { path, ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    await context.close()
  }
}

async function runWithConcurrency(items, limit, worker) {
  const results = []
  let index = 0

  async function next() {
    while (index < items.length) {
      const current = index++
      results[current] = await worker(items[current])
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, next))
  return results
}

async function main() {
  const pages = discoverDocPages()
  if (pages.length === 0) {
    console.error(
      '[smoke] discoverDocPages() found 0 pages — did `pnpm run build` run first?',
    )
    process.exit(1)
  }

  console.log(`[smoke] Starting preview server on :${PORT}...`)
  const server = await startPreviewServer()

  console.log(`[smoke] Launching Chromium, crawling ${pages.length} pages (concurrency ${CONCURRENCY})...`)
  const browser = await chromium.launch()

  let results
  try {
    results = await runWithConcurrency(pages, CONCURRENCY, (p) => checkPage(browser, p.path))
  } finally {
    await browser.close()
    server.kill()
  }

  const failures = results.filter((r) => !r.ok)

  if (failures.length > 0) {
    console.error(`\n[smoke] FAILED: ${failures.length}/${results.length} page(s) errored:\n`)
    for (const f of failures) {
      console.error(`  ${f.path} — ${f.reason}`)
    }
    process.exit(1)
  }

  console.log(`[smoke] OK: all ${results.length} pages rendered cleanly.`)
}

main().catch((error) => {
  console.error('[smoke] crawl failed to run:', error)
  process.exit(1)
})
