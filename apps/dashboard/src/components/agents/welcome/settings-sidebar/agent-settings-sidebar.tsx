'use client'

/**
 * Right-hand "Agent settings" sidebar for the AI Agent page.
 *
 * Structure (top to bottom):
 *  - Header: title + "Full settings" link + close button (one row).
 *  - Connection — a static, always-visible primary block: Host, Model, and
 *    Conversation History. These are the controls that matter most, so they
 *    never collapse.
 *  - Daily AI usage — compact progress meter (cloud-only; renders nothing on
 *    OSS / unlimited plans).
 *  - MCP Servers, Skills, Suggested prompts — collapsible sections (chevron
 *    header, default open) so returning users can fold away what they don't
 *    need without losing any control or entry point.
 *
 * On desktop the sidebar is an inline collapsible column; on mobile
 * (< 768px) it slides up as a shadcn Drawer so the chat column stays usable
 * on small screens.
 */

import {
  ArrowRightIcon,
  LightbulbIcon,
  PanelRightCloseIcon,
  PlugZapIcon,
  SparklesIcon,
} from 'lucide-react'

import type { Skill } from '@/components/agents/welcome/skills-data'

import { AiUsagePanel } from './ai-usage-panel'
import { CollapsibleSidebarSection } from './collapsible-sidebar-section'
import { ConnectionSummary } from './connection-summary'
import { useEffect, useState } from 'react'
import { AgentMcpPanel } from '@/components/agents/welcome/agent-mcp-panel'
import { McpConnectAgentDialog } from '@/components/agents/welcome/mcp-connect-agent-dialog'
import { SkillDetailDialog } from '@/components/agents/welcome/skill-detail-dialog'
import { SkillsLibraryDialog } from '@/components/agents/welcome/skills-library-dialog'
import { SuggestedPrompts } from '@/components/agents/welcome/suggested-prompts-view'
import { AppLink } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Switch } from '@/components/ui/switch'
import { useIsMobile } from '@/hooks/use-mobile'
import { useAgentSkills } from '@/lib/hooks/use-agent-skills'
import { cn } from '@/lib/utils'

interface AgentSettingsSidebarProps {
  open: boolean
  onClose: () => void
  hostName: string
  onPickPrompt?: (prompt: string) => void
  onOpenSkillsLibrary?: () => void
}

