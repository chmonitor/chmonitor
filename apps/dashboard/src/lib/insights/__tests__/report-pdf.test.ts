import {
  hasBrowserBinding,
  renderReportPdf,
  reportPdfFilename,
} from '../report-pdf'
import { describe, expect, test } from 'bun:test'

describe('hasBrowserBinding', () => {
  test('false when bindings is undefined', () => {
    expect(hasBrowserBinding(undefined)).toBe(false)
  })

  test('false when BROWSER is absent (OSS / no Browser Rendering)', () => {
    expect(hasBrowserBinding({ CLICKHOUSE_HOST: 'x' })).toBe(false)
  })

  test('false when BROWSER is present but not a fetcher', () => {
    expect(hasBrowserBinding({ BROWSER: 'nope' })).toBe(false)
  })

  test('true when BROWSER exposes fetch (Fetcher binding)', () => {
    expect(
      hasBrowserBinding({ BROWSER: { fetch: () => Promise.resolve() } })
    ).toBe(true)
  })
})

describe('renderReportPdf', () => {
  test('degrades to null (never throws) when no binding is configured', async () => {
    await expect(
      renderReportPdf('<html></html>', undefined)
    ).resolves.toBeNull()
    await expect(renderReportPdf('<html></html>', {})).resolves.toBeNull()
  })
})

describe('reportPdfFilename', () => {
  test('sanitizes host label and composes a .pdf name', () => {
    expect(reportPdfFilename('prod cluster #1', 'weekly', '2026-07-20')).toBe(
      'report-prod-cluster-1-weekly-2026-07-20.pdf'
    )
  })
})
