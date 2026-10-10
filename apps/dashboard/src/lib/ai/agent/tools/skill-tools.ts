import { z } from 'zod'

import { getAllSkills } from '../skills/dynamic-loader'
import { dynamicTool } from 'ai'

const MAX_PURPOSE_CHARS = 60

/** First sentence of a skill description, cut at a word boundary. */
function shortPurpose(description: string): string {
  const first = description.split(/\.\s|\.$/)[0].trim()
  if (first.length <= MAX_PURPOSE_CHARS) return first
  const cut = first.slice(0, MAX_PURPOSE_CHARS)
  return `${cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s]+$/, '')}…`
}

export function createSkillTools() {
  return {
    load_skill: dynamicTool({
      description: `Load expert guidance by skill name (best practices, recipes, tuning). Skills:\n${getAllSkills()
        .map((s) => `- ${s.name}: ${shortPurpose(s.description)}`)
        .join('\n')}`,
      inputSchema: z.object({
        name: z.string().describe('Name of the skill to load'),
      }),
      execute: async (input: unknown) => {
        const { name } = input as { name: string }
        const skills = getAllSkills()
        const skill = skills.find((s) => s.name === name)
        if (!skill) {
          const available = skills.map((s) => s.name).join(', ')
          throw new Error(
            `Skill "${name}" not found. Available skills: ${available}`
          )
        }
        return skill
      },
    }),
  }
}
