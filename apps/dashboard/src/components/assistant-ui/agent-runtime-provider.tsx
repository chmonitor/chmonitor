'use client'

/**
 * assistant-ui runtime for the ClickHouse agent.
 *
 * - `useChatRuntime` wraps the Vercel AI SDK backend at `/api/v1/agent`,
 *   carrying the custom request body (`hostId`, `model`, `disabledTools`,
 *   `sessionId`) the route expects.
 * - `useRemoteThreadListRuntime` layers persistent conversation history on top,
 *   backed by either D1 or localStorage (see `resolve-thread-list-adapter`).
 *
 * NOTE — dual-ai transport cast: `DefaultChatTransport` is from ai@7 (root).
 * `@assistant-ui/react-ai-sdk` still depends on `@ai-sdk/react@3` which bundles
 * ai@6 internally, so `UIMessageChunk` types diverge at the TypeScript level
 * (they're wire-compatible). The `as any` cast below is intentional until
 * @assistant-ui/react-ai-sdk ships a version targeting ai@7.
 */

import {
  AssistantRuntimeProvider,
  useRemoteThreadListRuntime,
} from '@assistant-ui/react'
import { useChatRuntime } from '@assistant-ui/react-ai-sdk'
import { DefaultChatTransport } from 'ai'
import { type ReactNode, useMemo, useRef } from 'react'
import { buildPageContext } from '@/lib/ai/agent/page-context'
import { trackEvent } from '@/lib/analytics/analytics'
import { resolveThreadListAdapter } from '@/lib/conversation-store/adapter/resolve-thread-list-adapter'
import { useAgentModel } from '@/lib/hooks/use-agent-model'
import { useMcpConfig } from '@/lib/hooks/use-mcp-config'
import { useToolConfig } from '@/lib/hooks/use-tool-config'
import { usePathname } from '@/lib/next-compat'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'

/**
 * Wraps apiFetch to fire the `agent_message` funnel event whenever the chat
 * transport sends a request to the agent route — i.e. whenever a message is
 * sent to the AI agent.
 */
function trackedAgentFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  trackEvent('agent_message')
  return apiFetch(input, init)
}

/**
 * Per-thread chat runtime. assistant-ui invokes this hook once per active
 * thread; it talks to the existing AI SDK v6 agent route.
 */
function useAgentChatRuntime() {
  const hostId = useHostId()
  const { disabledTools } = useToolConfig()
  const { model } = useAgentModel()
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const { customServers, disabledServers } = useMcpConfig()
  const pathname = usePathname()

  // Only pass enabled custom servers to the agent route. Derive from the stable
  // `customServers` + `disabledServers` arrays (not `isServerEnabled`, which is a
  // fresh closure each render) so this memo — and the transport below — stay
  // referentially stable across renders.
  const mcpServers = useMemo(
    () =>
      customServers
        .filter((s) => !disabledServers.includes(s.id))
        .map((s) => ({ id: s.id, name: s.name, endpoint: s.endpoint })),
    [customServers, disabledServers]
  )

  // Grounds an ambiguous question ("why is this slow?") in the page the user
  // was on when they sent it. Sent only on the first message of a thread, or
  // when the page changed since the last message that carried it — never on
  // every turn, so a long-running conversation doesn't keep re-asserting
  // stale page context after the user navigated away.
  const lastSentPathnameRef = useRef<string | null>(null)

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/v1/agent',
        fetch: trackedAgentFetch as typeof globalThis.fetch,
        body: { hostId, model, disabledTools, sessionId, mcpServers },
        prepareSendMessagesRequest: ({
          id,
          messages,
          body,
          trigger,
          messageId,
        }) => {
          const isNewThread = messages.length <= 1
          const pageChanged = lastSentPathnameRef.current !== pathname
          const shouldSendPageContext =
            Boolean(pathname) && (isNewThread || pageChanged)

          if (shouldSendPageContext) {
            lastSentPathnameRef.current = pathname
          }

          return {
            body: {
              ...body,
              id,
              messages,
              trigger,
              messageId,
              ...(shouldSendPageContext
                ? { pageContext: buildPageContext(pathname) }
                : {}),
            },
          }
        },
      }),
    // mcpServers is a derived array — include it directly so the transport
    // re-creates when the user toggles or adds custom servers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hostId, model, disabledTools, sessionId, mcpServers, pathname]
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return useChatRuntime({ transport: transport as any })
}

/**
 * Provides the agent runtime (chat + persistent thread list) to assistant-ui
 * components. Mounted once per surface — the full-page Thread and the global
 * floating modal each get an independent instance.
 */
export function AgentRuntimeProvider({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => resolveThreadListAdapter(), [])

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useAgentChatRuntime,
    adapter,
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  )
}
