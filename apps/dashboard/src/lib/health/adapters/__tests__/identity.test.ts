/**
 * Deployment identity on alerts: several chmonitor deployments post into ONE
 * channel, so every message must say which deployment it came from, link back
 * to that deployment's dashboard, and carry operator metadata. Unset identity
 * must leave every body exactly as before (other snapshot tests rely on it).
 */

import type { AlertPayload } from '@/lib/health/adapters'

import { describe, expect, test } from 'bun:test'
import {
  buildDiscordBody,
  buildGenericJsonBody,
  buildGenericJsonDigestBody,
  buildGoogleChatBody,
  buildHookshotBody,
  buildMatrixBody,
  buildMSTeamsBody,
  buildNtfyMessage,
  buildSlackBody,
  buildSlackDigestBody,
  buildTelegramDigestText,
  buildTelegramText,
} from '@/lib/health/adapters'
import { renderCustomTemplate } from '@/lib/health/custom-webhook-targets'

const BASE: AlertPayload = {
  severity: 'critical',
  hostLabel: 'ch-1',
  hostId: 1,
  metric: 'disk-usage',
  value: 95,
  warnThreshold: 80,
  critThreshold: 90,
  title: 'Disk almost full',
  label: '95% used',
  timestamp: '2026-01-01T00:00:00.000Z',
}

const WITH_ID: AlertPayload = {
  ...BASE,
  instanceName: 'prod-eu',
  dashboardUrl: 'https://chm.example.com/health?host=1',
  metadata: { team: 'db', region: 'eu' },
}

const HOSTILE: AlertPayload = {
  ...BASE,
  instanceName: '<script>x</script>',
  metadata: { team: '<!channel>' },
}

const LINK = 'https://chm.example.com/health?host=1'

describe('adapters include instance, link, and metadata when set', () => {
  test('slack: summary prefix, Open dashboard button, identity context', () => {
    const body = buildSlackBody(WITH_ID)
    expect(body.text.startsWith('[prod-eu] [CRITICAL]')).toBe(true)
    const blocks = body.attachments[0].blocks
    const button = blocks
      .flatMap((b) => b.elements ?? [])
      .find((e) => e.type === 'button')
    expect(button).toMatchObject({ url: LINK })
    expect(JSON.stringify(blocks)).toContain(
      'instance prod-eu · team=db · region=eu'
    )
  })

  test('discord: content prefix, embed url, footer', () => {
    const body = buildDiscordBody(WITH_ID)
    expect(body.content.startsWith('[prod-eu] ')).toBe(true)
    expect(body.embeds[0].url).toBe(LINK)
    expect(body.embeds[0].footer?.text).toBe(
      'instance prod-eu · team=db · region=eu'
    )
  })

  test('matrix + hookshot: link in html and text; hookshot username', () => {
    const m = buildMatrixBody(WITH_ID)
    expect(m.body).toContain('[prod-eu]')
    expect(m.body).toContain(LINK)
    expect(m.formatted_body).toContain(
      '<a href="https://chm.example.com/health?host=1">Open dashboard</a>'
    )
    const h = buildHookshotBody(WITH_ID)
    expect(h.username).toBe('prod-eu')
    expect(h.text).toContain(LINK)
    expect(h.html).toContain('Open dashboard</a>')
  })

  test('generic json: instance, dashboardUrl, metadata fields', () => {
    const body = buildGenericJsonBody(WITH_ID)
    expect(body.instance).toBe('prod-eu')
    expect(body.dashboardUrl).toBe(LINK)
    expect(body.metadata).toEqual({ team: 'db', region: 'eu' })
    expect(body.text.startsWith('[prod-eu] ')).toBe(true)
  })

  test('teams, google chat, telegram, ntfy carry instance and link', () => {
    const card = buildMSTeamsBody(WITH_ID).attachments[0].content
    // Card action, not a markdown link a URL could break out of.
    expect(card.actions).toEqual([
      { type: 'Action.OpenUrl', title: 'Open dashboard', url: LINK },
    ])
    expect(JSON.stringify(card.body)).not.toContain('](')
    const hostileCard = buildMSTeamsBody({
      ...BASE,
      instanceName: '[x](https://evil)',
      metadata: { team: '*bold*' },
    }).attachments[0].content
    const texts = JSON.stringify(hostileCard.body)
    expect(texts).toContain('\\\\[x\\\\]\\\\(https://evil\\\\)')
    expect(texts).toContain('\\\\*bold\\\\*')
    expect('actions' in buildMSTeamsBody(BASE).attachments[0].content).toBe(
      false
    )
    const gchat = buildGoogleChatBody(WITH_ID)
    expect(gchat.text.startsWith('[prod-eu] ')).toBe(true)
    expect(JSON.stringify(gchat)).toContain('Open dashboard')
    const tg = buildTelegramText(WITH_ID)
    expect(tg).toContain('\\[prod\\-eu\\]')
    expect(tg).toContain(`[Open dashboard](${LINK})`)
    const ntfy = buildNtfyMessage(WITH_ID)
    expect(ntfy.title.startsWith('[prod-eu] ')).toBe(true)
    expect(ntfy.body).toContain(`Dashboard: ${LINK}`)
  })
})

