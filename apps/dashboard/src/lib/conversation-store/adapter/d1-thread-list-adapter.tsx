'use client'

/**
 * D1 / server-backed assistant-ui thread list adapter.
 *
 * Used when `VITE_FEATURE_CONVERSATION_DB` is enabled (Cloudflare
 * Workers deployments). Persists threads + messages through the existing
 * `/api/v1/conversations/*` routes, which resolve to D1 / Postgres server-side.
 *
 * Implements the same `RemoteThreadListAdapter` contract as the localStorage
 * backend so the two are interchangeable behind `resolve-thread-list-adapter`.
 */

import type {
  GenericThreadHistoryAdapter,
  MessageFormatAdapter,
  MessageFormatRepository,
  RemoteThreadListAdapter,
  ThreadHistoryAdapter,
} from '@assistant-ui/react'
import type { FC, PropsWithChildren } from 'react'

import { RuntimeAdapterProvider, useAui } from '@assistant-ui/react'
import { createAssistantStream } from 'assistant-stream'
import {
  deriveTitleFromUserMessage,
  isUntitledThread,
  type TitleSourceMessage,
} from '@/lib/ai/agent/conversation-utils'
import {
  replaceHistoryItem,
  upsertHistoryItem,
} from '@/lib/conversation-store/adapter/generic-history'
import { apiFetch } from '@/lib/swr/api-fetch'

const BASE = '/api/v1/conversations'

/**
 * In-memory cache so per-turn `append()` calls do not refetch every time.
 * Bounded to REPO_CACHE_MAX entries — evicts the oldest when full.
 */
const REPO_CACHE_MAX = 50
const repoCache = new Map<string, MessageFormatRepository<unknown>>()

function setRepoCache(
  key: string,
  value: MessageFormatRepository<unknown>
): void {
  if (repoCache.size >= REPO_CACHE_MAX && !repoCache.has(key)) {
    // Evict oldest entry (first inserted key).
    const oldest = repoCache.keys().next().value
    if (oldest !== undefined) repoCache.delete(oldest)
  }
  repoCache.set(key, value)
}

function unwrap(json: unknown): Record<string, unknown> {
  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    if (record.data && typeof record.data === 'object') {
      return record.data as Record<string, unknown>
    }
    return record
  }
  return {}
}

async function apiList(): Promise<Array<Record<string, unknown>>> {
  try {
    const res = await apiFetch(`${BASE}?limit=100`)
    if (!res.ok) return []
    const body = unwrap(await res.json().catch(() => ({})))
    const conversations = body.conversations ?? body
    return Array.isArray(conversations)
      ? (conversations as Array<Record<string, unknown>>)
      : []
  } catch {
    return []
  }
}

async function apiGet(id: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await apiFetch(`${BASE}/${encodeURIComponent(id)}`)
    if (!res.ok) return null
    const body = unwrap(await res.json().catch(() => ({})))
    return (body.conversation as Record<string, unknown> | undefined) ?? null
  } catch {
    return null
  }
}

async function apiPut(
  id: string,
  payload: { title?: string; messages?: unknown[] }
): Promise<void> {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(
      `Conversation persist failed (${res.status}): ${await res.text().catch(() => 'unknown')}`
    )
  }
}

