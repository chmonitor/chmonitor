/**
 * Thread repeats under an episode's first message (#4049), for the channels
 * whose send API returns a message id and accepts a reply to it: native Matrix
 * (`m.thread` on the root event id) and Telegram (`reply_parameters`).
 *
 * Only a LONE send (one finding for that destination this pass) takes part. A
 * digest of several findings stays top-level and starts no thread. Roots live
 * in `alert-thread-store`; with no metadata DB nothing is stored and every
 * message goes out top-level, as before.
 */

import type { AlertDecisionKind } from './../../alert-state-store'

import {
  deleteThreadRoot,
  loadThreadRoots,
  saveThreadRoot,
} from './../../alert-thread-store'
import { SWEEP_ROUTING_OWNER_ID } from './../resolve-config'

export interface EpisodeThreads {
  /** The episode's root message id on this destination, if one is stored. */
  rootFor: (threadKey: string) => string | undefined
  /** Update the stored root after a lone send of a finding of `kind`. */
  afterLoneSend: (params: {
    threadKey: string
    kind: AlertDecisionKind
    ok: boolean
    messageId: string | undefined
  }) => Promise<void>
  /** A digest send carried this finding: it ends or starts no thread. */
  afterDigestSend: (params: {
    threadKey: string
    kind: AlertDecisionKind
    ok: boolean
  }) => Promise<void>
}

/** Load every stored root once for this flush. */
export async function loadEpisodeThreads(): Promise<EpisodeThreads> {
  const roots = await loadThreadRoots(SWEEP_ROUTING_OWNER_ID)

  const forget = async (threadKey: string) => {
    if (!roots.delete(threadKey)) return
    await deleteThreadRoot(SWEEP_ROUTING_OWNER_ID, threadKey)
  }

  return {
    rootFor: (threadKey) => roots.get(threadKey),

    async afterLoneSend({ threadKey, kind, ok, messageId }) {
      if (!ok) return
      if (kind === 'recovery') {
        await forget(threadKey)
        return
      }
      if (!messageId) return
      if (kind === 'new') {
        // A new episode always replaces a leftover root: a recovery that was
        // never sent (muted, signal-only) leaves the old one behind.
        roots.set(threadKey, messageId)
        await saveThreadRoot(SWEEP_ROUTING_OWNER_ID, threadKey, messageId, {
          replace: true,
        })
        return
      }
      if (
        (kind === 'reminder' || kind === 'escalated') &&
        !roots.has(threadKey)
      ) {
        // The first message was not threadable (a digest, or sent before
        // threading existed): this one becomes the root.
        roots.set(threadKey, messageId)
        await saveThreadRoot(SWEEP_ROUTING_OWNER_ID, threadKey, messageId, {
          replace: false,
        })
      }
    },

    async afterDigestSend({ threadKey, kind, ok }) {
      if (!ok) return
      // The episode ended, or a new one began inside a digest: either way the
      // old root no longer belongs to the current episode.
      if (kind === 'recovery' || kind === 'new') await forget(threadKey)
    },
  }
}

/** Matrix content replying in the thread of `rootEventId`. */
export function withMatrixThread<T extends object>(
  content: T,
  rootEventId: string | undefined
): T {
  if (!rootEventId) return content
  return {
    ...content,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootEventId,
      // Clients without thread support show it as a plain reply to the root.
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootEventId },
    },
  }
}

/** Telegram `sendMessage` body replying to `rootMessageId`. */
export function withTelegramReply<T extends object>(
  body: T,
  rootMessageId: string | undefined
): T {
  const messageId = Number(rootMessageId)
  if (!rootMessageId || !Number.isSafeInteger(messageId)) return body
  return {
    ...body,
    reply_parameters: {
      message_id: messageId,
      allow_sending_without_reply: true,
    },
  }
}

/** `result.message_id` from a Telegram `sendMessage` response. */
export function telegramMessageId(json: unknown): string | undefined {
  const id = (json as { result?: { message_id?: unknown } } | undefined)?.result
    ?.message_id
  return typeof id === 'number' ? String(id) : undefined
}
