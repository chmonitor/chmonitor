/**
 * Digest (multi-finding) body tests (#2663).
 *
 * Covers the shared pure summarizer plus each channel's digest body:
 *  - `summarizeDigest` — the "N critical, M warning on K hosts" summary line,
 *    top-severity selection, distinct-host counting, and the line cap/overflow.
 *  - Slack / generic-JSON / Telegram digest bodies — that they carry the
 *    summary + a line per finding, and the dispatch selector routes a Slack URL
 *    to Slack blocks and everything else to the generic digest.
 */

import type { AlertPayload } from '../types'

import {
  buildGenericJsonDigestBody,
  buildSlackDigestBody,
  buildTelegramDigestText,
  buildWebhookDigestDispatchBody,
  MAX_DIGEST_LINES,
  summarizeDigest,
} from '../index'
import { describe, expect, test } from 'bun:test'

function payload(over: Partial<AlertPayload> = {}): AlertPayload {
  return {
    severity: 'warning',
    hostLabel: 'prod-ch',
    hostId: 0,
    metric: 'disk-usage',
    value: 82,
    title: 'Disk usage',
    label: '82% used',
    timestamp: '2026-07-18T00:00:00.000Z',
    ...over,
  }
}

describe('summarizeDigest', () => {
  test('counts severities in descending order and distinct hosts', () => {
    const s = summarizeDigest([
      payload({ severity: 'critical', hostId: 0 }),
      payload({ severity: 'critical', hostId: 1 }),
      payload({ severity: 'critical', hostId: 2 }),
      payload({ severity: 'warning', hostId: 3 }),
      payload({ severity: 'warning', hostId: 0 }),
    ])
    expect(s.summaryLine).toBe('3 critical, 2 warning on 4 hosts')
    expect(s.topSeverity).toBe('critical')
    expect(s.counts).toEqual({ critical: 3, warning: 2, recovery: 0 })
    expect(s.hostCount).toBe(4)
    expect(s.total).toBe(5)
    // One rule at two severities: one row per (rule, severity) group (#4246).
    expect(s.findingLines).toHaveLength(2)
  })

  test('singular host wording and a recovery in the mix', () => {
    const s = summarizeDigest([
      payload({ severity: 'warning', hostId: 7 }),
      payload({ severity: 'recovery', hostId: 7 }),
    ])
    expect(s.summaryLine).toBe('1 warning, 1 recovery on 1 host (prod-ch)')
    // recovery ranks below warning, so warning is the top severity here.
    expect(s.topSeverity).toBe('warning')
  })

  test('caps rendered lines and reports overflow', () => {
    const many = Array.from({ length: MAX_DIGEST_LINES + 5 }, (_, i) =>
      payload({ hostId: i, metric: `rule-${i}` })
    )
    const s = summarizeDigest(many)
    expect(s.findingLines).toHaveLength(MAX_DIGEST_LINES)
    expect(s.overflow).toBe(5)
    expect(s.total).toBe(MAX_DIGEST_LINES + 5)
  })

  test('finding lines are severity-prefixed single lines', () => {
    const s = summarizeDigest([
      payload({
        severity: 'critical',
        title: 'Failed mutations',
        label: '5 stuck',
      }),
    ])
    expect(s.findingLines[0]).toBe(
      '[CRITICAL] Failed mutations — 5 stuck (host prod-ch)'
    )
  })
})

