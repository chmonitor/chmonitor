/**
 * Contract: operator-controlled text (host label, metric, title, label,
 * runbook URL) never reaches a markup-interpreting field as live markup.
 *
 * One hostile payload goes through every builder whose output is parsed as
 * Slack mrkdwn, Markdown, MarkdownV2 or HTML. Channels whose fields are plain
 * data (JSON values, SMS, push text) are listed with the reason they are out
 * of scope, so a new adapter has to pick a side.
 */

import type { AlertPayload } from '../types'

import { buildDiscordBody } from '../discord'
import { buildEmailBody } from '../email'
import { buildGoogleChatBody } from '../google-chat'
import { buildHookshotBody, buildHookshotDigestBody } from '../hookshot'
import { buildMatrixBody, buildMatrixDigestBody } from '../matrix'
import { buildMSTeamsBody } from '../msteams'
import {
  buildSlackBody,
  buildSlackBotDetails,
  buildSlackBotResolved,
  buildSlackBotTrend,
  buildSlackDigestBody,
} from '../slack'
import { buildTelegramDigestText, buildTelegramText } from '../telegram'
import { describe, expect, test } from 'bun:test'
import {
  buildAlertBlocksWithAck,
  buildQueryResultBlocks,
  buildStatusBlocks,
} from '@/lib/slack/blocks'

const HOSTILE = '<!channel> <script>alert(1)</script> *bold* | > "'
const HOSTILE_URL =
  'https://evil.example/a|<!channel>"><script>alert(1)</script>*bold*'

const PAYLOAD: AlertPayload = {
  severity: 'critical',
  hostLabel: HOSTILE,
  hostId: 1,
  metric: HOSTILE,
  value: 97,
  title: HOSTILE,
  label: HOSTILE,
  runbookUrls: [HOSTILE_URL],
  timestamp: '2026-07-02T10:00:00.000Z',
}

/** Substrings that must never appear verbatim in a markup-parsed field. */
const LIVE_MARKUP = ['<!channel>', '<script>', '"><script']

/** Every string under a node whose key is not in `skip`. */
function strings(node: unknown, skip: string[] = []): string[] {
  if (typeof node === 'string') return [node]
  if (Array.isArray(node)) return node.flatMap((n) => strings(n, skip))
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) =>
      skip.includes(key) ? [] : strings(value, skip)
    )
  }
  return []
}

/** Slack parses only `mrkdwn` text objects and the top-level `text`. */
function slackMrkdwn(body: unknown): string[] {
  const top = (body as { text?: unknown }).text
  const out = typeof top === 'string' ? [top] : []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>
      if (o.type === 'mrkdwn' && typeof o.text === 'string') out.push(o.text)
      Object.values(o).forEach(walk)
    }
  }
  walk(body)
  return out
}

interface Case {
  name: string
  fields: () => string[]
  /** Extra substrings this channel's escaper is expected to neutralize. */
  alsoForbidden?: string[]
}

const PAIR = [PAYLOAD, { ...PAYLOAD, hostId: 2 }]

const RESOLVED: AlertPayload = { ...PAYLOAD, severity: 'recovery' }
const ORIGINAL = {
  title: HOSTILE,
  hostLabel: HOSTILE,
  firstFiredAt: HOSTILE,
  value: 1,
}

