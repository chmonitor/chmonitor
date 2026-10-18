export type SkillSource = 'builtin' | 'user' | 'remote'

export interface SkillMetadata {
  name: string
  description: string
  source?: SkillSource
}

export interface Skill extends SkillMetadata {
  content: string
}
