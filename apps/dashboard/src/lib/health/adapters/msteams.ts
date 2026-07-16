/**
 * Microsoft Teams notification adapter (pure formatter).
 *
 * Builds an Adaptive Card payload for a Teams Incoming Webhook (or a Workflows
 * "Post to a channel" flow). The legacy MessageCard / Office 365 connector
 * format is deprecated, so this uses the modern Adaptive Card envelope:
 *
 *   { type: 'message', attachments: [{
 *       contentType: 'application/vnd.microsoft.card.adaptive',
 *       content: { type: 'AdaptiveCard', ... },
 *   }] }
 *
 * A coloured heading TextBlock (`attention` / `warning` / `good`) carries the
 * severity accent; a FactSet carries host/metric/value/thresholds; the recovery
 * ('resolved') variant renders a green RESOLVED heading. The webhook URL comes
 * from caller configuration.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Adaptive Card colour vocabulary. */
type AdaptiveColor = 'attention' | 'warning' | 'good'

/** Severity → Adaptive Card heading colour and emoji. */
const SEVERITY_STYLE: Record<
  AlertSeverity,
  { color: AdaptiveColor; emoji: string }
> = {
  critical: { color: 'attention', emoji: '🔴' },
  warning: { color: 'warning', emoji: '🟠' },
  recovery: { color: 'good', emoji: '🟢' },
}

interface AdaptiveTextBlock {
  type: 'TextBlock'
  text: string
  weight?: 'bolder' | 'lighter' | 'default'
  size?: 'small' | 'default' | 'medium' | 'large' | 'extraLarge'
  color?: AdaptiveColor
  wrap?: boolean
  isSubtle?: boolean
}

interface AdaptiveFact {
  title: string
  value: string
}

interface AdaptiveFactSet {
  type: 'FactSet'
  facts: AdaptiveFact[]
}

type AdaptiveElement = AdaptiveTextBlock | AdaptiveFactSet

interface AdaptiveCard {
  $schema: string
  type: 'AdaptiveCard'
  version: string
  body: AdaptiveElement[]
}

interface MSTeamsAttachment {
  contentType: 'application/vnd.microsoft.card.adaptive'
  contentUrl: null
  content: AdaptiveCard
}

/** Microsoft Teams webhook body: a single Adaptive Card attachment. */
export interface MSTeamsWebhookBody {
  type: 'message'
  attachments: MSTeamsAttachment[]
}

function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RESOLVED' : severity.toUpperCase()
}

function thresholdText(payload: AlertPayload): string {
  const parts: string[] = []
  if (payload.warnThreshold !== undefined && payload.warnThreshold !== null) {
    parts.push(`warn ${payload.warnThreshold}`)
  }
  if (payload.critThreshold !== undefined && payload.critThreshold !== null) {
    parts.push(`crit ${payload.critThreshold}`)
  }
  return parts.length > 0 ? parts.join(' | ') : '—'
}

/**
 * Build the Microsoft Teams Adaptive Card body for a payload.
 */
export function buildMSTeamsBody(payload: AlertPayload): MSTeamsWebhookBody {
  const style = SEVERITY_STYLE[payload.severity]

  const facts: AdaptiveFact[] = [
    { title: 'Host', value: `${payload.hostLabel} (id ${payload.hostId})` },
    { title: 'Metric', value: payload.metric },
    {
      title: 'Value',
      value: String(payload.value === null ? 'n/a' : payload.value),
    },
    { title: 'Thresholds', value: thresholdText(payload) },
  ]

  const body: AdaptiveElement[] = [
    {
      type: 'TextBlock',
      text: `${style.emoji} ${heading(payload.severity)}: ${payload.title}`,
      weight: 'bolder',
      size: 'large',
      color: style.color,
      wrap: true,
    },
    {
      type: 'TextBlock',
      text: payload.label,
      wrap: true,
    },
    { type: 'FactSet', facts },
  ]

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    body.push({
      type: 'TextBlock',
      text: `**Runbooks:**\n\n${payload.runbookUrls.map((u) => `- ${u}`).join('\n\n')}`,
      wrap: true,
    })
  }

  body.push({
    type: 'TextBlock',
    text: payload.timestamp,
    size: 'small',
    isSubtle: true,
    wrap: true,
  })

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body,
        },
      },
    ],
  }
}

/**
 * Microsoft Teams adapter. Matches both the classic incoming-webhook host
 * (`*.webhook.office.com`) and the Workflows / Power Automate trigger host
 * (`*.logic.azure.com`). `buildBody` returns the Adaptive Card JSON body.
 */
export const msTeamsAdapter: NotificationAdapter = {
  id: 'msteams',
  detect: (url: string) =>
    /(?:\/\/|\.)(?:[a-z0-9-]+\.)*(?:webhook\.office\.com|logic\.azure\.com)(?::\d+)?(?:\/|$)/i.test(
      url
    ),
  buildBody: (payload: AlertPayload) => buildMSTeamsBody(payload),
}