const CASES: Case[] = [
  { name: 'slack', fields: () => slackMrkdwn(buildSlackBody(PAYLOAD)) },
  {
    name: 'slack digest',
    fields: () => slackMrkdwn(buildSlackDigestBody(PAIR)),
  },
  {
    name: 'slack app details',
    fields: () => slackMrkdwn(buildSlackBotDetails(PAYLOAD)),
  },
  {
    name: 'slack app trend',
    fields: () =>
      slackMrkdwn(
        buildSlackBotTrend(PAYLOAD, [
          { at: '2026-07-02T09:50:00.000Z', value: 1 },
          { at: '2026-07-02T09:55:00.000Z', value: 2 },
          { at: '2026-07-02T10:00:00.000Z', value: 3 },
        ])
      ),
  },
  {
    name: 'slack app resolved',
    fields: () => slackMrkdwn(buildSlackBotResolved(RESOLVED, ORIGINAL)),
  },
  {
    name: 'slack app ack message',
    fields: () =>
      slackMrkdwn(
        buildAlertBlocksWithAck(PAYLOAD, {
          hostId: 1,
          ruleId: 'r',
          severity: 'critical',
        })
      ),
  },
  {
    name: 'slack app query result',
    fields: () =>
      slackMrkdwn(
        buildQueryResultBlocks(HOSTILE, [{ [HOSTILE]: HOSTILE, x: HOSTILE }], {
          rowCap: 20,
        })
      ),
  },
  {
    name: 'slack app status',
    fields: () =>
      slackMrkdwn(
        buildStatusBlocks(HOSTILE, {
          hostId: 1,
          capturedAt: HOSTILE,
          topQueries: null,
          merges: null,
          memoryUsagePct: null,
          diskUsagePct: null,
          replicationLagSeconds: null,
        })
      ),
  },
  {
    name: 'google-chat',
    // `header` is plain text; the fallback `text` and every widget are parsed.
    fields: () => strings(buildGoogleChatBody(PAYLOAD), ['header']),
  },
  {
    name: 'msteams',
    fields: () => strings(buildMSTeamsBody(PAYLOAD)),
    alsoForbidden: ['*bold*'],
  },
  {
    name: 'telegram',
    fields: () => [buildTelegramText(PAYLOAD)],
    alsoForbidden: ['*bold*'],
  },
  {
    name: 'telegram digest',
    fields: () => [buildTelegramDigestText(PAIR)],
    alsoForbidden: ['*bold*'],
  },
  { name: 'matrix', fields: () => [buildMatrixBody(PAYLOAD).formatted_body] },
  {
    name: 'matrix digest',
    fields: () => [buildMatrixDigestBody(PAIR).formatted_body],
  },
  { name: 'hookshot', fields: () => [buildHookshotBody(PAYLOAD).html] },
  {
    name: 'hookshot digest',
    fields: () => [buildHookshotDigestBody(PAIR).html],
  },
  { name: 'email html', fields: () => [buildEmailBody(PAYLOAD).html] },
]

/** Plain-data channels: no field is parsed as markup, so nothing to escape. */
const PLAIN = {
  discord:
    'Markdown only; `allowed_mentions.parse = []` blocks pings (asserted below)',
  ntfy: 'plain text title and body',
  pushover: 'plain text unless html=1, which is not set',
  pagerduty: 'JSON data fields',
  opsgenie: 'JSON data fields',
  twilio: 'SMS plain text',
  'generic-json': 'JSON data fields',
}

describe('hostile operator text never reaches a markup field raw', () => {
  for (const c of CASES) {
    test(c.name, () => {
      const text = c.fields().join('\n')
      const leaked = [...LIVE_MARKUP, ...(c.alsoForbidden ?? [])].filter((s) =>
        text.includes(s)
      )
      expect({ leaked }).toEqual({ leaked: [] })
    })
  }

  test('a Slack link token cannot be closed or split by the URL', () => {
    const links = [
      buildSlackBody(PAYLOAD),
      buildSlackBotDetails(PAYLOAD),
      buildSlackBotResolved(RESOLVED, ORIGINAL),
    ]
      .flatMap(slackMrkdwn)
      .join('\n')
      .match(/<https?:[^\n]*>/g)
    expect(links?.length).toBeGreaterThan(0)
    for (const link of links ?? []) {
      // `<url|Label>`: only the URL part before the label separator.
      const inner = link.slice(1, -1)
      const url = inner.includes('|')
        ? inner.slice(0, inner.lastIndexOf('|'))
        : inner
      expect(url).not.toMatch(/[<>|]/)
    }
  })

  test('discord blocks mentions even though its text is not escaped', () => {
    expect(buildDiscordBody(PAYLOAD).allowed_mentions).toEqual({ parse: [] })
    expect(Object.keys(PLAIN)).toContain('discord')
  })
})
