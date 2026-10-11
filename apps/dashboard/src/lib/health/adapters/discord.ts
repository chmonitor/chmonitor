/**
 * Discord notification adapter (pure formatter).
 *
 * Builds a Discord webhook body carrying a single rich embed whose `color`
 * (decimal RGB) is keyed off severity. Fields carry host/metric/value/threshold
 * context. The webhook URL comes from caller configuration.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

import { identityLine, instancePrefix } from './identity'

/** Severity → embed colour (decimal RGB, as Discord expects) and emoji. */
const SEVERITY_STYLE: Record<AlertSeverity, { color: number; emoji: string }> =
  {
    // 0xdc2626 / 0xf59e0b / 0x16a34a
    critical: { color: 0xdc2626, emoji: '🔴' },
    warning: { color: 0xf59e0b, emoji: '🟠' },
    recovery: { color: 0x16a34a, emoji: '🟢' },
  }

interface DiscordEmbedField {
  name: string
  value: string
  inline?: boolean
}

interface DiscordEmbed {
  title: string
  description?: string
  color: number
  fields: DiscordEmbedField[]
  timestamp: string
  /** Title link (the dashboard deep link), when configured. */
  url?: string
  footer?: { text: string }
}

/** Discord webhook body: content summary + one rich embed. */
export interface DiscordWebhookBody {
  content: string
  embeds: DiscordEmbed[]
  /** Empty `parse` list: no field (title, label, instance) can ping `@everyone` or a role. */
  allowed_mentions: { parse: [] }
}

function heading(severity: AlertSeverity): string {
  return severity === 'recovery' ? 'RECOVERY' : severity.toUpperCase()
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
 * Build the Discord webhook body for a payload.
 */
export function buildDiscordBody(payload: AlertPayload): DiscordWebhookBody {
  const style = SEVERITY_STYLE[payload.severity]
  const summary = `${instancePrefix(payload)}[${heading(payload.severity)}] ${payload.title} — ${payload.label} (host ${payload.hostLabel})`

  const fields: DiscordEmbedField[] = [
    {
      name: 'Host',
      value: `${payload.hostLabel} (id ${payload.hostId})`,
      inline: true,
    },
    { name: 'Metric', value: payload.metric, inline: true },
    {
      name: 'Value',
      value: String(payload.value === null ? 'n/a' : payload.value),
      inline: true,
    },
    { name: 'Thresholds', value: thresholdText(payload), inline: true },
  ]

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    fields.push({
      name: 'Runbooks',
      value: payload.runbookUrls.map((u) => `• ${u}`).join('\n'),
    })
  }

  const embed: DiscordEmbed = {
    title: `${style.emoji} ${heading(payload.severity)}: ${payload.title}`,
    description: payload.label,
    color: style.color,
    fields,
    timestamp: payload.timestamp,
  }
  if (payload.dashboardUrl) embed.url = payload.dashboardUrl
  const identity = identityLine(payload)
  if (identity) embed.footer = { text: identity }

  return {
    content: summary,
    embeds: [embed],
    allowed_mentions: { parse: [] },
  }
}

/** Discord adapter. `buildBody` returns the webhook JSON body. */
export const discordAdapter: NotificationAdapter = {
  id: 'discord',
  detect: (url: string) =>
    /(?:^|\/\/)(?:discord\.com|discordapp\.com)\/api\/webhooks\//i.test(url),
  buildBody: (payload: AlertPayload) => buildDiscordBody(payload),
}
