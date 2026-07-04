/**
 * Unit + snapshot tests for the notification adapter layer.
 *
 * These formatters are PURE, so we assert their exact output shapes:
 *   - MarkdownV2 escaping of every reserved character (Telegram)
 *   - severity → emoji / colour / mapping across channels
 *   - dedup key + resolve mapping (PagerDuty)
 *   - detectAdapter() URL routing with generic-json fallback
 *
 * Runs in Bun's test runner (no browser needed — everything here is pure).
 */

import type { AlertPayload } from '@/lib/health/adapters'

import { describe, expect, test } from 'bun:test'
import {
  ALL_ADAPTERS,
  buildDiscordBody,
  buildEmailBody,
  buildGenericJsonBody,
  buildOpsgenieBody,
  buildPagerDutyBody,
  buildSlackBody,
  buildTelegramBody,
  buildTelegramText,
  detectAdapter,
  detectEmailProvider,
  discordAdapter,
  emailAdapter,
  escapeMarkdownV2,
  genericJsonAdapter,
  opsgenieAdapter,
  opsgenieAlias,
  pagerDutyAdapter,
  pagerDutyDedupKey,
  slackAdapter,
  telegramAdapter,
} from '@/lib/health/adapters'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CRITICAL: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-1',
  hostId: 2,
  metric: 'failed-mutations',
  value: 7,
  warnThreshold: 1,
  critThreshold: 5,
  title: 'Failed mutations',
  label: '7 failed mutations',
  runbookUrls: ['https://docs.example.com/runbook/mutations'],
  timestamp: '2026-07-02T10:00:00.000Z',
}

const WARNING: AlertPayload = {
  ...CRITICAL,
  severity: 'warning',
  value: 2,
  label: '2 failed mutations',
}

const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  value: 0,
  label: 'recovered',
}

/** Exercises HTML-escaping: markup, ampersands, quotes, and an unsafe link scheme. */
const XSS_ATTEMPT: AlertPayload = {
  ...CRITICAL,
  hostLabel: '<b>prod</b> & co',
  title: 'Mutation <script>alert(1)</script>',
  label: '"quoted" label \'value\'',
  runbookUrls: [
    'https://docs.example.com/runbook?x=1&y=2',
    'javascript:alert(1)',
  ],
}

// ---------------------------------------------------------------------------
// Telegram — MarkdownV2 escaping
// ---------------------------------------------------------------------------

describe('escapeMarkdownV2', () => {
  test('escapes every reserved character', () => {
    // The full MarkdownV2 special set: _*[]()~`>#+-=|{}.!
    const input = '_*[]()~`>#+-=|{}.!'
    const expected = '\\_\\*\\[\\]\\(\\)\\~\\`\\>\\#\\+\\-\\=\\|\\{\\}\\.\\!'
    expect(escapeMarkdownV2(input)).toBe(expected)
  })

  test('leaves ordinary text untouched', () => {
    expect(escapeMarkdownV2('hello world 123')).toBe('hello world 123')
  })

  test('escapes only specials inside mixed text', () => {
    expect(escapeMarkdownV2('a.b_c')).toBe('a\\.b\\_c')
  })

  test('handles an empty string', () => {
    expect(escapeMarkdownV2('')).toBe('')
  })
})

