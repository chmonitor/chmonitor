'use client'

/**
 * Full skills library, opened from the "Skill library" button in the agent
 * settings sidebar (and embedded inline in the Skills tab of `/agents/settings`
 * via {@link SkillsLibraryList}). Lists every skill bundle (not just the top 3)
 * with a search box, full descriptions, the tools each bundle covers, and a
 * per-skill enable toggle. Reuses the shared `useAgentSkills` state so toggles
 * here stay in sync with the composer toolbar, sidebar, and settings page.
 */

import { SearchIcon } from 'lucide-react'

import type { UseAgentSkillsResult } from '@/lib/hooks/use-agent-skills'

import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { useAgentSkills } from '@/lib/hooks/use-agent-skills'
import { cn } from '@/lib/utils'

interface SkillsLibraryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SkillsLibraryDialog({
  open,
  onOpenChange,
}: SkillsLibraryDialogProps) {
  // Single hook instance shared by the header count and the list below —
  // `useAgentSkills` seeds local state from localStorage per instance with no
  // cross-instance sync, so a second call here would let the header count go
  // stale while the list's toggles kept working.
  const agentSkills = useAgentSkills()
  const { skills, activeSkillCount } = agentSkills

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Skill library</DialogTitle>
          <DialogDescription>
            {activeSkillCount} of {skills.length} skills enabled. Toggle a skill
            to add or remove the tools it covers.
          </DialogDescription>
        </DialogHeader>
        <SkillsLibraryList agentSkills={agentSkills} />
      </DialogContent>
    </Dialog>
  )
}

/**
 * Search box + full skill list, extracted so it can render both inside the
 * dialog above (chrome + portal) and inline as a settings-page tab (plain
 * content, no dialog chrome). Takes the `useAgentSkills()` result as a prop
 * rather than calling the hook itself, so callers that also show a live
 * count (the dialog header, the settings-page tab header) share one state
 * instance instead of drifting out of sync.
 */
export function SkillsLibraryList({
  agentSkills,
}: {
  agentSkills: UseAgentSkillsResult
}) {
  const { skills, isSkillEnabled, toggleSkill } = agentSkills
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return skills
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.tools.some((t) => t.toLowerCase().includes(q))
    )
  }, [skills, query])

  return (
    <>
      <div className="border-b px-5 py-3">
        <div className="relative">
          <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search skills or tools…"
            className="h-9 pl-8 text-[12.5px]"
          />
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-1 p-3">
          {filtered.length === 0 ? (
            <p className="text-muted-foreground px-2 py-6 text-center text-[12px]">
              No skills match “{query}”.
            </p>
          ) : (
            filtered.map((skill) => {
              const Icon = skill.icon
              const on = isSkillEnabled(skill.id)
              return (
                <div
                  key={skill.id}
                  className="hover:bg-muted/40 flex items-start gap-3 rounded-lg border p-3"
                >
                  <div className="bg-muted text-muted-foreground inline-flex size-8 shrink-0 items-center justify-center rounded-md">
                    <Icon className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">
                        {skill.name}
                      </span>
                      <Badge
                        variant={
                          skill.source === 'system' ? 'default' : 'outline'
                        }
                        className={cn(
                          'h-4 px-1.5 text-[10px] font-normal',
                          skill.source === 'system'
                            ? 'bg-blue-50 text-blue-700 hover:bg-blue-50 dark:bg-blue-500/10 dark:text-blue-300'
                            : 'text-muted-foreground'
                        )}
                      >
                        {skill.source}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-[11.5px] leading-snug">
                      {skill.description}
                    </p>
                    {skill.tools.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {skill.tools.map((tool) => (
                          <span
                            key={tool}
                            className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 font-mono text-[10px]"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <Switch
                    checked={on}
                    onCheckedChange={() => toggleSkill(skill.id)}
                    className="mt-0.5 shrink-0"
                    aria-label={`Toggle ${skill.name}`}
                  />
                </div>
              )
            })
          )}
        </div>
      </ScrollArea>
    </>
  )
}
