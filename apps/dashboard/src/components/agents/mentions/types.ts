export type MentionType = 'table' | 'resource' | 'skill'

export interface Mention {
  id: string
  type: MentionType
  label: string
  value: string
  database?: string
  table?: string
}

export interface SlashCommand {
  name: string
  label: string
  description: string
  promptTemplate: string
}

export type AutocompleteItem = {
  id: string
  type: 'table' | 'database' | 'resource' | 'skill' | 'command'
  label: string
  description?: string
  value: string
  group: string
}
