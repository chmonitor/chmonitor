/**
 * Unit tests for `buildWebhookDispatchBody` — the pure URL → per-channel body
 * mapping shared by the server sweep and the client "Send test" proxy path
 * (#2656).
 *
 * Asserts the exact shape each adapter produces:
 *   - Discord URL → verbatim `provider: 'discord'` + rich embed (severity
 *     colour, host, metric, value) instead of plain `content`.
 *   - Slack URL → the existing `{ text, content }` wrapper, plus `blocks` only
 *     when the caller supplies them (native Slack app, server sweep only).
 *   - Generic / unknown URL → the exact original `{ text, content }` wrapper —
 *     zero behavior change.
 *   - Recovery variant maps to the green recovery embed.
 *
 * Runs in Bun's test runner (everything here is pure — no transport).
 */

import type { AlertPayload } from '@/lib/health/adapters'

import { describe, expect, test } from 'bun:test'
import {
  buildDiscordBody,
  buildWebhookDispatchBody,
} from '@/lib/health/adapters'

const DISCORD_URL = 'https://discord.com/api/webhooks/123/abc'
const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/xxxx'
const GENERIC_URL = 'https://example.com/hooks/alerts'

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
  timestamp: '2026-07-16T10:00:00.000Z',
}

const RECOVERY: AlertPayload = {
  ...CRITICAL,
  severity: 'recovery',
  label: 'resolved',
}

const TEXT = '[CRITICAL] Failed mutations — 7 failed mutations (host prod-1)'

describe('buildWebhookDispatchBody', () => {
  test('Discord URL → verbatim provider + rich embed', () => {
    const result = buildWebhookDispatchBody({
      url: DISCORD_URL,
      text: TEXT,
      payload: CRITICAL,
    })

    expect(result.adapterId).toBe('discord')
    expect(result.provider).toBe('discord')
    // Body is the exact Discord embed body — not the generic `{ text, content }`.
    expect(result.body).toEqual(buildDiscordBody(CRITICAL))

    const body = result.body as ReturnType<typeof buildDiscordBody>
    expect(body.embeds).toHaveLength(1)
    // Critical severity → red embed (0xdc2626).
    expect(body.embeds[0].color).toBe(0xdc2626)
    const fieldByName = (name: string) =>
      body.embeds[0].fields.find((f) => f.name === name)?.value
    expect(fieldByName('Host')).toBe('prod-1 (id 2)')
    expect(fieldByName('Metric')).toBe('failed-mutations')
    expect(fieldByName('Value')).toBe('7')
  })

  test('Discord recovery variant → green recovery embed', () => {
    const result = buildWebhookDispatchBody({
      url: DISCORD_URL,
      text: '[RECOVERY] Failed mutations — resolved (host prod-1)',
      payload: RECOVERY,
    })

    expect(result.provider).toBe('discord')
    const body = result.body as ReturnType<typeof buildDiscordBody>
    // Recovery severity → green embed (0x16a34a) and RECOVERY heading.
    expect(body.embeds[0].color).toBe(0x16a34a)
    expect(body.embeds[0].title).toContain('RECOVERY')
  })

  test('Slack URL without blocks → plain { text, content } wrapper', () => {
    const result = buildWebhookDispatchBody({
      url: SLACK_URL,
      text: TEXT,
      payload: CRITICAL,
    })

    expect(result.adapterId).toBe('slack')
    // No verbatim provider — the proxy builds the wrapper from `text`.
    expect(result.provider).toBeUndefined()
    expect(result.body).toEqual({ text: TEXT, content: TEXT })
  })

  test('Slack URL with blocks → wrapper + blocks (native Slack app path)', () => {
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: 'hi' } }]
    const result = buildWebhookDispatchBody({
      url: SLACK_URL,
      text: TEXT,
      payload: CRITICAL,
      slackBlocks: blocks,
    })

    expect(result.adapterId).toBe('slack')
    expect(result.provider).toBeUndefined()
    expect(result.body).toEqual({ text: TEXT, content: TEXT, blocks })
  })

  test('Generic URL → exact original { text, content } wrapper (zero change)', () => {
    const result = buildWebhookDispatchBody({
      url: GENERIC_URL,
      text: TEXT,
      payload: CRITICAL,
    })

    expect(result.adapterId).toBe('generic-json')
    expect(result.provider).toBeUndefined()
    expect(result.body).toEqual({ text: TEXT, content: TEXT })
  })

  test('Generic URL ignores slackBlocks — stays the plain wrapper', () => {
    const result = buildWebhookDispatchBody({
      url: GENERIC_URL,
      text: TEXT,
      payload: CRITICAL,
      slackBlocks: [{ type: 'section' }],
    })

    expect(result.body).toEqual({ text: TEXT, content: TEXT })
  })
})
