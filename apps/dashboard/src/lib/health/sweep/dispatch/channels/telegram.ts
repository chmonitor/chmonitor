/**
 * Telegram chat targets (#2655), extracted verbatim in #2938.
 */

import type { AlertPayload } from './../../../adapters'
import type { TelegramTarget } from './../../../alert-routing'
import type { FindingContext } from './../finding-context'

import { buildChannelPayload } from './../finding-context'

/** One resolved chat plus the payload this finding contributes to it. */
export interface TelegramChannelEntry {
  botToken: string
  chatId: string
  payload: AlertPayload
}

/**
 * Telegram (#2655) is digest-capable (#2663): instead of sending inline, this
 * "dispatch" collects one entry per resolved chat and lets the grouped flush
 * (`./../digest.ts`) send a single (combined when >1 finding) MarkdownV2
 * message per chat. Severity is mapped once for this finding's payload.
 */
export function dispatchTelegramChannel(
  finding: FindingContext,
  telegramTargets: TelegramTarget[]
): TelegramChannelEntry[] {
  const telegramPayload = buildChannelPayload(finding)
  return telegramTargets.map((t) => ({
    botToken: t.botToken,
    chatId: t.chatId,
    payload: telegramPayload,
  }))
}
