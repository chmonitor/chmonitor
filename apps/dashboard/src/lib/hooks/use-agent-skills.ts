/** A skill maps to a fixed set of MCP tools; toggling it off disables every tool it owns. */

'use client'

import { useEffect, useState } from 'react'
import {
  countActiveTools,
  readSkillStorage,
  SKILLS,
  type Skill,
  writeSkillStorage,
} from '@/components/agents/welcome/skills-data'

export interface UseAgentSkillsResult {
  skills: readonly Skill[]
  activeSkillIds: readonly string[]
  isSkillEnabled: (id: string) => boolean
  toggleSkill: (id: string) => void
  setSkillEnabled: (id: string, enabled: boolean) => void
  activeToolCount: number
  activeSkillCount: number
  totalSkillCount: number
}

export function useAgentSkills(): UseAgentSkillsResult {
  const [disabled, setDisabled] = useState<string[]>(
    () => readSkillStorage().disabled
  )

  useEffect(() => {
    writeSkillStorage({ disabled })
  }, [disabled])

  const isSkillEnabled = (id: string) => !disabled.includes(id)

  const toggleSkill = (id: string) => {
    setDisabled((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    )
  }

  const setSkillEnabled = (id: string, enabled: boolean) => {
    setDisabled((prev) => {
      const has = prev.includes(id)
      if (enabled && has) return prev.filter((d) => d !== id)
      if (!enabled && !has) return [...prev, id]
      return prev
    })
  }

  const activeSkillIds = SKILLS.filter((s) => !disabled.includes(s.id)).map(
    (s) => s.id
  )

  const activeToolCount = countActiveTools(activeSkillIds)

  return {
    skills: SKILLS,
    activeSkillIds,
    isSkillEnabled,
    toggleSkill,
    setSkillEnabled,
    activeToolCount,
    activeSkillCount: activeSkillIds.length,
    totalSkillCount: SKILLS.length,
  }
}