describe('unset identity leaves bodies unchanged', () => {
  test('no identity keys, no prefix, no extra blocks', () => {
    const slack = buildSlackBody(BASE)
    expect(slack.text.startsWith('[CRITICAL]')).toBe(true)
    expect(JSON.stringify(slack)).not.toContain('Open dashboard')
    const discord = buildDiscordBody(BASE)
    expect('url' in discord.embeds[0]).toBe(false)
    expect('footer' in discord.embeds[0]).toBe(false)
    const json = buildGenericJsonBody(BASE)
    expect(
      'instance' in json || 'dashboardUrl' in json || 'metadata' in json
    ).toBe(false)
    expect('username' in buildHookshotBody(BASE)).toBe(false)
    expect(buildMatrixBody(BASE).formatted_body).not.toContain('<a ')
  })
})

describe('escaping of instance/metadata values', () => {
  test('slack mrkdwn escapes <script> and <!channel>', () => {
    const s = JSON.stringify(buildSlackBody(HOSTILE))
    expect(s).not.toContain('<!channel>')
    expect(s).toContain('&lt;!channel&gt;')
    expect(buildSlackBody(HOSTILE).text).toContain('&lt;script&gt;')
  })

  test('matrix/hookshot/google chat html is escaped', () => {
    for (const html of [
      buildMatrixBody(HOSTILE).formatted_body,
      buildHookshotBody(HOSTILE).html,
      JSON.stringify(buildGoogleChatBody(HOSTILE).cardsV2),
    ]) {
      expect(html).not.toContain('<script>')
      expect(html).toContain('&lt;script&gt;')
    }
  })
})

describe('digest', () => {
  test('summary carries instance; each line names its host', () => {
    const a = { ...WITH_ID, hostLabel: 'ch-1', hostId: 1 }
    const b = {
      ...WITH_ID,
      hostLabel: 'ch-2',
      hostId: 2,
      severity: 'warning' as const,
    }
    const json = buildGenericJsonDigestBody([a, b])
    expect(json.summary.startsWith('[prod-eu] ')).toBe(true)
    expect(json.text).toContain('(host ch-1)')
    expect(json.text).toContain('(host ch-2)')
    expect(buildSlackDigestBody([a, b]).text).toContain('[prod-eu]')
    expect(buildTelegramDigestText([a, b])).toContain('\\[prod\\-eu\\]')
    expect(buildGenericJsonDigestBody([BASE]).summary).toBe(
      '1 critical on 1 host'
    )
  })
})

describe('custom template vars', () => {
  test('{{instance}}, {{dashboardUrl}}, {{meta.team}} resolve', () => {
    expect(
      renderCustomTemplate(
        '{{instance}} {{dashboardUrl}} {{meta.team}}',
        WITH_ID,
        500
      )
    ).toBe(`prod-eu ${LINK} db`)
  })

  test('unknown meta keys stay verbatim; unset identity renders empty', () => {
    expect(renderCustomTemplate('{{meta.nope}}', WITH_ID, 100)).toBe(
      '{{meta.nope}}'
    )
    expect(renderCustomTemplate('[{{instance}}]', BASE, 100)).toBe('[]')
  })
})
