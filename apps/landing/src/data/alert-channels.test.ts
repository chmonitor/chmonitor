import { FEATURE_PAGES } from './feature-pages'
import { FEATURE_SECTIONS } from './feature-showcase'
import {
  ALERT_CHANNELS,
  ALERT_CHANNELS_FULL,
  ALERT_CHANNELS_SHORT,
} from './alert-channels'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const landingSrc = join(import.meta.dir, '..')

function pageCopy(): string {
  const page = FEATURE_PAGES.find((p) => p.slug === 'alerting')
  if (!page) throw new Error('missing /features/alerting page')
  return [
    page.description,
    page.subhead,
    ...page.stats.flatMap((s) => [s.value, s.label]),
    ...page.sections.flatMap((s) => [s.title, s.body, ...(s.bullets ?? [])]),
    ...page.capabilities.flatMap((c) => [c.title, c.body]),
    ...page.faq.flatMap((f) => [f.q, f.a]),
  ].join('\n')
}

describe('alert-channel marketing copy', () => {
  test('canonical lists match health docs', () => {
    expect([...ALERT_CHANNELS]).toEqual([
      'Slack',
      'Discord',
      'Teams',
      'Google Chat',
      'Telegram',
      'ntfy',
      'Pushover',
      'Twilio SMS',
      'Opsgenie',
      'PagerDuty',
      'healthchecks.io',
    ])
    expect(ALERT_CHANNELS_SHORT).toBe(
      'Slack, Discord, PagerDuty, Opsgenie, and more'
    )
    expect(ALERT_CHANNELS_FULL).toContain('Slack')
    expect(ALERT_CHANNELS_FULL).toContain('healthchecks.io')
    expect(ALERT_CHANNELS_FULL).not.toMatch(/one webhook/i)
  })

  test('homepage hero, feature card, coverage grid, and comparison share the short list', () => {
    const hero = readFileSync(join(landingSrc, 'components/Hero.astro'), 'utf8')
    const capabilities = readFileSync(
      join(landingSrc, 'components/Capabilities.astro'),
      'utf8'
    )
    const comparison = readFileSync(
      join(landingSrc, 'components/Comparison.astro'),
      'utf8'
    )
    const alerting = FEATURE_SECTIONS.find((s) => s.id === 'feature-alerting')
    if (!alerting) throw new Error('missing feature-alerting section')

    for (const text of [hero, capabilities, comparison]) {
      expect(text).toContain('ALERT_CHANNELS_SHORT')
      expect(text).not.toMatch(/one webhook|1 webhook/i)
    }
    expect(alerting.bullets.join('\n')).toContain(ALERT_CHANNELS_SHORT)
  })

  test('/features/alerting lists every shipped channel and drops one-webhook', () => {
    const hay = pageCopy()
    for (const channel of ALERT_CHANNELS) {
      expect(hay).toContain(channel)
    }
    expect(hay).not.toMatch(/one webhook|1 webhook/i)
  })
})
