/**
 * PDF rendering for reports — Cloudflare Browser Rendering (#2794, phase 2).
 *
 * Renders the existing self-contained report HTML (`renderWeeklyReportHtml` /
 * fleet) to a PDF via a Cloudflare **Browser Rendering** binding. Workers can
 * NOT run headless Chrome in-process, so this is the native answer — the Worker
 * drives a remote browser session through the `BROWSER` binding.
 *
 * Fail-closed additive (mirrors lib/cloud): PDF is a pure add-on. When the
 * `BROWSER` binding is absent — every self-hosted / Docker / K8s deploy, and
 * any Cloudflare account without Browser Rendering provisioned — this returns
 * `null` and the caller degrades to HTML. It NEVER throws, so a render failure
 * (cold browser, timeout, quota) can never break report generation or the
 * scheduled fan-out. OSS is never degraded: the binding simply isn't there.
 *
 * `@cloudflare/puppeteer` is imported dynamically and only AFTER the binding
 * check, so the node/Docker target never evaluates a Workers-only launch path.
 */

import { warn } from '@chm/logger'

/** Minimal shape of the Browser Rendering binding (a Fetcher-like object). */
export interface BrowserBinding {
  fetch: (...args: unknown[]) => Promise<unknown>
}

/** True when a usable Browser Rendering binding is present. */
export function hasBrowserBinding(
  bindings: Record<string, unknown> | undefined
): boolean {
  const b = bindings?.BROWSER as BrowserBinding | undefined
  return typeof b?.fetch === 'function'
}

/**
 * Render self-contained HTML to a PDF (A4, print backgrounds on).
 *
 * @returns the PDF bytes, or `null` when no binding is configured or the
 *          remote render fails — callers MUST treat `null` as "degrade to HTML".
 */
export async function renderReportPdf(
  html: string,
  bindings: Record<string, unknown> | undefined
): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!hasBrowserBinding(bindings)) return null
  const browserBinding = (bindings as Record<string, unknown>).BROWSER

  let browser: {
    newPage: () => Promise<unknown>
    close: () => Promise<void>
  } | null = null
  try {
    const puppeteer = (await import('@cloudflare/puppeteer')).default as {
      launch: (b: unknown) => Promise<typeof browser>
    }
    browser = await puppeteer.launch(browserBinding)
    if (!browser) return null
    const page = (await browser.newPage()) as {
      setContent: (html: string, opts: { waitUntil: string }) => Promise<void>
      pdf: (opts: Record<string, unknown>) => Promise<Uint8Array | Buffer>
    }
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '16px', bottom: '16px', left: '16px', right: '16px' },
    })
    // Copy into a fresh ArrayBuffer-backed view so the bytes satisfy
    // `BodyInit` (Response) — a `SharedArrayBuffer`-backed view would not.
    return new Uint8Array(pdf)
  } catch (err) {
    warn(
      `[report-pdf] Browser Rendering failed, degrading to HTML: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
    return null
  } finally {
    try {
      await browser?.close()
    } catch {
      // best-effort — a failed close must not mask a successful render
    }
  }
}

/** Content-Disposition-safe filename for a report PDF. */
export function reportPdfFilename(
  hostLabel: string,
  period: string,
  weekStart: string
): string {
  const safe = hostLabel.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 60)
  return `report-${safe}-${period}-${weekStart}.pdf`
}
