'use client'

/**
 * Full-page `/agents` experience.
 *
 * Layout:
 *   1. Conversation history — opened from the top-left "Conversations" button
 *      into a large centered dialog (assistant-ui `ThreadList`).
 *   2. Main column — welcome screen when empty, threaded messages otherwise.
 *   3. Agent-settings sidebar (host · model · MCP server · skills · prompts) —
 *      collapsible, open by default. Surfaces a "Show settings" affordance when
 *      closed.
 */

import { MessagesSquareIcon, PanelRightOpenIcon } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'

import { useEffect, useState } from 'react'
import { AgentSettingsSidebar } from '@/components/agents/welcome/agent-settings-sidebar'
import { AgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { AgentRuntimeProvider } from '@/components/assistant-ui/agent-runtime-provider'
import { Thread } from '@/components/assistant-ui/thread'
import { ThreadList } from '@/components/assistant-ui/thread-list'
import { useClerkFirstName as useClerkFirstNameImpl } from '@/components/assistant-ui/use-clerk-first-name'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useIsMobile } from '@/hooks/use-mobile'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { useHostId } from '@/lib/swr/use-host'
import { useHosts } from '@/lib/swr/use-hosts'

/**
 * Clerk's `useUser()` throws unless a `<ClerkProvider />` is mounted, and that
 * provider is only rendered when `isClerkEnabled()` is true (see
 * `components/clerk/clerk-auth-provider.tsx`). Gate the hook behind the same
 * build-time constant so the agents page never *calls* `useUser()` when Clerk is
 * disabled. `isClerkEnabled()` is a build-time constant, so the selected hook is
 * stable across renders (no conditional-hook violation). The import is inert; a
 * static ESM import replaces `require()`, undefined in the Vite/ESM runtime.
 */
const useClerkFirstName: () => string | null = isClerkEnabled()
  ? useClerkFirstNameImpl
  : () => null

function AgentThreadPageError() {
  return (
    <div className="bg-background flex h-[calc(100dvh-6rem)] flex-col items-center justify-center gap-2 rounded-xl border text-center">
      <p className="text-sm font-medium">The agent failed to load.</p>
      <p className="text-muted-foreground max-w-sm text-xs">
        Reload the page to try again. If this keeps happening, check that the
        LLM provider is configured.
      </p>
    </div>
  )
}

export function AgentThreadPage() {
  const isMobile = useIsMobile()
  const [conversationsOpen, setConversationsOpen] = useState(false)
  // Open by default so the 320px settings sidebar reserves its space on the
  // first paint (desktop). Starting closed and opening in a post-mount effect
  // animated the column from 0 → 320px on load, shifting the chat content
  // (~0.12 CLS). The effect below still closes it on mobile (which renders a
  // Drawer instead of the inline column, so no reflow there).
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  useEffect(() => {
    setRightSidebarOpen(!isMobile)
  }, [isMobile])
  const firstName = useClerkFirstName()
  const hostId = useHostId()
  const { hosts } = useHosts()
  const currentHost = hosts.find((h) => h.id === hostId)
  const clusterName = currentHost?.name ?? null

  return (
    <ErrorBoundary FallbackComponent={AgentThreadPageError}>
      <AgentAuthGate>
        <AgentRuntimeProvider>
          <div className="bg-background flex h-[calc(100dvh-6rem)] min-h-0 overflow-hidden rounded-xl border">
            {/* Conversation history — large centered dialog */}
            <Dialog
              open={conversationsOpen}
              onOpenChange={setConversationsOpen}
            >
              <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
                <DialogHeader className="border-b px-5 py-4">
                  <DialogTitle>Conversations</DialogTitle>
                  <DialogDescription>
                    Pick up a previous chat or start a new one.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="min-h-0 flex-1">
                  {/* Bubbling onClick closes the dialog AFTER assistant-ui's own
                      handler activates the selected (or new) thread. Items stay
                      independently keyboard-accessible. */}
                  <div
                    className="p-3"
                    onClick={() => setConversationsOpen(false)}
                  >
                    <ThreadList />
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>

            {/* Main column */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConversationsOpen(true)}
                className="absolute top-3 left-3 z-10 inline-flex h-8 gap-1.5 bg-background px-2.5 text-[11.5px] whitespace-nowrap shadow-sm dark:bg-background dark:hover:bg-muted"
              >
                <MessagesSquareIcon className="size-3.5" />
                Conversations
              </Button>
              {!rightSidebarOpen ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRightSidebarOpen(true)}
                  className="absolute top-3 right-3 z-10 h-8 gap-1.5 bg-background px-2.5 text-[11.5px] whitespace-nowrap shadow-sm dark:bg-background dark:hover:bg-muted"
                >
                  <PanelRightOpenIcon className="size-3.5" />
                  Agent settings
                </Button>
              ) : null}
              <Thread firstName={firstName} clusterName={clusterName} />
            </div>

            {/* Settings sidebar */}
            <AgentSettingsSidebar
              open={rightSidebarOpen}
              onClose={() => setRightSidebarOpen(false)}
              hostName={clusterName ?? 'default'}
            />
          </div>
        </AgentRuntimeProvider>
      </AgentAuthGate>
    </ErrorBoundary>
  )
}
