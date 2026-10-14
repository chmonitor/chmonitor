/**
 * Parse ClickHouse changelog to extract system table changes
 */

import type { ChangelogEntry, VersionChange } from './types'

import { KNOWN_COLUMN_CHANGES, TARGET_TABLES } from './constants'

export function parseChangelog(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []

  // Format: ## ClickHouse release v24.1.1.xxx, 2024-01-xx
  const versionPattern =
    /^## ClickHouse release v(\d+\.\d+)(?:\.\d+)?(?:\.\d+)?,?\s*(\d{4}-\d{2}-\d{2})?/gm

  const sections = content.split(versionPattern)

  for (let i = 1; i < sections.length; i += 3) {
    const version = sections[i]
    const releaseDate = sections[i + 1]
    const sectionContent = sections[i + 2] || ''

    const changes = extractSystemTableChanges(version, sectionContent)

    // Merge with known changes
    const knownChanges = KNOWN_COLUMN_CHANGES[version] || []
    for (const known of knownChanges) {
      const exists = changes.some(
        (c) => c.table === known.table && c.column === known.column
      )
      if (!exists) {
        changes.push({
          version,
          table: known.table,
          changeType:
            known.changeType === 'added' ? 'column_added' : 'column_removed',
          column: known.column,
          description: `${known.column} (${known.type})`,
        })
      }
    }

    if (changes.length > 0) {
      entries.push({
        version,
        releaseDate: releaseDate || undefined,
        isLTS: version.endsWith('.3') || version.endsWith('.8'),
        changes,
      })
    }
  }

  return entries
}

function extractSystemTableChanges(
  version: string,
  content: string
): VersionChange[] {
  const changes: VersionChange[] = []

  for (const table of TARGET_TABLES) {
    const tablePattern = new RegExp(`\\b${table.replace('.', '\\.')}\\b`, 'gi')

    if (tablePattern.test(content)) {
      // Found a mention - try to extract what changed
      const lines = content.split('\n')

      for (const line of lines) {
        if (line.toLowerCase().includes(table.toLowerCase())) {
          // Try to determine the change type
          const change = parseChangeLine(version, table, line)
          if (change) {
            changes.push(change)
          }
        }
      }
    }
  }

  return changes
}

function parseChangeLine(
  version: string,
  table: string,
  line: string
): VersionChange | null {
  const lowerLine = line.toLowerCase()

  if (lowerLine.includes('add') && lowerLine.includes('column')) {
    const columnMatch = line.match(/column\s+`?(\w+)`?/i)
    return {
      version,
      table,
      changeType: 'column_added',
      column: columnMatch?.[1],
      description: line.trim(),
    }
  }

  if (lowerLine.includes('remove') && lowerLine.includes('column')) {
    const columnMatch = line.match(/column\s+`?(\w+)`?/i)
    return {
      version,
      table,
      changeType: 'column_removed',
      column: columnMatch?.[1],
      description: line.trim(),
    }
  }

  if (lowerLine.includes('rename')) {
    const renameMatch = line.match(/`?(\w+)`?\s*(?:to|->|=>)\s*`?(\w+)`?/i)
    if (renameMatch) {
      return {
        version,
        table,
        changeType: 'column_renamed',
        oldName: renameMatch[1],
        newName: renameMatch[2],
        description: line.trim(),
      }
    }
  }

  return {
    version,
    table,
    changeType: 'behavior_changed',
    description: line.trim(),
  }
}

export function groupChangesByTable(
  entries: ChangelogEntry[]
): Map<string, VersionChange[]> {
  const byTable = new Map<string, VersionChange[]>()

  for (const entry of entries) {
    for (const change of entry.changes) {
      const existing = byTable.get(change.table) || []
      existing.push(change)
      byTable.set(change.table, existing)
    }
  }

  return byTable
}

export function groupChangesByVersion(
  entries: ChangelogEntry[]
): Map<string, VersionChange[]> {
  const byVersion = new Map<string, VersionChange[]>()

  for (const entry of entries) {
    byVersion.set(entry.version, entry.changes)
  }

  return byVersion
}
