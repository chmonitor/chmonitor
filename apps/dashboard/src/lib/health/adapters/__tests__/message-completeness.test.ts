/**
 * Contract: every channel adapter shows the same facts about an alert.
 *
 * One rich payload goes through every single-alert and digest builder, the
 * body is flattened to text, and each fact is looked for. A channel that
 * truly cannot carry a fact lists it in `exempt` with the reason. An
 * exemption that is not needed (the fact is shown anyway) fails, so the table
 * cannot rot. A new adapter must be added here.
 */

import type { AlertPayload } from '../types'

import { buildDiscordBody } from '../discord'
import { buildEmailBody } from '../email'
import {
  buildGenericJsonBody,
  buildGenericJsonDigestBody,
} from '../generic-json'
import { buildGoogleChatBody } from '../google-chat'
import { buildHookshotBody, buildHookshotDigestBody } from '../hookshot'
import { buildMatrixBody, buildMatrixDigestBody } from '../matrix'
import { buildMSTeamsBody } from '../msteams'
import { buildNtfyMessage } from '../ntfy'
import { buildOpsgenieBody } from '../opsgenie'
import { buildPagerDutyBody } from '../pagerduty'
import { buildPushoverMessage } from '../pushover'
import { buildSlackBody, buildSlackDigestBody } from '../slack'
import { buildTelegramDigestText, buildTelegramText } from '../telegram'
import { buildTwilioMessage } from '../twilio'
import { describe, expect, test } from 'bun:test'

const HOUR = 3_600_000

const FIRING: AlertPayload = {
  severity: 'critical',
  hostLabel: 'prod-eu-1',
  hostId: 4217,
  metric: 'disk-usage',
  value: 97.25,
  warnThreshold: 71.5,
  critThreshold: 93.5,
  title: 'Disk almost full',
  label: 'data volume nearly full',
  runbookUrls: ['https://runbooks.example.com/disk-full'],
  actions: [
    {
      id: 'ttl',
      label: 'Check TTL',
      kind: 'runbook',
      url: 'https://runbooks.example.com/ttl',
    },
  ],
  timestamp: '2026-07-02T10:00:00.000Z',
  instanceName: 'prod-eu',
  dashboardUrl: 'https://chm.example.com/health?host=4217',
  metadata: { team: 'dbre-oncall' },
}

const REMINDER: AlertPayload = {
  ...FIRING,
  stillOpenMs: 3 * HOUR,
  previousValue: 88.5,
}

const RECOVERY: AlertPayload = {
  ...FIRING,
  severity: 'recovery',
  value: 41.75,
  firedForMs: 3 * HOUR,
}

type Fact =
  | 'severity'
  | 'title'
  | 'label'
  | 'host'
  | 'value'
  | 'warn'
  | 'crit'
  | 'runbook'
  | 'dashboard'
  | 'instance'
  | 'metadata'

const FIRING_FACTS: Record<Fact, (text: string) => boolean> = {
  severity: (t) => /critical/i.test(t),
  title: (t) => t.includes('Disk almost full'),
  label: (t) => t.includes('data volume nearly full'),
  host: (t) => t.includes('prod-eu-1'),
  value: (t) => t.includes('97.25'),
  warn: (t) => t.includes('71.5'),
  crit: (t) => t.includes('93.5'),
  runbook: (t) => t.includes('https://runbooks.example.com/disk-full'),
  dashboard: (t) => t.includes('https://chm.example.com/health?host=4217'),
  instance: (t) => /instance prod-eu\b|\[prod-eu\]|prod-eu\//.test(t),
  metadata: (t) => t.includes('dbre-oncall'),
}

/** Every string and number in a body, newline-joined; MarkdownV2 escapes removed. */
function flatten(body: unknown, unescapeMarkdownV2 = false): string {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (typeof node === 'string') out.push(node)
    else if (typeof node === 'number') out.push(String(node))
    else if (Array.isArray(node)) node.forEach(walk)
    else if (node && typeof node === 'object') {
      Object.values(node).forEach(walk)
    }
  }
  walk(body)
  const text = out.join('\n')
  return unescapeMarkdownV2 ? text.replace(/\\(.)/g, '$1') : text
}

interface Channel {
  name: string
  render: (p: AlertPayload) => string
  /** Facts the platform truly cannot carry, each with the reason. */
  exempt?: Partial<Record<Fact, string>>
}

