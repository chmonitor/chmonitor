'use client'

/**
 * `/agents/settings` — full-page home for everything agent-related: LLM
 * provider status, model selection, the system prompt, skills, and external
 * MCP server registrations.
 *
 * Replaces the standalone `/mcp-servers` page (its `McpServerManager` content
 * now lives in the "MCP Servers" tab here) and complements the compact
 * "Agent settings" side panel on the chat page (`/agents`) — that panel stays
 * for quick in-conversation tweaks; this page is the fuller settings surface
 * it links out to.
 */

import {
  CpuIcon,
  PlugZapIcon,
  ScrollTextIcon,
  SparklesIcon,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'

import { McpSettingsTab } from './mcp-settings-tab'
import { ProviderModelsTab } from './provider-models-tab'
import { SkillsTab } from './skills-tab'
import { SystemPromptTab } from './system-prompt-tab'
import { useCallback, useMemo } from 'react'
import { PageHeader } from '@/components/layout/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUrlSearchParams } from '@/hooks/use-url-search-params'
import { splitHref } from '@/lib/url/url-builder'

const TAB_IDS = ['provider', 'system-prompt', 'skills', 'mcp'] as const
type TabId = (typeof TAB_IDS)[number]

const DEFAULT_TAB: TabId = 'provider'

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value)
}

export function AgentSettingsPage() {
  const searchParams = useUrlSearchParams()
  const navigate = useNavigate()

  const tab = useMemo(() => {
    const raw = searchParams.get('tab')
    return isTabId(raw) ? raw : DEFAULT_TAB
  }, [searchParams])

  // Merge into the existing query string (not a bare `?tab=` href) so other
  // params — `host`, if ever present — survive the navigation. Mirrors
  // `useExplorerState`'s `updateParams` (`use-explorer-state.ts`).
  const setTab = useCallback(
    (value: string) => {
      if (value === tab) return
      const params = new URLSearchParams(searchParams.toString())
      params.set('tab', value)
      navigate({
        ...splitHref(`/agents/settings?${params.toString()}`),
        replace: true,
      })
    },
    [tab, searchParams, navigate]
  )

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <PageHeader
        title="Agent settings"
        description="Provider, model, system prompt, skills, and MCP servers for the AI Agent."
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="provider" className="gap-1.5">
            <CpuIcon className="size-3.5" />
            Provider &amp; Models
          </TabsTrigger>
          <TabsTrigger value="system-prompt" className="gap-1.5">
            <ScrollTextIcon className="size-3.5" />
            System prompt
          </TabsTrigger>
          <TabsTrigger value="skills" className="gap-1.5">
            <SparklesIcon className="size-3.5" />
            Skills
          </TabsTrigger>
          <TabsTrigger value="mcp" className="gap-1.5">
            <PlugZapIcon className="size-3.5" />
            MCP servers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="provider" className="mt-4">
          <ProviderModelsTab />
        </TabsContent>
        <TabsContent value="system-prompt" className="mt-4">
          <SystemPromptTab />
        </TabsContent>
        <TabsContent value="skills" className="mt-4">
          <SkillsTab />
        </TabsContent>
        <TabsContent value="mcp" className="mt-4">
          <McpSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
