import {
  buildCustomTargetBody,
  buildCustomTargetPreview,
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
    ).toBe('https://example.test/a••••')
  })
})
