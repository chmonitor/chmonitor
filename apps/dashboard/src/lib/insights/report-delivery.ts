/**
 * Multi-channel report delivery (#2787 / #2788).
 *
 * Fans a built report out to the owner's already-configured alert channels
 * (`alert_channel_config` via `resolveServerChannels` — no separate recipient
 * list). Channel semantics:
 *
 * - email     → full self-contained HTML (the report is already email-safe)
 * - webhook   → `{ text, content }` markdown digest (Discord/Slack-compatible)
 * - telegram  → plain-text digest via Bot API `sendMessage` (no parse_mode,
 *               so no MarkdownV2 escaping pitfalls)
 * - ntfy      → plain-text digest with a `Title` header
 * - pushover  → plain-text digest via the Messages API
 *
 * Paging channels (Opsgenie, PagerDuty, Twilio) are deliberately excluded —
 * a scheduled digest is not an incident and must never page anyone.
 *
 * Every sender is best-effort with a 10s timeout and never throws; the result
 * maps channel → ok so callers can audit (`recordReportDelivery`).
 */

import type { WeeklyReport } from './weekly-report'

import { PERIOD_LABEL } from './weekly-report'
import { warn } from '@chm/logger'
import { validateHostUrl } from '@/lib/browser-connections/host-url'
import { sendAlertEmail } from '@/lib/health/email-transport'
import { PUSHOVER_MESSAGES_API_URL } from '@/lib/health/pushover-dispatch'
import { resolveServerChannels } from '@/lib/health/server-channel-resolve'
import { telegramSendMessageUrl } from '@/lib/health/telegram-dispatch'

/** Discord's `content` and Telegram's `text` both cap near 2000/4096 chars. */
const MAX_DIGEST_LENGTH = 1900
const FETCH_TIMEOUT_MS = 10_000

export type ReportChannel =
  | 'email'
  | 'webhook'
  | 'telegram'
  | 'ntfy'
  | 'pushover'

export interface ReportDeliveryResult {
  /** Channels that were configured and attempted, with per-channel outcome. */
  readonly channels: Partial<Record<ReportChannel, boolean>>
  /** True when at least one channel was configured. */
  readonly channelConfigured: boolean
  /** True when at least one configured channel accepted the report. */
  readonly delivered: boolean
}

function digestText(report: WeeklyReport): string {
  const md = report.markdown
  if (md.length <= MAX_DIGEST_LENGTH) return md
  return `${md.slice(0, MAX_DIGEST_LENGTH - 15)}\n…(truncated)`
}

function reportSubject(report: WeeklyReport): string {
  const s = report.summary
  return `${PERIOD_LABEL[s.period ?? 'weekly']} health report — ${s.hostLabel}`
}

async function timedPost(
  url: string,
  init: Omit<RequestInit, 'signal'>
): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

async function sendWebhook(url: string, text: string): Promise<boolean> {
  const ssrfError = await validateHostUrl(url)
  if (ssrfError) {
    warn(`[report-delivery] blocked SSRF-unsafe webhook URL: ${ssrfError}`)
    return false
  }
  return timedPost(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, content: text }),
  })
}

/** Optional extras for a delivery (e.g. a rendered PDF to attach — #2794). */
export interface ReportDeliveryOptions {
  /** PDF bytes to attach to the email channel. Ignored by digest channels. */
  readonly pdf?: Uint8Array
  /** Attachment filename for the PDF (defaults to `report.pdf`). */
  readonly pdfFilename?: string
}

/**
 * Deliver a report to every non-paging channel the owner has configured.
 * Never throws; failures degrade to `ok: false` per channel.
 *
 * When `options.pdf` is provided it is attached to the email channel only
 * (#2794); the digest channels (webhook/telegram/ntfy/pushover) stay text.
 */
export async function deliverReport(
  ownerId: string,
  report: WeeklyReport,
  options: ReportDeliveryOptions = {}
): Promise<ReportDeliveryResult> {
  const resolved = await resolveServerChannels(ownerId)
  const settings = resolved.channelSettings
  const enabled = (channel: ReportChannel) =>
    settings[channel]?.enabled !== false

  const text = digestText(report)
  const subject = reportSubject(report)
  const channels: Partial<Record<ReportChannel, boolean>> = {}

  if (resolved.email && enabled('email')) {
    channels.email = await sendAlertEmail(resolved.email, {
      subject,
      html: report.html,
      text: report.markdown,
      attachments: options.pdf
        ? [
            {
              filename: options.pdfFilename ?? 'report.pdf',
              contentType: 'application/pdf',
              content: options.pdf,
            },
          ]
        : undefined,
    })
  }

  if (resolved.webhookUrl && enabled('webhook')) {
    channels.webhook = await sendWebhook(resolved.webhookUrl, text)
  }

  if (resolved.telegram && enabled('telegram')) {
    channels.telegram = await timedPost(
      telegramSendMessageUrl(resolved.telegram.botToken),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: resolved.telegram.chatId,
          text,
          disable_web_page_preview: true,
        }),
      }
    )
  }

  if (resolved.ntfy && enabled('ntfy')) {
    channels.ntfy = await timedPost(resolved.ntfy.url, {
      method: 'POST',
      headers: {
        Title: subject,
        ...(resolved.ntfy.token
          ? { Authorization: `Bearer ${resolved.ntfy.token}` }
          : {}),
      },
      body: text,
    })
  }

  if (resolved.pushover && enabled('pushover')) {
    channels.pushover = await timedPost(PUSHOVER_MESSAGES_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: resolved.pushover.token,
        user: resolved.pushover.user,
        title: subject,
        message: text,
      }),
    })
  }

  const attempted = Object.values(channels)
  return {
    channels,
    channelConfigured: attempted.length > 0,
    delivered: attempted.some(Boolean),
  }
}

/** Compact `email:ok webhook:fail` audit string for `last_status`. */
export function formatDeliveryStatus(result: ReportDeliveryResult): string {
  const parts = Object.entries(result.channels).map(
    ([channel, ok]) => `${channel}:${ok ? 'ok' : 'fail'}`
  )
  return parts.length > 0 ? parts.join(' ') : 'no-channels'
}
