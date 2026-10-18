export interface ShortcutDefinition {
  key: string
  description: string
}

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { key: '⌘K', description: 'Open command palette' },
  { key: '⌘G', description: 'Go to overview' },
  { key: '⌘Q', description: 'Go to running queries' },
  { key: '⌘D', description: 'Go to database tables' },
  { key: '⌘R', description: 'Refresh data' },
  { key: '⌘/', description: 'Show shortcuts' },
  { key: 'Esc', description: 'Close modals' },
] as const
