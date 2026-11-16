/**
 * apps/blog/src/data/slack-fixtures.json is the data behind the blog's Slack
 * demo, written by apps/dashboard/scripts/gen-slack-fixtures.ts from the real
 * alert builders. This test regenerates it and fails when the committed copy
 * is stale, so the blog never shows a message the builders no longer send.
 */

import {
  FIXTURES_PATH,
  type FixtureMessage,
  fixturesJson,
  generateSlackFixtures,
} from '../../apps/dashboard/scripts/gen-slack-fixtures'
import { buildSlackSparkline } from '../../apps/dashboard/src/lib/health/adapters/slack-chart'
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const REGEN_HINT = 'run bun apps/dashboard/scripts/gen-slack-fixtures.ts'

/** Compared as parsed JSON: biome may re-wrap the file without changing it. */
function isStale(generated: unknown, committed: string | null): boolean {
  if (committed === null) return true
  try {
    return !Bun.deepEquals(JSON.parse(committed), generated, true)
  } catch {
    return true
  }
}

function readCommitted(): string | null {
  try {
    return readFileSync(FIXTURES_PATH, 'utf8')
  } catch {
    return null
  }
}

const generated = generateSlackFixtures()
const asWritten = JSON.parse(fixturesJson(generated))
const threads = generated.threads

function sectionText(message: FixtureMessage): string {
  const block = message.body.blocks?.[0] as { text?: { text?: string } }
  return block?.text?.text ?? ''
}

describe('blog Slack demo fixtures match the alert builders', () => {
  test('committed JSON is up to date', () => {
    if (isStale(asWritten, readCommitted())) {
      throw new Error(`Stale ${FIXTURES_PATH}: ${REGEN_HINT}`)
    }
  })

  test('a changed builder line is caught as stale', () => {
    const mutated = structuredClone(asWritten)
    mutated.threads.newAlert.parent.body.attachments[0].blocks[0].text.text +=
      ' (edited)'
    expect(isStale(mutated, readCommitted())).toBe(true)
  })

  test('output is deterministic', () => {
    expect(generateSlackFixtures()).toEqual(generated)
  })

  test('every trend chart series is the one its sparkline was drawn from', () => {
    const withTrend = Object.values(threads)
      .flatMap((t) => t.replies)
      .filter((m) => m.trend)
    expect(withTrend.length).toBeGreaterThan(0)
    for (const m of withTrend) {
      const { series, warn, crit } = m.trend!
      expect(sectionText(m)).toContain(
        buildSlackSparkline(series, { warn, crit })
      )
    }
  })

  test('the ack replaces the button with who acked it', () => {
    const acked = threads.ack.replies.at(-1)!
    expect(acked.body.blocks?.map((b) => (b as { type: string }).type)).toEqual(
      ['section', 'context', 'context']
    )
    expect(acked.body.blocks?.at(-1)).toEqual({
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '✅ Acknowledged by <@U0DEMO1> · 2026-11-16T09:52:00.000Z',
        },
      ],
    })
  })

  test('the resolved reply quotes the alert as it first fired', () => {
    expect(sectionText(threads.resolved.replies.at(-1)!).split('\n')).toEqual([
      '🟢 *RESOLVED*  [prod-eu] Disk Usage · prod-ch-1 · resolved after 1 h · peak 96 · last 62 · <https://chmonitor.example.com/health?host=0|Open>',
      '> 🟠 *WARNING*  Disk Usage · prod-ch-1 · 84 · fired 2026-11-16 09:12 UTC',
    ])
  })
})
