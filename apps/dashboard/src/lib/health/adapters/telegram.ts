/**
 * Telegram notification adapter (pure formatter).
 *
 * Builds the JSON body for the Telegram Bot API `sendMessage` endpoint
 * (`https://api.telegram.org/bot<token>/sendMessage`). The message text uses
 * MarkdownV2, which requires a strict set of characters to be backslash-escaped
 * — see {@link escapeMarkdownV2}.
 *
 * The `token` and `chat_id` come from caller configuration; this module only
 * shapes `text` and returns the request body given those values.
 */

import type { AlertPayload, AlertSeverity, NotificationAdapter } from './types'

import { summarizeDigest } from './digest'

/** Characters MarkdownV2 reserves and requires escaping with a backslash. */
const MARKDOWN_V2_SPECIALS = '_*[]()~`>#+-=|{}.!'

/**
 * Escape a string for Telegram MarkdownV2.
 *
 * Every reserved character (`_*[]()~\`>#+-=|{}.!`) is prefixed with a backslash
 * so it renders literally rather than as formatting. Applied to all interpolated
 * user/host/metric values.
 */
export function escapeMarkdownV2(text: string): string {
  let out = ''
  for (const ch of text) {
    if (MARKDOWN_V2_SPECIALS.includes(ch)) out += '\\'
    out += ch
  }
  return out
}

/** Severity → emoji used in the message header. */
const SEVERITY_EMOJI: Record<AlertSeverity, string> = {
  critical: '🔴',
  warning: '🟠',
  recovery: '🟢',
}

/** Body shape for Telegram Bot API `sendMessage`. */
export interface TelegramSendMessageBody {
  chat_id: string
  text: string
  parse_mode: 'MarkdownV2'
}

/** Caller-supplied Telegram transport config. */
export interface TelegramConfig {
  /** Bot token (goes into the URL, not the body — kept here for the caller). */
  token?: string
  /** Target chat id. */
  chatId: string
}

function esc(value: string | number): string {
  return escapeMarkdownV2(String(value))
}

/**
 * Build the MarkdownV2 message text for a payload. Exported so tests (and the
 * dispatch layer) can assert the rendered text independent of the body wrapper.
 */
export function buildTelegramText(payload: AlertPayload): string {
  const emoji = SEVERITY_EMOJI[payload.severity]
  const heading =
    payload.severity === 'recovery'
      ? 'RECOVERY'
      : payload.severity.toUpperCase()

  const lines: string[] = [
    `${emoji} *${esc(heading)}: ${esc(payload.title)}*`,
    '',
    `*Host:* ${esc(payload.hostLabel)} \\(id ${esc(payload.hostId)}\\)`,
    `*Metric:* ${esc(payload.metric)}`,
    `*Value:* ${esc(payload.value === null ? 'n/a' : payload.value)}`,
  ]

  const thresholds: string[] = []
  if (payload.warnThreshold !== undefined && payload.warnThreshold !== null) {
    thresholds.push(`warn ${esc(payload.warnThreshold)}`)
  }
  if (payload.critThreshold !== undefined && payload.critThreshold !== null) {
    thresholds.push(`crit ${esc(payload.critThreshold)}`)
  }
  if (thresholds.length > 0) {
    lines.push(`*Thresholds:* ${thresholds.join(' \\| ')}`)
  }

  lines.push(`*Detail:* ${esc(payload.label)}`)

  if (payload.runbookUrls && payload.runbookUrls.length > 0) {
    lines.push('')
    lines.push('*Runbooks:*')
    for (const url of payload.runbookUrls) {
      lines.push(`• ${esc(url)}`)
    }
  }

  lines.push('')
  lines.push(`_${esc(payload.timestamp)}_`)

  return lines.join('\n')
}

/**
 * Build the Telegram `sendMessage` request body for a payload and chat id.
 */
export function buildTelegramBody(
  payload: AlertPayload,
  config: TelegramConfig
): TelegramSendMessageBody {
  return {
    chat_id: config.chatId,
    text: buildTelegramText(payload),
    parse_mode: 'MarkdownV2',
  }
}

/**
 * Build the MarkdownV2 text for a GROUP of findings bound for the same chat
 * (feat #2663): a bold summary heading + one bullet per finding (capped, with a
 * "…and N more" overflow line). Every interpolated value is escaped.
 */
export function buildTelegramDigestText(
  payloads: readonly AlertPayload[]
): string {
  const digest = summarizeDigest(payloads)
  const emoji = SEVERITY_EMOJI[digest.topSeverity]

  const lines: string[] = [
    `${emoji} *${esc('Health digest')}: ${esc(digest.summaryLine)}*`,
    '',
  ]
  for (const line of digest.findingLines) {
    lines.push(`• ${esc(line)}`)
  }
  if (digest.overflow > 0) {
    lines.push(esc(`…and ${digest.overflow} more`))
  }
  return lines.join('\n')
}

/** Build the Telegram `sendMessage` body for a group of findings and chat id. */
export function buildTelegramDigestBody(
  payloads: readonly AlertPayload[],
  config: TelegramConfig
): TelegramSendMessageBody {
  return {
    chat_id: config.chatId,
    text: buildTelegramDigestText(payloads),
    parse_mode: 'MarkdownV2',
  }
}

/**
 * Telegram adapter. `buildBody` uses a placeholder chat id — the dispatch layer
 * substitutes the real `chat_id`/token from config; use {@link buildTelegramBody}
 * directly when the config is available.
 */
export const telegramAdapter: NotificationAdapter = {
  id: 'telegram',
  detect: (url: string) => /(?:^|\/\/)api\.telegram\.org\//i.test(url),
  buildBody: (payload: AlertPayload) =>
    buildTelegramBody(payload, { chatId: '<chat_id>' }),
}
