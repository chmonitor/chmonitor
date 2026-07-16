/**
 * Telegram dispatch (transport layer).
 *
 * Builds the MarkdownV2 message body with the pure formatter
 * (`adapters/telegram.ts`) and POSTs it to the Telegram Bot API `sendMessage`
 * endpoint (`https://api.telegram.org/bot<token>/sendMessage`). The bot token
 * goes into the URL path (never the browser); this module is the only place
 * that actually talks to Telegram — mirrors the auth/transport separation
 * Opsgenie/PagerDuty document (the adapter stays network-free).
 *
 * The endpoint host is fixed (`api.telegram.org`) — only the token in the path
 * varies — so there is no caller-controlled SSRF sink here (unlike
 * `webhook.ts`, which fetches an arbitrary operator URL). Same reasoning as
 * `postPagerDutyEvent`, which likewise talks to a fixed endpoint without an
 * extra `validateHostUrl` guard.
 *
 * Never throws: a delivery failure must not abort the health sweep loop
 * (fail-open, matching `postWebhook` / `dispatchOpsgenie`).
 */

import type { AlertPayload } from './adapters/types'
import type { ServerTelegramConfig } from './server-alert-config'

import { buildTelegramBody } from './adapters/telegram'
import { error } from '@chm/logger'

/** Injectable dependencies (tests override fetch). */
export interface TelegramDispatchDeps {
  fetchImpl?: typeof fetch
}

/** Build the Bot API `sendMessage` URL for a token. */
export function telegramSendMessageUrl(botToken: string): string {
  return `https://api.telegram.org/bot${botToken}/sendMessage`
}

/**
 * Dispatch one alert to a Telegram chat: renders the payload as MarkdownV2 and
 * POSTs it to the bot's `sendMessage` endpoint. Returns whether the request
 * succeeded; never throws.
 */
export async function dispatchTelegram(
  payload: AlertPayload,
  config: ServerTelegramConfig,
  deps: TelegramDispatchDeps = {}
): Promise<boolean> {
  const doFetch = deps.fetchImpl ?? fetch
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)
  try {
    const body = buildTelegramBody(payload, {
      token: config.botToken,
      chatId: config.chatId,
    })
    const res = await doFetch(telegramSendMessageUrl(config.botToken), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      error(
        '[health] Telegram dispatch returned non-OK status',
        new Error(`Status ${res.status}`)
      )
    }
    return res.ok
  } catch (err) {
    error('[health] Telegram dispatch failed', err as Error)
    return false
  } finally {
    clearTimeout(timeout)
  }
}
