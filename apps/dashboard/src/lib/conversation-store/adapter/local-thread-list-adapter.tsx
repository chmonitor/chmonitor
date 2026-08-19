'use client'

/**
 * localStorage-backed assistant-ui thread list adapter.
 *
 * The default conversation-history backend — used by self-hosted / Docker
 * deployments where the ClickHouse connection is read-only and no server-side
 * store is available. Persists the thread list and each thread's messages
 * entirely in the browser.
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

const PREFIX = 'clickhouse-agent:aui:'
const THREADS_KEY = `${PREFIX}threads`
const messagesKey = (remoteId: string) => `${PREFIX}messages:${remoteId}`

interface ThreadMeta {
  remoteId: string
  externalId?: string
  status: 'regular' | 'archived'
  title?: string
  createdAt?: number
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota exceeded / unavailable — fail silently, like the old store.
  }
}

function removeKey(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

const loadThreads = () => readJson<ThreadMeta[]>(THREADS_KEY, [])
const saveThreads = (threads: ThreadMeta[]) => writeJson(THREADS_KEY, threads)

/**
 * Per-thread message history. `useChatRuntime` calls `withFormat()` to obtain a
 * format-bound `GenericThreadHistoryAdapter`; the legacy `load` / `append` are
 * required by the type but unused on the AI SDK runtime.
 */
function createLocalHistoryAdapter(
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
      const readRepo = (remoteId: string) =>
        readJson<MessageFormatRepository<TMessage>>(messagesKey(remoteId), {
          messages: [],
        })

      return {
        async load() {
          const remoteId = aui.threadListItem.getState().remoteId
          if (!remoteId) return { messages: [] }
          return readRepo(remoteId)
        },
        async append(item) {
          const { remoteId } = await aui.threadListItem.initialize()
          const repo = readRepo(remoteId)
          upsertHistoryItem(repo, item, getId)
          writeJson(messagesKey(remoteId), repo)

          // Auto-title: derive from the first user message when the thread has
          // no title yet (or still has the default placeholder). Route through
          // the runtime's `rename()` so the thread-list UI updates immediately
          // (optimistic in-memory state) and the title is persisted via the
          // adapter's `rename()` below — no page reload required.
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
          const repo = readRepo(remoteId)
          replaceHistoryItem(repo, item, localMessageId, getId)
          writeJson(messagesKey(remoteId), repo)
        },
      }
    },
  }
}

const HistoryProvider: FC<PropsWithChildren> = ({ children }) => {
  const aui = useAui()
  const history = createLocalHistoryAdapter(aui)
  const adapters = { history }
  return (
    <RuntimeAdapterProvider adapters={adapters as never}>
      {children}
    </RuntimeAdapterProvider>
  )
}

/**
 * Build a `RemoteThreadListAdapter` that stores threads + messages in
 * `window.localStorage`.
 */
export function createLocalThreadListAdapter(): RemoteThreadListAdapter {
  return {
    unstable_Provider: HistoryProvider,

    async list() {
      return {
        threads: loadThreads().map((thread) => ({
          remoteId: thread.remoteId,
          externalId: thread.externalId,
          status: thread.status,
          title: thread.title,
          custom: thread.createdAt
            ? { createdAt: thread.createdAt }
            : undefined,
        })),
      }
    },

    async initialize(threadId) {
      const threads = loadThreads()
      if (!threads.some((thread) => thread.remoteId === threadId)) {
        threads.unshift({
          remoteId: threadId,
          status: 'regular',
          createdAt: Date.now(),
        })
        saveThreads(threads)
      }
      return { remoteId: threadId, externalId: undefined }
    },

    async rename(remoteId, newTitle) {
      const threads = loadThreads()
      const thread = threads.find((item) => item.remoteId === remoteId)
      if (thread) {
        thread.title = newTitle
        saveThreads(threads)
      }
    },

    async archive(remoteId) {
      const threads = loadThreads()
      const thread = threads.find((item) => item.remoteId === remoteId)
      if (thread) {
        thread.status = 'archived'
        saveThreads(threads)
      }
    },

    async unarchive(remoteId) {
      const threads = loadThreads()
      const thread = threads.find((item) => item.remoteId === remoteId)
      if (thread) {
        thread.status = 'regular'
        saveThreads(threads)
      }
    },

    async delete(remoteId) {
      saveThreads(loadThreads().filter((item) => item.remoteId !== remoteId))
      removeKey(messagesKey(remoteId))
    },

    async fetch(threadId) {
      const thread = loadThreads().find((item) => item.remoteId === threadId)
      if (!thread) throw new Error('Thread not found')
      return {
        remoteId: thread.remoteId,
        externalId: thread.externalId,
        status: thread.status,
        title: thread.title,
      }
    },

    async generateTitle(remoteId) {
      // Derive a title from the first user message in the stored conversation.
      // Stored entries may be either bare messages or `{ message }` wrappers
      // (the format-adapter repository shape), so normalize before reading.
      const repo = readJson<{ messages: unknown[] }>(messagesKey(remoteId), {
        messages: [],
      })
      const messages = repo.messages.map((entry) => {
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

      // Persist the generated title
      const threads = loadThreads()
      const thread = threads.find((item) => item.remoteId === remoteId)
      if (thread) {
        thread.title = title
        saveThreads(threads)
      }

      // Stream the title back so assistant-ui updates the thread list item
      return createAssistantStream((controller) => {
        controller.appendText(title)
      })
    },
  }
}
