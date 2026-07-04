'use client'

/**
 * Skills tab — `/agents/settings`.
 *
 * Full skill library with search + per-skill toggles. Wraps
 * {@link SkillsLibraryList}, the same list used in the "Skill library" dialog
 * opened from the chat sidebar, so toggles stay in sync everywhere.
 */

import { SkillsLibraryList } from '@/components/agents/welcome/skills-library-dialog'
import { useAgentSkills } from '@/lib/hooks/use-agent-skills'

export function SkillsTab() {
  // Single hook instance shared with the list below (see the note in
  // skills-library-dialog.tsx) — otherwise this header's count goes stale
  // while the list's toggles keep working.
  const agentSkills = useAgentSkills()
  const { skills, activeSkillCount } = agentSkills

  return (
    <div className="flex max-h-[560px] flex-col overflow-hidden rounded-md border">
      <div className="border-b px-4 py-3">
        <p className="text-[13px] font-medium">
          {activeSkillCount} of {skills.length} skills enabled
        </p>
        <p className="text-muted-foreground text-[11.5px]">
          Toggle a skill to add or remove the tools it covers from the agent.
        </p>
      </div>
      <SkillsLibraryList agentSkills={agentSkills} />
    </div>
  )
}
