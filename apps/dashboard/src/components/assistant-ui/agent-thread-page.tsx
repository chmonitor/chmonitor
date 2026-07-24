'use client'

/**
 * Full-page `/agents` experience.
 *
 * Layout (left → right):
 *   1. Conversation rail — persistent, collapsible history list (desktop inline
 *      column; mobile Drawer). One click switches threads. Replaces the old
 *      centered "Conversations" dialog (issue #2802).
 *   2. Main column — welcome screen when empty, threaded messages otherwise.
 *   3. Agent-settings sidebar (host · model · MCP server · skills · prompts) —
 *      collapsible, open by default. Surfaces a "Show settings" affordance when
 *      closed.
 */

import { PanelRightOpenIcon } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'

import { useEffect, useState } from 'react'
import { AgentSettingsSidebar } from '@/components/agents/welcome/agent-settings-sidebar'
import { AgentAuthGate } from '@/components/assistant-ui/agent-auth-gate'
import { AgentRuntimeProvider } from '@/components/assistant-ui/agent-runtime-provider'
import {
  ConversationRail,
  ConversationRailBody,
  ConversationRailOpenButton,
} from '@/components/assistant-ui/conversation-rail'
import { Thread } from '@/components/assistant-ui/thread'
import { useClerkFirstName as useClerkFirstNameImpl } from '@/components/assistant-ui/use-clerk-first-name'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
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
  // Conversation rail: persistent inline column on desktop (open by default so
  // its width is reserved on first paint, no CLS); a Drawer on mobile.
  const [railOpen, setRailOpen] = useState(true)
  const [mobileConvOpen, setMobileConvOpen] = useState(false)
  // Settings sidebar (open by default on desktop; Drawer on mobile).
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true)
  useEffect(() => {
    setRailOpen(!isMobile)
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
            {/* Conversation rail — persistent left column (desktop). */}
            {!isMobile && (
              <ConversationRail
                open={railOpen}
                onCollapse={() => setRailOpen(false)}
              />
            )}

            {/* Conversation history — mobile Drawer. */}
            {isMobile && (
              <Drawer open={mobileConvOpen} onOpenChange={setMobileConvOpen}>
                <DrawerContent className="max-h-[85dvh]">
                  <DrawerHeader className="sr-only">
                    <DrawerTitle>Conversations</DrawerTitle>
                    <DrawerDescription>
                      Pick up a previous chat or start a new one.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="h-[70dvh] min-h-0">
                    <ConversationRailBody
                      showCollapse={false}
                      onNavigate={() => setMobileConvOpen(false)}
                    />
                  </div>
                </DrawerContent>
              </Drawer>
            )}

            {/* Main column */}
            <div className="relative flex min-w-0 flex-1 flex-col">
              {(isMobile || !railOpen) && (
                <ConversationRailOpenButton
                  onClick={() =>
                    isMobile ? setMobileConvOpen(true) : setRailOpen(true)
                  }
                  className="absolute top-3 left-3 z-10"
                />
              )}
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
