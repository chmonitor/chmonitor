import {
  buildCustomTargetBody,
  buildCustomTargetDigestBody,
  buildCustomTargetPreview,
  groupableCustomFormat,
  isHttpsCustomWebhookUrl,
  normalizeCustomWebhookFormat,
  redactWebhookUrl,
  samplePreviewPayload,
  sanitizeCustomHeaders,
  sanitizeSecretHeaders,
  validateCustomWebhookDraft,
} from './custom-webhook-targets'
import { describe, expect, test } from 'bun:test'

const payload = samplePreviewPayload()

describe('custom webhook target formatting', () => {
  test('requires HTTPS at every target boundary', () => {
    expect(isHttpsCustomWebhookUrl('https://hooks.example.test/hook')).toBe(
      true
    )
    expect(isHttpsCustomWebhookUrl('http://hooks.example.test/hook')).toBe(
      false
    )
    expect(isHttpsCustomWebhookUrl('not a url')).toBe(false)
  })

  test('accepts raw-json as the canonical raw format', () => {
    expect(normalizeCustomWebhookFormat('raw-json')).toBe('raw')
    expect(normalizeCustomWebhookFormat('slack')).toBe('slack')
    expect(normalizeCustomWebhookFormat('unknown')).toBe('auto')
  })

  test('rejects unsafe headers and keeps bounded X headers', () => {
    const result = sanitizeCustomHeaders({
      'X-Source': 'chmonitor',
      Authorization: 'Bearer secret',
      'X-Bad\nName': 'x',
      'X-Long': 'x'.repeat(513),
    })
    expect(result.headers).toEqual({ 'X-Source': 'chmonitor' })
    expect(result.dropped).toEqual(['Authorization', 'X-Bad\nName', 'X-Long'])
  })

  test('allows modeled Authorization headers only from secret config', () => {
    expect(
      sanitizeSecretHeaders({
        Authorization: 'Bearer secret',
        Cookie: 'session=secret',
        'X-Team': 'ops',
      })
    ).toEqual({ Authorization: 'Bearer secret', 'X-Team': 'ops' })
  })

  test('renders allowlisted variables and preserves unknown placeholders', () => {
    const result = validateCustomWebhookDraft({
      name: 'alerts',
      format: 'raw',
      titleTemplate: '{{severity}} {{title}} {{unknown}}',
      bodyTemplate: '{{label}} on {{host}}',
    })
    expect(result.ok).toBe(true)
    const body = buildCustomTargetBody(
      {
        url: 'https://example.test/hook',
        format: 'raw',
        titleTemplate: '{{severity}} {{title}} {{unknown}}',
        bodyTemplate: '{{label}} on {{host}}',
      },
      payload
    )
    expect(JSON.stringify(body.body)).toContain('CRITICAL')
    expect(JSON.stringify(body.body)).toContain('{{unknown}}')
  })

  test('escapes Slack template text and redacts URL previews', () => {
    const body = buildCustomTargetBody(
      {
        url: 'https://hooks.slack.com/services/T/B/secret',
        format: 'slack',
        titleTemplate: '<hello> & {{title}}',
        bodyTemplate: '{{label}}',
      },
      payload
    )
    expect(JSON.stringify(body.body)).toContain('&lt;hello&gt;')
    const preview = buildCustomTargetPreview(
      {
        url: 'https://hooks.slack.com/services/T/B/secret?token=hidden',
        format: 'slack',
        titleTemplate: '',
        bodyTemplate: '',
        headers: {},
      },
      payload
    )
    expect(preview.redactedUrl).not.toContain('secret')
    expect(preview.redactedUrl).not.toContain('token')
  })

  test('hookshot format sends the {text, html} keys Hookshot reads', () => {
    // Hookshot dumps any body without `text` into the room as raw JSON, so
    // the Matrix m.notice shape (body/formatted_body) is unusable there.
    const target = {
      url: 'https://hookshot.example.test/webhook/abc',
      format: 'hookshot' as const,
      titleTemplate: '',
      bodyTemplate: '',
    }
    const { body, adapterId } = buildCustomTargetBody(target, payload)
    expect(adapterId).toBe('hookshot')
    const b = body as Record<string, string>
    expect(typeof b.text).toBe('string')
    expect(b.text).toContain('CRITICAL')
    expect(b.html).toContain('<b>')
    expect(b).not.toHaveProperty('msgtype')
    expect(b).not.toHaveProperty('formatted_body')
  })

  test('hookshot templates are HTML-escaped in html but kept in text', () => {
    const { body } = buildCustomTargetBody(
      {
        url: 'https://hookshot.example.test/webhook/abc',
        format: 'hookshot',
        titleTemplate: '<img src=x> {{severity}}',
        bodyTemplate: '',
      },
      payload
    )
    const b = body as Record<string, string>
    expect(b.html).toContain('&lt;img src=x&gt; CRITICAL')
    expect(b.html).not.toContain('<img')
    expect(b.text).toBe('<img src=x> CRITICAL')
  })

  test('caps rendered output by bytes', () => {
    const body = buildCustomTargetBody(
      {
        url: 'https://example.test/hook',
        format: 'raw',
        titleTemplate: '',
        bodyTemplate: 'x'.repeat(2000),
      },
      { ...payload, title: 'x'.repeat(70_000) }
    )
    expect(body.truncated).toBe(true)
    expect(JSON.stringify(body.body).length).toBeLessThan(70_000)
  })

  test('redacts query and fragment from webhook URLs', () => {
    expect(
      redactWebhookUrl('https://example.test/a/secret?token=x#fragment')
    ).toBe('https://example.test/••••')
  })
})