export function AgentSettingsSidebar({
  open,
  onClose,
  hostName,
  onPickPrompt,
  onOpenSkillsLibrary,
}: AgentSettingsSidebarProps) {
  const isMobile = useIsMobile()
  const {
    skills,
    isSkillEnabled,
    toggleSkill,
    activeSkillCount,
    totalSkillCount,
  } = useAgentSkills()
  const topSkills = skills.slice(0, 3)
  const [skillDetail, setSkillDetail] = useState<Skill | null>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)

  // The parent opens this sidebar via a post-mount effect (`!isMobile`), so the
  // very first commit on desktop transitions `open` false → true. Animating the
  // width (`w-0` → `w-[320px]`) on that initial open reflows the chat column on
  // every frame → ~0.12 CLS. Enable the width transition only AFTER first paint
  // so the load-time open snaps to full width (space reserved instantly); later
  // user toggles still animate.
  const [animateOpen, setAnimateOpen] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimateOpen(true))
    return () => cancelAnimationFrame(id)
  }, [])

  const sections = (
    <>
      {/* CONNECTION — primary block, always visible */}
      <ConnectionSummary hostName={hostName} />

      {/* DAILY AI USAGE (cloud-only; renders nothing on OSS / unlimited) */}
      <AiUsagePanel />

      {/* MCP SERVERS — no header count badge: `useMcpConfig`'s toggle state is
          per-hook-instance `useState` (localStorage-backed, no cross-instance
          broadcast), so a second instance here would go stale against the one
          inside `AgentMcpPanel`. The panel's own summary row is the source of
          truth. */}
      <CollapsibleSidebarSection label="MCP servers" icon={PlugZapIcon}>
        <AgentMcpPanel />
        {/* For users who run their own agent/IDE and want to point it at this
            cluster's MCP endpoint directly. */}
        <button
          type="button"
          onClick={() => setConnectOpen(true)}
          className="text-muted-foreground hover:text-foreground hover:bg-muted/40 mt-1.5 flex w-full items-center gap-2 rounded-md border border-dashed px-3 py-2 text-left text-[11.5px] transition-colors"
        >
          <PlugZapIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="text-foreground font-medium">
              Connect your own agent
            </span>
            <span className="block text-[10.5px]">
              Use this cluster&apos;s MCP endpoint in your IDE or tooling
            </span>
          </span>
          <ArrowRightIcon className="size-3 shrink-0" />
        </button>
      </CollapsibleSidebarSection>

      {/* SKILLS */}
      <CollapsibleSidebarSection
        label="Skills"
        icon={SparklesIcon}
        right={
          <span className="text-muted-foreground text-[10px] tabular-nums">
            <span className="text-foreground font-medium">
              {activeSkillCount}
            </span>
            /{totalSkillCount} on
          </span>
        }
      >
        <div className="border-border divide-border divide-y rounded-md border">
          {topSkills.map((skill) => {
            const Icon = skill.icon
            const on = isSkillEnabled(skill.id)
            return (
              <div
                key={skill.id}
                className="flex items-center gap-2 py-2 pr-3 pl-2"
              >
                <button
                  type="button"
                  onClick={() => setSkillDetail(skill)}
                  className="hover:bg-muted/40 flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left"
                >
                  <div className="bg-muted text-muted-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-3" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-medium">
                      {skill.name}
                    </div>
                    <div className="text-muted-foreground text-[10px] tabular-nums">
                      {skill.tools.length} tools · {skill.source}
                    </div>
                  </div>
                </button>
                <Switch
                  checked={on}
                  onCheckedChange={() => toggleSkill(skill.id)}
                  className="shrink-0"
                  aria-label={`Toggle ${skill.name}`}
                />
              </div>
            )
          })}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onOpenSkillsLibrary ?? (() => setLibraryOpen(true))}
          className="mt-1.5 h-8 w-full justify-center gap-1.5 text-[11.5px]"
        >
          <SparklesIcon className="size-3" />
          Skill library
          <span className="text-muted-foreground tabular-nums">
            ({totalSkillCount})
          </span>
          <ArrowRightIcon className="text-muted-foreground size-2.5" />
        </Button>
      </CollapsibleSidebarSection>

      {/* SUGGESTED PROMPTS */}
      <CollapsibleSidebarSection label="Suggested prompts" icon={LightbulbIcon}>
        <SuggestedPrompts
          variant="list"
          limit={3}
          collapsible
          onPickPrompt={onPickPrompt}
        />
      </CollapsibleSidebarSection>

      <SkillDetailDialog
        skill={skillDetail}
        open={skillDetail !== null}
        onOpenChange={(next) => {
          if (!next) setSkillDetail(null)
        }}
        isEnabled={skillDetail ? isSkillEnabled(skillDetail.id) : false}
        onToggle={(id) => toggleSkill(id)}
      />

      <SkillsLibraryDialog open={libraryOpen} onOpenChange={setLibraryOpen} />

      <McpConnectAgentDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  )

  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DrawerContent className="max-h-[85dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="text-[14px]">Agent settings</DrawerTitle>
            <DrawerDescription className="text-[11.5px]">
              Host, model, tools, and skills.
            </DrawerDescription>
            <AppLink
              href="/agents/settings"
              className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-[11px] underline underline-offset-2"
            >
              Open full agent settings
              <ArrowRightIcon className="size-2.5" />
            </AppLink>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">{sections}</div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <aside
      className={cn(
        'bg-card border-border shrink-0 overflow-x-hidden overflow-y-auto border-l',
        animateOpen && 'transition-all duration-200',
        open ? 'w-[320px] opacity-100' : 'pointer-events-none w-0 opacity-0'
      )}
      style={{ maxHeight: 'calc(100dvh - 6rem)' }}
    >
      <div className="w-[320px] min-w-0 max-w-full p-3.5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-semibold whitespace-nowrap">
            Agent settings
          </h3>
          <div className="flex shrink-0 items-center gap-0.5">
            <AppLink
              href="/agents/settings"
              className="text-muted-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-1 rounded-md px-1.5 py-1 text-[10.5px] font-medium transition-colors"
            >
              Full settings
              <ArrowRightIcon className="size-2.5" />
            </AppLink>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground size-7 shrink-0"
              aria-label="Close agent settings"
            >
              <PanelRightCloseIcon className="size-3.5" />
            </Button>
          </div>
        </div>
        {sections}
      </div>
    </aside>
  )
}