describe('telegram adapter', () => {
  test('critical text uses 🔴, escapes values, includes runbooks + timestamp', () => {
    const text = buildTelegramText(CRITICAL)
    expect(text).toContain('🔴')
    expect(text).toContain('*CRITICAL: Failed mutations*')
    expect(text).toContain('failed\\-mutations') // hyphen escaped
    expect(text).toContain('id 2')
    expect(text).toContain('*Runbooks:*')
    // Runbook URL dots/slashes escaped
    expect(text).toContain('https://docs\\.example\\.com/runbook/mutations')
    expect(text).toContain('_2026\\-07\\-02T10:00:00\\.000Z_')
  })

  test('warning uses 🟠 and recovery uses 🟢 with RECOVERY heading', () => {
    expect(buildTelegramText(WARNING)).toContain('🟠')
    const rec = buildTelegramText(RECOVERY)
    expect(rec).toContain('🟢')
    expect(rec).toContain('*RECOVERY: Failed mutations*')
  })

  test('buildTelegramBody returns sendMessage body with MarkdownV2 parse_mode', () => {
    const body = buildTelegramBody(CRITICAL, { chatId: '12345' })
    expect(body.chat_id).toBe('12345')
    expect(body.parse_mode).toBe('MarkdownV2')
    expect(body.text).toBe(buildTelegramText(CRITICAL))
  })

  test('null value renders n/a', () => {
    const body = buildTelegramText({ ...CRITICAL, value: null })
    expect(body).toContain('*Value:* n/a')
  })

  test('snapshot', () => {
    expect(buildTelegramBody(CRITICAL, { chatId: '12345' })).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

describe('slack adapter', () => {
  test('critical uses red colour and a summary text', () => {
    const body = buildSlackBody(CRITICAL)
    expect(body.attachments[0].color).toBe('#dc2626')
    expect(body.text).toBe(
      '[CRITICAL] Failed mutations — 7 failed mutations (host prod-1)'
    )
    expect(body.attachments[0].blocks[0].text?.text).toContain('🔴')
  })

  test('warning uses amber, recovery uses green', () => {
    expect(buildSlackBody(WARNING).attachments[0].color).toBe('#f59e0b')
    expect(buildSlackBody(RECOVERY).attachments[0].color).toBe('#16a34a')
  })

  test('includes runbook block when urls present', () => {
    const body = buildSlackBody(CRITICAL)
    const hasRunbook = body.attachments[0].blocks.some((b) =>
      b.text?.text?.includes('Runbooks')
    )
    expect(hasRunbook).toBe(true)
  })

  test('snapshot', () => {
    expect(buildSlackBody(CRITICAL)).toMatchSnapshot()
  })

  test('renders a link button for a runbook action', () => {
    const payload: AlertPayload = {
      ...CRITICAL,
      actions: [
        {
          id: 'failed-mutations-runbook',
          label: 'Failed mutations runbook',
          kind: 'runbook',
          url: 'https://docs.example.com/runbook',
        },
      ],
    }
    const body = buildSlackBody(payload)
    const actionsBlock = body.attachments[0].blocks.find(
      (b) => b.type === 'actions'
    )
    expect(actionsBlock).toBeDefined()
    const button = actionsBlock?.elements?.[0] as {
      type: string
      url?: string
      text?: { text: string }
    }
    expect(button.type).toBe('button')
    expect(button.url).toBe('https://docs.example.com/runbook')
    expect(button.text?.text).toBe('Failed mutations runbook')
  })

  test('lists diagnostic actions as text, never as an interactive button carrying SQL', () => {
    const payload: AlertPayload = {
      ...CRITICAL,
      actions: [
        {
          id: 'failed-mutations-detail',
          label: 'Get failed mutations',
          kind: 'diagnostic',
        },
      ],
    }
    const body = buildSlackBody(payload)
    const serialized = JSON.stringify(body)
    expect(serialized).toContain('Get failed mutations')
    // The payload never carries raw SQL — only labeled ids.
    expect(serialized).not.toContain('SELECT')
    const actionsBlock = body.attachments[0].blocks.find(
      (b) => b.type === 'actions'
    )
    expect(actionsBlock).toBeUndefined()
  })

  test('omits the actions block when no actions are present', () => {
    const body = buildSlackBody(CRITICAL)
    const actionsBlock = body.attachments[0].blocks.find(
      (b) => b.type === 'actions'
    )
    expect(actionsBlock).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Discord
// ---------------------------------------------------------------------------

describe('discord adapter', () => {
  test('critical embed uses decimal red color', () => {
    const body = buildDiscordBody(CRITICAL)
    expect(body.embeds[0].color).toBe(0xdc2626)
    expect(body.embeds[0].title).toContain('🔴')
    expect(body.content).toContain('[CRITICAL]')
  })

  test('warning + recovery colours', () => {
    expect(buildDiscordBody(WARNING).embeds[0].color).toBe(0xf59e0b)
    expect(buildDiscordBody(RECOVERY).embeds[0].color).toBe(0x16a34a)
  })

  test('snapshot', () => {
    expect(buildDiscordBody(CRITICAL)).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// PagerDuty
// ---------------------------------------------------------------------------

describe('pagerduty adapter', () => {
  test('critical triggers with critical severity + dedup key', () => {
    const body = buildPagerDutyBody(CRITICAL, { routingKey: 'R123' })
    expect(body.routing_key).toBe('R123')
    expect(body.event_action).toBe('trigger')
    expect(body.payload.severity).toBe('critical')
    expect(body.dedup_key).toBe('chmonitor:2:failed-mutations')
    expect(body.dedup_key).toBe(pagerDutyDedupKey(CRITICAL))
    expect(body.links?.[0]?.href).toBe(
      'https://docs.example.com/runbook/mutations'
    )
  })

  test('warning maps to warning severity', () => {
    expect(
      buildPagerDutyBody(WARNING, { routingKey: 'R' }).payload.severity
    ).toBe('warning')
  })

  test('recovery becomes a resolve event with info severity', () => {
    const body = buildPagerDutyBody(RECOVERY, { routingKey: 'R' })
    expect(body.event_action).toBe('resolve')
    expect(body.payload.severity).toBe('info')
  })

  test('snapshot', () => {
    expect(
      buildPagerDutyBody(CRITICAL, { routingKey: 'R123' })
    ).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Opsgenie
// ---------------------------------------------------------------------------

describe('opsgenie adapter', () => {
  test('critical maps to P1 priority with a stable alias', () => {
    const body = buildOpsgenieBody(CRITICAL)
    expect(body.priority).toBe('P1')
    expect(body.alias).toBe('chmonitor:2:failed-mutations')
    expect(body.alias).toBe(opsgenieAlias(CRITICAL))
    expect(body.source).toBe('chmonitor')
    expect(body.message).toBe(
      'Failed mutations — 7 failed mutations (host prod-1)'
    )
  })

  test('warning maps to P2, recovery maps to P3', () => {
    expect(buildOpsgenieBody(WARNING).priority).toBe('P2')
    expect(buildOpsgenieBody(RECOVERY).priority).toBe('P3')
  })

  test('repeated firings for the same host+metric share one alias', () => {
    expect(opsgenieAlias(CRITICAL)).toBe(opsgenieAlias(WARNING))
    expect(opsgenieAlias(CRITICAL)).toBe(opsgenieAlias(RECOVERY))
  })

  test('tags host + metric + chmonitor', () => {
    expect(buildOpsgenieBody(CRITICAL).tags).toEqual([
      'host:prod-1',
      'metric:failed-mutations',
      'chmonitor',
    ])
  })

  test('details values are all strings', () => {
    const details = buildOpsgenieBody(CRITICAL).details
    for (const value of Object.values(details)) {
      expect(typeof value).toBe('string')
    }
    expect(details.value).toBe('7')
    expect(details.warnThreshold).toBe('1')
    expect(details.critThreshold).toBe('5')
  })

  test('null value and missing thresholds render "n/a" strings', () => {
    const details = buildOpsgenieBody({
      ...CRITICAL,
      value: null,
      warnThreshold: null,
      critThreshold: null,
    }).details
    expect(details.value).toBe('n/a')
    expect(details.warnThreshold).toBe('n/a')
    expect(details.critThreshold).toBe('n/a')
  })

  test('includes runbook urls in the description', () => {
    expect(buildOpsgenieBody(CRITICAL).description).toContain(
      'https://docs.example.com/runbook/mutations'
    )
  })

  test('omits description when no runbook urls are present', () => {
    const { runbookUrls: _runbookUrls, ...withoutRunbooks } = CRITICAL
    expect(buildOpsgenieBody(withoutRunbooks).description).toBeUndefined()
  })

  test('snapshot', () => {
    expect(buildOpsgenieBody(CRITICAL)).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Generic JSON
// ---------------------------------------------------------------------------

describe('generic-json adapter', () => {
  test('produces a normalized body with a one-line summary', () => {
    const body = buildGenericJsonBody(CRITICAL)
    expect(body.severity).toBe('critical')
    expect(body.thresholds).toEqual({ warning: 1, critical: 5 })
    expect(body.host).toEqual({ id: 2, label: 'prod-1' })
    expect(body.text).toBe(
      '[CRITICAL] Failed mutations — 7 failed mutations (host prod-1)'
    )
    expect(body.runbookUrls).toEqual([
      'https://docs.example.com/runbook/mutations',
    ])
  })

  test('recovery heading in text', () => {
    expect(buildGenericJsonBody(RECOVERY).text).toContain('[RECOVERY]')
  })

  test('forwards snapshot when present', () => {
    const withSnap = buildGenericJsonBody({ ...CRITICAL, snapshot: { a: 1 } })
    expect(withSnap.snapshot).toEqual({ a: 1 })
  })

  test('snapshot', () => {
    expect(buildGenericJsonBody(CRITICAL)).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

describe('email adapter', () => {
  test('subject uses uppercase severity and metric/host', () => {
    expect(buildEmailBody(CRITICAL).subject).toBe(
      '[CRITICAL] failed-mutations on prod-1'
    )
    expect(buildEmailBody(WARNING).subject).toBe(
      '[WARNING] failed-mutations on prod-1'
    )
  })

  test('recovery subject reads RESOLVED, not RECOVERY', () => {
    expect(buildEmailBody(RECOVERY).subject).toBe(
      '[RESOLVED] failed-mutations on prod-1'
    )
  })

  test('html includes host, metric, value, thresholds, timestamp, and a runbook link', () => {
    const { html } = buildEmailBody(CRITICAL)
    expect(html).toContain('prod-1 (id 2)')
    expect(html).toContain('failed-mutations')
    expect(html).toContain('>7<')
    expect(html).toContain('warn 1 | crit 5')
    expect(html).toContain('2026-07-02T10:00:00.000Z')
    expect(html).toContain(
      '<a href="https://docs.example.com/runbook/mutations"'
    )
  })

  test('null value renders n/a in both html and text', () => {
    const body = buildEmailBody({ ...CRITICAL, value: null })
    expect(body.html).toContain('>n/a<')
    expect(body.text).toContain('Value: n/a')
  })

  test('text mirrors the html content in plaintext', () => {
    const { text } = buildEmailBody(CRITICAL)
    expect(text).toContain('CRITICAL: Failed mutations')
    expect(text).toContain('Host: prod-1 (id 2)')
    expect(text).toContain('Runbooks:')
    expect(text).toContain('- https://docs.example.com/runbook/mutations')
  })

  test('escapes HTML-special characters in host label, title, and label', () => {
    const { html } = buildEmailBody(XSS_ATTEMPT)
    expect(html).toContain('&lt;b&gt;prod&lt;/b&gt; &amp; co')
    expect(html).toContain('Mutation &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&quot;quoted&quot; label &#39;value&#39;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toContain('<b>prod</b>')
  })

  test('escapes ampersands in runbook href attributes', () => {
    const { html } = buildEmailBody(XSS_ATTEMPT)
    expect(html).toContain(
      'href="https://docs.example.com/runbook?x=1&amp;y=2"'
    )
  })

  test('does not render a javascript: runbook url as a clickable link', () => {
    const { html } = buildEmailBody(XSS_ATTEMPT)
    expect(html).not.toContain('href="javascript:alert(1)"')
    // still shown as inert escaped text, not silently dropped
    expect(html).toContain('javascript:alert(1)')
  })

  test('snapshot', () => {
    expect(buildEmailBody(CRITICAL)).toMatchSnapshot()
  })
})

describe('detectEmailProvider', () => {
  test('maps mailgun/sendgrid/smtp(s) schemes', () => {
    expect(detectEmailProvider('mailgun://key@domain.example')).toBe('mailgun')
    expect(detectEmailProvider('sendgrid://key')).toBe('sendgrid')
    expect(detectEmailProvider('smtp://user:pass@host:25')).toBe('smtp')
    expect(detectEmailProvider('smtps://user:pass@host:465')).toBe('smtp')
  })

  test('is case-insensitive on the scheme', () => {
    expect(detectEmailProvider('MAILGUN://key@domain.example')).toBe('mailgun')
  })

  test('returns null for unknown schemes, including http(s)', () => {
    expect(detectEmailProvider('https://hooks.slack.com/services/x')).toBe(null)
    expect(detectEmailProvider('http://example.com')).toBe(null)
    expect(detectEmailProvider('ftp://example.com')).toBe(null)
    expect(detectEmailProvider('not a url')).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// Registry + detectAdapter
// ---------------------------------------------------------------------------

describe('detectAdapter', () => {
  test('routes known webhook hosts to their adapter', () => {
    expect(
      detectAdapter('https://api.telegram.org/bot123:abc/sendMessage').id
    ).toBe('telegram')
    expect(detectAdapter('https://hooks.slack.com/services/T/B/x').id).toBe(
      'slack'
    )
    expect(detectAdapter('https://discord.com/api/webhooks/1/abc').id).toBe(
      'discord'
    )
    expect(detectAdapter('https://discordapp.com/api/webhooks/1/abc').id).toBe(
      'discord'
    )
    expect(detectAdapter('https://events.pagerduty.com/v2/enqueue').id).toBe(
      'pagerduty'
    )
    expect(detectAdapter('https://api.opsgenie.com/v2/alerts').id).toBe(
      'opsgenie'
    )
    expect(detectAdapter('https://api.eu.opsgenie.com/v2/alerts').id).toBe(
      'opsgenie'
    )
  })

  test('falls back to generic-json for unknown urls', () => {
    expect(detectAdapter('https://example.com/webhook').id).toBe('generic-json')
  })

  test('adapters expose their ids', () => {
    expect(telegramAdapter.id).toBe('telegram')
    expect(slackAdapter.id).toBe('slack')
    expect(discordAdapter.id).toBe('discord')
    expect(pagerDutyAdapter.id).toBe('pagerduty')
    expect(opsgenieAdapter.id).toBe('opsgenie')
    expect(genericJsonAdapter.id).toBe('generic-json')
    expect(emailAdapter.id).toBe('email')
  })

  test('adapter.buildBody returns something for each channel', () => {
    for (const adapter of [
      telegramAdapter,
      slackAdapter,
      discordAdapter,
      pagerDutyAdapter,
      opsgenieAdapter,
      genericJsonAdapter,
      emailAdapter,
    ]) {
      expect(adapter.buildBody(CRITICAL)).toBeDefined()
    }
  })

  test('ALL_ADAPTERS includes every channel adapter plus generic-json and email', () => {
    const ids = ALL_ADAPTERS.map((a) => a.id).sort()
    expect(ids).toEqual(
      [
        'telegram',
        'slack',
        'discord',
        'pagerduty',
        'opsgenie',
        'generic-json',
        'email',
      ].sort()
    )
  })

  test('email adapter.detect matches only provider config URL schemes, never http(s)', () => {
    expect(emailAdapter.detect?.('mailgun://key@domain.example')).toBe(true)
    expect(emailAdapter.detect?.('sendgrid://key')).toBe(true)
    expect(emailAdapter.detect?.('smtp://user:pass@host:25')).toBe(true)
    expect(emailAdapter.detect?.('smtps://user:pass@host:465')).toBe(true)
    expect(emailAdapter.detect?.('https://hooks.slack.com/services/x')).toBe(
      false
    )
    expect(emailAdapter.detect?.('http://example.com')).toBe(false)
  })

  test('email is NOT in the URL-detection registry, so detectAdapter routing for existing http(s) webhook URLs is unaffected', () => {
    // Same assertions as the "routes known webhook hosts" test above, re-run
    // after the email adapter's registration — a regression guard for the
    // explicit STOP condition in plans/25-email-alert-adapter.md.
    expect(detectAdapter('https://example.com/webhook').id).toBe('generic-json')
    expect(detectAdapter('https://hooks.slack.com/services/T/B/x').id).toBe(
      'slack'
    )
    expect(detectAdapter('https://events.pagerduty.com/v2/enqueue').id).toBe(
      'pagerduty'
    )
    // Provider config URLs never match a channel adapter either — they fall
    // back to generic-json via detectAdapter (email is dispatched explicitly,
    // not through this URL registry).
    expect(detectAdapter('mailgun://key@domain.example').id).toBe(
      'generic-json'
    )
  })
})
