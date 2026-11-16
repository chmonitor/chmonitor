/**
 * Generates the Slack alert scenes the blog demo renders
 * (apps/blog/src/data/slack-fixtures.json). Every message body comes from the
 * real builders, so the blog can only show what alerts really send.
 * tests/repo/slack-fixtures-sync.test.ts fails when the committed file drifts.
 *
 *   bun apps/dashboard/scripts/gen-slack-fixtures.ts
 *
 * All data is fake. The host is prod-ch-1 and the dashboard is
 * chmonitor.example.com.
 */

import type { SlackChartPoint } from '@/lib/health/adapters/slack-chart'
import type { AlertPayload, AlertSeverity } from '@/lib/health/adapters/types'
import type { AckKey } from '@/lib/slack/blocks'

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  buildSlackBody,
  buildSlackBotResolved,
  buildSlackBotStandingParent,
  buildSlackBotTrend,
  type SlackBotMessage,
  type SlackWebhookBody,
} from '@/lib/health/adapters/slack'
import {
  buildAckedMessageBlocks,
  buildAlertBlocksWithAck,
  type SlackBlock,
} from '@/lib/slack/blocks'

export const FIXTURES_PATH = fileURLToPath(
  new URL('../../blog/src/data/slack-fixtures.json', import.meta.url)
)

/**
 * What the scenes assume beyond the builders: who posts, who acks, and which
 * reaction marks an ack or a resolve. Not read from code yet; point these at
 * the dispatcher's constants once it has them.
 */
const SCENE = {
  channel: 'alerts-prod',
  webhookApp: 'chmonitor',
  bot: { name: 'chmonitor prod-eu', iconEmoji: ':rotating_light:' },
  users: { U0DEMO1: 'mai' },
  ackedBy: 'U0DEMO1',
  reactions: { ack: 'eyes', resolved: 'white_check_mark' },
  sweepMinutes: 5,
} as const

const FIRED_AT = '2026-11-16T09:12:00.000Z'
const ESCALATED_AT = '2026-11-16T09:47:00.000Z'
const ACKED_AT = '2026-11-16T09:52:00.000Z'
const RESOLVED_AT = '2026-11-16T10:31:00.000Z'

const WARN = 80
const CRIT = 95

/**
 * Worst-disk usage (%) per sweep, oldest first, the last one at ESCALATED_AT.
 * The 16th reading, 84, is the one that fires the warning at FIRED_AT.
 */
const READINGS = [
  70, 70, 71, 71, 72, 72, 73, 73, 74, 75, 75, 76, 77, 78, 79, 84, 85, 86, 88,
  90, 92, 94, 96,
]

const DISK_USAGE: Omit<
  AlertPayload,
  'severity' | 'value' | 'label' | 'timestamp'
> = {
  hostLabel: 'prod-ch-1',
  hostId: 0,
  metric: 'disk-usage',
  title: 'Disk Usage',
  warnThreshold: WARN,
  critThreshold: CRIT,
  runbookUrls: ['https://docs.chmonitor.dev/guide/guides/disk-usage-runbook'],
  instanceName: 'prod-eu',
  dashboardUrl: 'https://chmonitor.example.com/health?host=0',
  metadata: { team: 'data', region: 'eu' },
}

function diskAlert(
  severity: AlertSeverity,
  value: number,
  timestamp: string,
  extra: Partial<AlertPayload> = {}
): AlertPayload {
  return {
    ...DISK_USAGE,
    severity,
    value,
    label: `${value}% used (worst disk)`,
    timestamp,
    ...extra,
  }
}

/** The Acknowledge button, built the way the sweep dispatcher builds it. */
function ackButton(payload: AlertPayload): SlackBlock[] {
  const key: AckKey = {
    hostId: payload.hostId,
    ruleId: payload.metric,
    severity: payload.severity,
  }
  return buildAlertBlocksWithAck(payload, key).filter(
    (b) => b.type === 'actions'
  )
}

export interface FixtureMessage {
  author: 'webhook' | 'bot'
  ts: string
  edited?: boolean
  body: SlackBotMessage | SlackWebhookBody
  reactions?: { name: string; count: number }[]
}

export interface FixtureThread {
  parent: FixtureMessage
  replies: FixtureMessage[]
}

