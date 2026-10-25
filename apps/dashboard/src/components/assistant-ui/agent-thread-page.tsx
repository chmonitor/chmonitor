'use client'

/**
 * Full-page `/agents` experience.
 *
 * Layout (left → right):
 *   1. Conversation rail — persistent, collapsible history list (desktop inline
 *      column; mobile Drawer). One click switches threads.
 *   2. Main column — welcome screen when empty, threaded messages otherwise.
 *   3. Agent-settings sidebar (host · model · MCP server · skills · prompts) —
 *      collapsible, open by default. Surfaces a "Show settings" affordance when
 *      closed.
 */

import { PanelRightOpenIcon } from 'lucide-react'
import { ErrorBoundary } from 'react-error-boundary'

import { useCallback, useState } from 'react'
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
import { useStartAgentPrompt } from '@/components/assistant-ui/use-start-agent-prompt'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { useSidebar } from '@/components/ui/sidebar'
import { useIsMobile } from '@/hooks/use-mobile'
import { isClerkEnabled } from '@/lib/clerk/clerk-client'
import { useHostId } from '@/lib/swr/use-host'
import { useHosts } from '@/lib/swr/use-hosts'

/**
 * Clerk's `useUser()` throws unless a `<ClerkProvider />` is mounted, which only
 * happens when `isClerkEnabled()` is true. That is a build-time constant, so the
 * selected hook is stable across renders (no conditional-hook violation). A
 * static ESM import is used because `require()` is undefined in Vite/ESM.
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
  return (
    <ErrorBoundary FallbackComponent={AgentThreadPageError}>
      <AgentAuthGate>
        <AgentRuntimeProvider>
          <AgentChatLayout />
        </AgentRuntimeProvider>
      </AgentAuthGate>
    </ErrorBoundary>
  )
}

/**
 * `null` = no explicit choice yet: open on desktop, closed on a phone (where the
 * sidebar is a Drawer). Derived at render, not set from an effect, so a phone
 * never commits an open Drawer.
 */
export function useSettingsSidebarOpen(isMobile: boolean) {
  const [choice, setChoice] = useState<boolean | null>(null)
  return [choice ?? !isMobile, setChoice] as const
}

function AgentChatLayout() {
  const isMobile = useIsMobile()
  // Conversation rail: persistent inline column on desktop; a Drawer on mobile.
  // It starts folded on every viewport — the thread is the primary surface and
  // the rail is secondary navigation, so the chat column takes the full width on
  // first paint. The lazy-loading skeleton already sketches the rail-closed
  // layout, so nothing shifts when the real page replaces it.
  //
  // `railOpen` stays `null` ("no explicit choice yet") until the user toggles it
  // via the open/collapse button; from then on their choice sticks for the
  // session. `ConversationRail`'s `animate` prop only turns on once the user has
  // taken control, so the folded default never *animates* on load — only a
  // deliberate click slides the rail.
  const [railOpen, setRailOpen] = useState<boolean | null>(null)
  const effectiveRailOpen = railOpen ?? false
  const [mobileConvOpen, setMobileConvOpen] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] =
    useSettingsSidebarOpen(isMobile)
  const { setOpen: setNavOpen, setOpenMobile: setNavOpenMobile } = useSidebar()
  const collapseChrome = useCallback(() => {
    setRailOpen(false)
    setRightSidebarOpen(false)
    setMobileConvOpen(false)
    setNavOpen(false)
    setNavOpenMobile(false)
  }, [setNavOpen, setNavOpenMobile, setRightSidebarOpen])
  const pickPrompt = useStartAgentPrompt(collapseChrome)
  const firstName = useClerkFirstName()
  const hostId = useHostId()
  const { hosts } = useHosts()
  const currentHost = hosts.find((h) => h.id === hostId)
  const clusterName = currentHost?.name ?? null

  return (
    <div className="bg-background flex h-[calc(100dvh-6rem)] min-h-0 overflow-hidden rounded-xl border">
      {!isMobile && (
        <ConversationRail
          open={effectiveRailOpen}
          animate={railOpen !== null}
          onCollapse={() => setRailOpen(false)}
        />
      )}

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

      <div className="relative flex min-w-0 flex-1 flex-col">
        {(isMobile || !effectiveRailOpen) && (
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
        <Thread
          firstName={firstName}
          clusterName={clusterName}
          onPickPrompt={pickPrompt}
        />
      </div>

      <AgentSettingsSidebar
        open={rightSidebarOpen}
        onClose={() => setRightSidebarOpen(false)}
        hostName={clusterName ?? 'default'}
        onPickPrompt={pickPrompt}
      />
    </div>
  )
}