describe('buildSlackDigestBody', () => {
  /** Section text lines, summary line first. */
  const lines = (body: ReturnType<typeof buildSlackDigestBody>) =>
    (body.blocks ?? [])
      .filter((b) => b.type === 'section')
      .flatMap((b) => b.text?.text?.split('\n') ?? [])

  test('compact text: a bold summary line, then one line per rule', () => {
    const body = buildSlackDigestBody([
      payload({ severity: 'critical', title: 'A', label: 'a' }),
      payload({ severity: 'warning', title: 'B', label: 'b' }),
    ])
    expect(body.attachments).toEqual([])
    expect(body.blocks?.some((b) => b.type === 'table')).toBe(false)
    expect(body.blocks?.some((b) => b.type === 'header')).toBe(false)
    expect(lines(body)).toEqual([
      '🔴 *1 critical, 1 warning on 1 host (prod-ch)*',
      '🔴 *CRITICAL*  A · a · new',
      '🟠 *WARNING*  B · b · new',
    ])
  })

  test('renders a final "…and N more" line past the cap', () => {
    const many = Array.from({ length: MAX_DIGEST_LINES + 3 }, (_, i) =>
      payload({ hostId: i, metric: `rule-${i}` })
    )
    const out = lines(buildSlackDigestBody(many))
    expect(out).toHaveLength(MAX_DIGEST_LINES + 2) // summary + rows + overflow
    expect(out.at(-1)).toBe('_…and 3 more_')
  })

  test('footer is one small context line with links, identity and time', () => {
    const body = buildSlackDigestBody([
      payload({
        dashboardUrl: 'https://chm.example.com/health?host=0',
        runbookUrls: ['https://docs.example.com/disk'],
        actions: [
          {
            id: 'disk-guide',
            kind: 'runbook',
            label: 'Disk guide',
            url: 'https://docs.example.com/disk-guide',
          },
        ],
        instanceName: 'prod-eu',
        metadata: { team: 'db' },
        timestamp: '2026-07-18T04:20:31.000Z',
      }),
      payload({
        title: 'CPU',
        metric: 'cpu',
        runbookUrls: ['https://docs.example.com/disk'],
        timestamp: '2026-07-18T04:19:00.000Z',
      }),
    ])
    const footer = body.blocks?.at(-1)
    expect(footer?.type).toBe('context')
    expect(footer?.elements?.[0].text).toBe(
      [
        '<https://chm.example.com/health?host=0|Open dashboard>',
        '<https://docs.example.com/disk|Runbook>',
        '<https://docs.example.com/disk-guide|Disk guide>',
        'instance prod-eu · team=db',
        '2026-07-18 04:20 UTC',
      ].join(' · ')
    )
    // Links moved to the footer: no button row.
    expect(body.blocks?.some((b) => b.type === 'actions')).toBe(false)
  })

  test('footer without links still carries the time', () => {
    const body = buildSlackDigestBody([payload(), payload({ metric: 'cpu' })])
    expect(body.blocks?.at(-1)?.elements?.[0].text).toBe('2026-07-18 00:00 UTC')
  })
})

describe('buildGenericJsonDigestBody', () => {
  test('carries the full finding array plus summary counts', () => {
    const body = buildGenericJsonDigestBody([
      payload({ severity: 'critical' }),
      payload({ severity: 'warning' }),
    ])
    expect(body.digest).toBe(true)
    expect(body.count).toBe(2)
    expect(body.counts).toEqual({ critical: 1, warning: 1, recovery: 0 })
    expect(body.alerts).toHaveLength(2)
    expect(body.text).toContain('1 critical, 1 warning on 1 host')
  })
})

describe('buildTelegramDigestText', () => {
  test('is a bold heading + one escaped bullet per finding', () => {
    const text = buildTelegramDigestText([
      payload({ severity: 'critical', title: 'Disk', label: '90%' }),
      payload({ severity: 'warning', title: 'CPU', label: '70%' }),
    ])
    // MarkdownV2 escapes the em-dash separator's reserved chars; assert the
    // recognizable, non-reserved parts survive.
    expect(text).toContain('Health digest')
    expect(text).toContain('Disk')
    expect(text).toContain('CPU')
    expect(text.split('\n').filter((l) => l.startsWith('•'))).toHaveLength(2)
  })
})

describe('buildWebhookDigestDispatchBody', () => {
  test('routes a Slack URL to Slack blocks', () => {
    const d = buildWebhookDigestDispatchBody({
      url: 'https://hooks.slack.com/services/T/B/X',
      payloads: [payload(), payload({ hostId: 1 })],
    })
    expect(d.adapterId).toBe('slack')
    expect((d.body as { attachments: unknown[] }).attachments).toBeDefined()
  })

  test('routes an unknown URL to the generic JSON digest', () => {
    const d = buildWebhookDigestDispatchBody({
      url: 'https://example.com/webhook',
      payloads: [payload(), payload({ hostId: 1 })],
    })
    expect(d.adapterId).toBe('generic-json')
    expect((d.body as { digest: boolean }).digest).toBe(true)
  })
})
