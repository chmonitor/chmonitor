/**
 * Google Chat notification adapter (pure formatter).
 *
 * Builds a Google Chat Incoming Webhook body using the modern `cardsV2` card
 * format:
 *
 *   { text: '...', cardsV2: [{ cardId: '...', card: { header, sections } }] }
 *
 * A `text` fallback (Google Chat's plain-text summary, also shown in chat
 * notifications/search) always accompanies the card. The card header carries
 * the rule title and a severity emoji/heading (Google Chat cards have no
 * native colour accent field, unlike Slack attachments or Adaptive Cards, so
 * severity is conveyed the same way every other channel here does it — a
 * coloured-circle emoji + heading text); a section of `decoratedText` widgets
 * carries host/metric/value/thresholds; the recovery ('resolved') variant
 * renders a green RESOLVED heading. The webhook URL comes from caller
 * configuration.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

/** Severity → heading emoji, matching every other channel adapter. */
const SEVERITY_STYLE: Record<AlertSeverity, { emoji: string }> = {
  critical: { emoji: '🔴' },
  warning: { emoji: '🟠' },
  recovery: { emoji: '🟢' },
}

interface GoogleChatDecoratedTextWidget {
  decoratedText: {
    topLabel: string
    text: string
    wrapText?: boolean
  }
}

interface GoogleChatTextParagraphWidget {
  textParagraph: { text: string }
}

type GoogleChatWidget =
  | GoogleChatDecoratedTextWidget
  | GoogleChatTextParagraphWidget

interface GoogleChatSection {
  widgets: GoogleChatWidget[]
}

interface GoogleChatCardHeader {
  title: string
  subtitle?: string
}

interface GoogleChatCard {
  header: GoogleChatCardHeader
  sections: GoogleChatSection[]
}

interface GoogleChatCardsV2Entry {
  cardId: string
  card: GoogleChatCard
}

/** Google Chat webhook body: plain-text fallback + one cardsV2 card. */
export interface GoogleChatWebhookBody {
  text: string
  cardsV2: GoogleChatCardsV2Entry[]
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
 * Build the Google Chat cardsV2 webhook body for a payload.
 */
export function buildGoogleChatBody(
  payload: AlertPayload
): GoogleChatWebhookBody {
  const style = SEVERITY_STYLE[payload.severity]
  const text = `[${heading(payload.severity)}] ${payload.title} — ${payload.label} (host ${payload.hostLabel})`

  const widgets: GoogleChatWidget[] = [
    {
      decoratedText: {
        topLabel: 'Host',
        text: `${payload.hostLabel} (id ${payload.hostId})`,
      },
    },
    { decoratedText: { topLabel: 'Metric', text: payload.metric } },
    {
      decoratedText: {
        topLabel: 'Value',
        text: String(payload.value === null ? 'n/a' : payload.value),
      },
    },
    {
      decoratedText: { topLabel: 'Thresholds', text: thresholdText(payload) },
    },
  ]

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    widgets.push({
      textParagraph: {
        text: `<b>Runbooks:</b><br>${payload.runbookUrls
          .map((u) => `• <a href="${u}">${u}</a>`)
          .join('<br>')}`,
      },
    })
  }

  widgets.push({ textParagraph: { text: payload.timestamp } })

  return {
    text,
    cardsV2: [
      {
        cardId: 'chmonitor-alert',
        card: {
          header: {
            title: `${style.emoji} ${heading(payload.severity)}: ${payload.title}`,
            subtitle: payload.label,
          },
          sections: [{ widgets }],
        },
      },
    ],
  }
}

/**
 * Google Chat adapter. Matches Google Chat's incoming-webhook host
 * (`chat.googleapis.com`). `buildBody` returns the `{ text, cardsV2 }` JSON
 * body.
 */
export const googleChatAdapter: NotificationAdapter = {
  id: 'google-chat',
  detect: (url: string) => /(?:^|\/\/)chat\.googleapis\.com\//i.test(url),
  buildBody: (payload: AlertPayload) => buildGoogleChatBody(payload),
}