async function apiDelete(id: string): Promise<void> {
  try {
    const res = await apiFetch(`${BASE}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      throw new Error(`DELETE failed with status ${res.status}`)
    }
  } catch {
    // ignore — deletion is best-effort
  }
}

/**
 * Per-thread message history backed by the conversations API. `useChatRuntime`
 * calls `withFormat()` for a format-bound `GenericThreadHistoryAdapter`; the
 * stored `MessageFormatItem[]` is kept in the conversation's `messages` field.
 */
function createD1HistoryAdapter(
  aui: ReturnType<typeof useAui>
): ThreadHistoryAdapter {
  return {
    async load() {
      return { messages: [] }
    },
    async append() {},
    withFormat<TMessage, TStorageFormat extends Record<string, unknown>>(
      formatAdapter: MessageFormatAdapter<TMessage, TStorageFormat>
    ): GenericThreadHistoryAdapter<TMessage> {
      const getId = (message: TMessage) => formatAdapter.getId(message)
      const getCachedRepo = (
        remoteId: string
      ): MessageFormatRepository<TMessage> =>
        (repoCache.get(remoteId) as
          | MessageFormatRepository<TMessage>
          | undefined) ?? { messages: [] }

      return {
        async load() {
          const remoteId = aui.threadListItem.getState().remoteId
          if (!remoteId) return { messages: [] }
          const conversation = await apiGet(remoteId)
          const stored = conversation?.messages
          const messages = Array.isArray(stored)
            ? (stored as MessageFormatRepository<TMessage>['messages'])
            : []
          const repo: MessageFormatRepository<TMessage> = {
            messages,
            headId: messages.length
              ? getId(messages[messages.length - 1].message)
              : undefined,
          }
          setRepoCache(remoteId, repo)
          return repo
        },
        async append(item) {
          const { remoteId } = await aui.threadListItem.initialize()
          const repo = getCachedRepo(remoteId)
          upsertHistoryItem(repo, item, getId)
          setRepoCache(remoteId, repo)

          await apiPut(remoteId, { messages: repo.messages })

          // Auto-title: derive from the first user message when the thread has
          // no title yet (or still has the default placeholder). Route through
          // the runtime's `rename()` so the thread-list UI updates immediately
          // (optimistic in-memory state) and the title is persisted via the
          // adapter's `rename()` (server-side `apiPut({ title })`).
          if (isUntitledThread(aui.threadListItem.getState().title)) {
            const title = deriveTitleFromUserMessage(
              item.message as TitleSourceMessage
            )
            if (title) {
              await aui.threadListItem.rename(title)
            }
          }
        },
        async update(item, localMessageId) {
          const remoteId = aui.threadListItem.getState().remoteId
          if (!remoteId) return
          const repo = getCachedRepo(remoteId)
          replaceHistoryItem(repo, item, localMessageId, getId)
          setRepoCache(remoteId, repo)
          await apiPut(remoteId, { messages: repo.messages })
        },
      }
    },
  }
}

const HistoryProvider: FC<PropsWithChildren> = ({ children }) => {
  const aui = useAui()
  const history = createD1HistoryAdapter(aui)
  const adapters = { history }
  return (
    <RuntimeAdapterProvider adapters={adapters as never}>
      {children}
    </RuntimeAdapterProvider>
  )
}

/**
 * Build a `RemoteThreadListAdapter` backed by the D1 conversations API.
 */
export function createD1ThreadListAdapter(): RemoteThreadListAdapter {
  return {
    unstable_Provider: HistoryProvider,

    async list() {
      const conversations = await apiList()
      return {
        threads: conversations
          .filter((conversation) => typeof conversation.id === 'string')
          .map((conversation) => ({
            remoteId: conversation.id as string,
            externalId: undefined,
            status: 'regular' as const,
            title:
              typeof conversation.title === 'string'
                ? conversation.title
                : undefined,
            custom:
              typeof conversation.createdAt === 'number'
                ? { createdAt: conversation.createdAt }
                : undefined,
          })),
      }
    },

    async initialize(threadId) {
      await apiPut(threadId, { messages: [] })
      repoCache.set(threadId, { messages: [] })
      return { remoteId: threadId, externalId: undefined }
    },

    async rename(remoteId, newTitle) {
      await apiPut(remoteId, { title: newTitle })
    },

    async archive() {
      // The conversations API has no archive state — treated as a no-op.
    },

    async unarchive() {
      // No-op — see `archive`.
    },

    async delete(remoteId) {
      repoCache.delete(remoteId)
      await apiDelete(remoteId)
    },

    async fetch(threadId) {
      const conversation = await apiGet(threadId)
      return {
        remoteId: threadId,
        externalId: undefined,
        status: 'regular',
        title:
          conversation && typeof conversation.title === 'string'
            ? conversation.title
            : undefined,
      }
    },

    async generateTitle(remoteId) {
      const conversation = await apiGet(remoteId)
      const stored = Array.isArray(conversation?.messages)
        ? (conversation.messages as unknown[])
        : []
      // Stored entries may be bare messages or `{ message }` wrappers
      // (the format-adapter repository shape), so normalize before reading.
      const messages = stored.map((entry) => {
        const candidate =
          entry &&
          typeof entry === 'object' &&
          'message' in (entry as Record<string, unknown>)
            ? (entry as { message: unknown }).message
            : entry
        return candidate as TitleSourceMessage
      })
      const firstUserMsg = messages.find((m) => m?.role === 'user')
      const title = deriveTitleFromUserMessage(firstUserMsg) ?? 'New Chat'

      // Persist the title server-side
      await apiPut(remoteId, { title })

      return createAssistantStream((controller) => {
        controller.appendText(title)
      })
    },
  }
}