const SINGLE: Channel[] = [
  { name: 'slack', render: (p) => flatten(buildSlackBody(p)) },
  { name: 'discord', render: (p) => flatten(buildDiscordBody(p)) },
  { name: 'msteams', render: (p) => flatten(buildMSTeamsBody(p), true) },
  { name: 'google-chat', render: (p) => flatten(buildGoogleChatBody(p)) },
  { name: 'telegram', render: (p) => flatten(buildTelegramText(p), true) },
  { name: 'ntfy', render: (p) => flatten(buildNtfyMessage(p)) },
  { name: 'pushover', render: (p) => flatten(buildPushoverMessage(p)) },
  {
    name: 'pagerduty',
    render: (p) => flatten(buildPagerDutyBody(p, { routingKey: 'rk' })),
  },
  { name: 'opsgenie', render: (p) => flatten(buildOpsgenieBody(p)) },
  { name: 'email', render: (p) => flatten(buildEmailBody(p)) },
  { name: 'matrix', render: (p) => flatten(buildMatrixBody(p)) },
  { name: 'hookshot', render: (p) => flatten(buildHookshotBody(p)) },
  { name: 'generic-json', render: (p) => flatten(buildGenericJsonBody(p)) },
  {
    name: 'twilio',
    render: (p) => buildTwilioMessage(p),
    exempt: {
      warn: 'SMS is billed per 160-char segment; the value is kept, thresholds are not',
      crit: 'SMS is billed per 160-char segment; the value is kept, thresholds are not',
      runbook:
        'SMS is billed per 160-char segment; the dashboard link is kept, runbooks are not',
    },
  },
]

const OTHER_HOST: Partial<AlertPayload> = { hostId: 9, hostLabel: 'prod-eu-2' }
const pair = (p: AlertPayload) => [p, { ...p, ...OTHER_HOST }]

const DIGEST: Channel[] = [
  {
    name: 'slack digest',
    render: (p) => flatten(buildSlackDigestBody(pair(p))),
  },
  {
    name: 'telegram digest',
    render: (p) => flatten(buildTelegramDigestText(pair(p)), true),
  },
  {
    name: 'matrix digest',
    render: (p) => flatten(buildMatrixDigestBody(pair(p))),
  },
  {
    name: 'hookshot digest',
    render: (p) => flatten(buildHookshotDigestBody(pair(p))),
  },
  {
    name: 'generic-json digest',
    render: (p) => flatten(buildGenericJsonDigestBody(pair(p))),
  },
]

/** A digest is one short line per finding, so it carries these facts only. */
const DIGEST_FACTS: Fact[] = [
  'severity',
  'title',
  'label',
  'host',
  'instance',
  'dashboard',
]

function check(
  channel: Channel,
  text: string,
  facts: Partial<Record<Fact, (t: string) => boolean>>
) {
  const exempt = channel.exempt ?? {}
  const keys = Object.keys(facts) as Fact[]
  const missing = keys.filter((f) => !exempt[f] && !facts[f]?.(text))
  const staleExemptions = (Object.keys(exempt) as Fact[]).filter((f) =>
    facts[f]?.(text)
  )
  expect({ missing }).toEqual({ missing: [] })
  expect({ staleExemptions }).toEqual({ staleExemptions: [] })
}

describe('a firing alert shows every fact', () => {
  for (const channel of SINGLE) {
    test(channel.name, () => {
      check(channel, channel.render(FIRING), FIRING_FACTS)
    })
  }
})

describe('a digest shows the facts a one-line finding can carry', () => {
  const facts = {
    ...Object.fromEntries(DIGEST_FACTS.map((f) => [f, FIRING_FACTS[f]])),
    // A digest spans hosts, so its one link drops the `host` param.
    dashboard: (t: string) => t.includes('https://chm.example.com/health'),
  }
  for (const channel of DIGEST) {
    test(channel.name, () => {
      check(channel, channel.render(FIRING), facts)
    })
  }
})

describe('a reminder shows how long it is open and how the value moved', () => {
  for (const channel of [...SINGLE, ...DIGEST]) {
    test(channel.name, () => {
      const text = channel.render(REMINDER)
      const missing = [
        ['stillOpen', /still open, 3 h/.test(text)],
        ['previousValue', text.includes('88.5')],
      ]
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
      expect({ missing }).toEqual({ missing: [] })
    })
  }
})

describe('a recovery says it is resolved and how long it fired', () => {
  for (const channel of [...SINGLE, ...DIGEST]) {
    test(channel.name, () => {
      const text = channel.render(RECOVERY)
      const missing = [
        ['resolved', text.includes('RESOLVED')],
        ['noRecoveryLabel', !/\bRECOVERY\b/.test(text)],
        ['title', text.includes('Disk almost full')],
        ['host', text.includes('prod-eu-1')],
        ['firedFor', /fired for 3 h/.test(text)],
      ]
        .filter(([, ok]) => !ok)
        .map(([name]) => name)
      expect({ missing }).toEqual({ missing: [] })
    })
  }
})