describe('slack custom target grouping (#4230)', () => {
  const mk = (
    n: number,
    severity: 'warning' | 'critical' | 'recovery' = 'warning'
  ) =>
    Array.from({ length: n }, (_, i) => ({
      ...payload,
      severity,
      hostId: i,
      hostLabel: `host-${i}`,
      label: `finding number ${i}`,
    }))
  type Digest = {
    text: string
    attachments: {
      color: string
      blocks: { type: string; text?: { text: string } }[]
    }[]
  }
  const digest = (list: ReturnType<typeof mk>) =>
    buildCustomTargetDigestBody('slack', list).body as Digest

  test('slack targets without templates are groupable; templated ones are not', () => {
    const base = { titleTemplate: '', bodyTemplate: '' }
    expect(groupableCustomFormat({ ...base, format: 'slack' })).toBe('slack')
    expect(
      groupableCustomFormat({
        ...base,
        format: 'slack',
        titleTemplate: '{{title}}',
      })
    ).toBeNull()
    expect(
      groupableCustomFormat({ ...base, format: 'slack', bodyTemplate: 'x' })
    ).toBeNull()
  })

  test('N>1 findings make one message whose text is the summary line', () => {
    const { body, adapterId } = buildCustomTargetDigestBody('slack', mk(3))
    const b = body as Digest
    expect(adapterId).toBe('slack')
    expect(b.text).toContain('Health digest:')
    expect(b.text).toContain('(3 alerts)')
    expect(b.attachments).toHaveLength(1)
    const list = b.attachments[0].blocks.find((x) => x.type === 'section')
    expect(list?.text?.text).toContain('host-2')
  })

  test('colour follows the highest severity; recovery-only is green', () => {
    const color = (l: ReturnType<typeof mk>) => digest(l).attachments[0].color
    expect(color([...mk(2, 'warning'), ...mk(1, 'critical')])).toBe('#dc2626')
    expect(color(mk(2, 'warning'))).toBe('#f59e0b')
    expect(color(mk(2, 'recovery'))).toBe('#16a34a')
  })

  test('60 findings stay inside Slack limits with an overflow line', () => {
    const b = digest(mk(60))
    const blocks = b.attachments[0].blocks
    expect(blocks.length).toBeLessThanOrEqual(50)
    for (const block of blocks) {
      const len = block.text?.text.length ?? 0
      expect(len).toBeLessThanOrEqual(block.type === 'header' ? 150 : 3000)
    }
    const section = blocks.find((x) => x.type === 'section')
    expect(section?.text?.text).toContain('…and 35 more')
  })

  test('very long finding lines are dropped into the overflow count', () => {
    const long = mk(25).map((p) => ({ ...p, title: 'x'.repeat(400) }))
    const section = digest(long).attachments[0].blocks.find(
      (x) => x.type === 'section'
    )
    expect(section?.text?.text.length).toBeLessThanOrEqual(3000)
    expect(section?.text?.text).toMatch(/…and \d+ more$/)
  })

  test('a templated slack target still renders one finding', () => {
    const { body } = buildCustomTargetBody(
      {
        url: 'https://hooks.slack.com/services/T/B/x',
        format: 'slack',
        titleTemplate: '{{host}} down',
        bodyTemplate: '',
      },
      payload
    )
    expect((body as { text: string }).text).toBe('db-prod-01 down')
  })
})