export interface SlackFixtures {
  generatedBy: string
  channel: string
  authors: Record<
    FixtureMessage['author'],
    { name: string; iconEmoji?: string }
  >
  users: Record<string, string>
  threads: {
    webhook: FixtureThread
    newAlert: FixtureThread
    escalation: FixtureThread
    ack: FixtureThread
    resolved: FixtureThread
  }
}

/** `values` one sweep apart, the last one at `end`. */
function sweepPoints(
  values: readonly number[],
  end: string
): SlackChartPoint[] {
  const endMs = Date.parse(end)
  const stepMs = SCENE.sweepMinutes * 60_000
  return values.map((value, i) => ({
    at: new Date(endMs - (values.length - 1 - i) * stepMs).toISOString(),
    value,
  }))
}

function detailsReply(
  payload: AlertPayload,
  series: readonly SlackChartPoint[]
): FixtureMessage & { body: SlackBotMessage } {
  return {
    author: 'bot',
    ts: payload.timestamp,
    body: buildSlackBotTrend(payload, series, ackButton(payload)),
  }
}

function reaction(name: string): { name: string; count: number }[] {
  return [{ name, count: 1 }]
}

export function generateSlackFixtures(): SlackFixtures {
  const warning = diskAlert('warning', 84, FIRED_AT)
  const critical = diskAlert('critical', 96, ESCALATED_AT)
  const recovery = diskAlert('recovery', 62, RESOLVED_AT, {
    firedForMs: Date.parse(RESOLVED_AT) - Date.parse(FIRED_AT),
  })

  const parent = (
    ts: string,
    open: { critical: number; warning: number },
    edited: boolean
  ): FixtureMessage => ({
    author: 'bot',
    ts,
    ...(edited ? { edited } : {}),
    body: buildSlackBotStandingParent(open),
  })

  // A new episode has no recorded values, so its details carry no trend.
  const warningReply = detailsReply(warning, [])
  const criticalReply = detailsReply(
    critical,
    sweepPoints(READINGS, ESCALATED_AT)
  )
  const ackedReply: FixtureMessage = {
    ...criticalReply,
    body: {
      ...criticalReply.body,
      blocks: buildAckedMessageBlocks(
        criticalReply.body.blocks as SlackBlock[],
        SCENE.ackedBy,
        ACKED_AT
      ),
    },
    reactions: reaction(SCENE.reactions.ack),
  }
  const resolvedReply: FixtureMessage = {
    author: 'bot',
    ts: RESOLVED_AT,
    body: buildSlackBotResolved(recovery, {
      title: warning.title,
      hostLabel: warning.hostLabel,
      firstFiredAt: FIRED_AT,
      value: warning.value,
      severity: 'warning',
      peak: Math.max(...READINGS),
    }),
  }

  return {
    generatedBy: 'apps/dashboard/scripts/gen-slack-fixtures.ts',
    channel: SCENE.channel,
    authors: {
      webhook: { name: SCENE.webhookApp },
      bot: { name: SCENE.bot.name, iconEmoji: SCENE.bot.iconEmoji },
    },
    users: { ...SCENE.users },
    threads: {
      webhook: {
        parent: {
          author: 'webhook',
          ts: FIRED_AT,
          body: buildSlackBody(warning),
        },
        replies: [],
      },
      newAlert: {
        parent: parent(FIRED_AT, { critical: 0, warning: 1 }, false),
        replies: [warningReply],
      },
      escalation: {
        parent: parent(FIRED_AT, { critical: 1, warning: 0 }, true),
        replies: [warningReply, criticalReply],
      },
      ack: {
        parent: parent(FIRED_AT, { critical: 1, warning: 0 }, true),
        replies: [warningReply, ackedReply],
      },
      resolved: {
        parent: parent(FIRED_AT, { critical: 0, warning: 0 }, true),
        replies: [
          { ...warningReply, reactions: reaction(SCENE.reactions.resolved) },
          ackedReply,
          resolvedReply,
        ],
      },
    },
  }
}

export function fixturesJson(fixtures: SlackFixtures): string {
  return `${JSON.stringify(fixtures, null, 2)}\n`
}

if (import.meta.main) {
  writeFileSync(FIXTURES_PATH, fixturesJson(generateSlackFixtures()))
  console.log(`wrote ${FIXTURES_PATH}`)
}
