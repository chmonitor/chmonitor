/**
 * Generate markdown documentation from parsed changelog
 */

import type { ChangelogEntry, VersionChange } from './types'

import { groupChangesByTable, groupChangesByVersion } from './changelog-parser'
import { DEFAULT_OUTPUT_DIR, LTS_VERSIONS, TARGET_TABLES } from './constants'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function generateDocs(
  entries: ChangelogEntry[],
  outputDir: string = DEFAULT_OUTPUT_DIR
): Promise<void> {
  await mkdir(outputDir, { recursive: true })
  await mkdir(join(outputDir, 'tables'), { recursive: true })

  const byVersion = groupChangesByVersion(entries)
  for (const [version, changes] of byVersion) {
    const content = generateVersionDoc(version, changes)
    await writeFile(join(outputDir, `v${version}.md`), content)
    console.log(`Generated v${version}.md`)
  }

  const byTable = groupChangesByTable(entries)
  for (const table of TARGET_TABLES) {
    const changes = byTable.get(table) || []
    const content = generateTableDoc(table, changes)
    const fileName = `${table.replace('system.', '')}.md`
    await writeFile(join(outputDir, 'tables', fileName), content)
    console.log(`Generated tables/${fileName}`)
  }

  console.log(
    `\nGenerated ${byVersion.size} version docs and ${TARGET_TABLES.length} table docs`
  )
}

function generateVersionDoc(version: string, changes: VersionChange[]): string {
  const isLTS = (LTS_VERSIONS as readonly string[]).includes(version)

  let md = `---
version: "${version}"
type: ${isLTS ? 'LTS' : 'Regular'}
---

# ClickHouse ${version} System Table Changes

`

  if (changes.length === 0) {
    md += `No documented system table changes in this version.\n`
    return md
  }

  const added = changes.filter((c) => c.changeType === 'column_added')
  const removed = changes.filter((c) => c.changeType === 'column_removed')
  const renamed = changes.filter((c) => c.changeType === 'column_renamed')
  const behavior = changes.filter((c) => c.changeType === 'behavior_changed')

  if (added.length > 0) {
    md += `## New Columns\n\n`
    const byTable = groupByTable(added)
    for (const [table, tableChanges] of byTable) {
      md += `### ${table}\n\n`
      md += `| Column | Description |\n`
      md += `|--------|-------------|\n`
      for (const change of tableChanges) {
        md += `| \`${change.column || 'unknown'}\` | ${change.description || ''} |\n`
      }
      md += `\n`
    }
  }

  if (removed.length > 0) {
    md += `## Removed Columns\n\n`
    for (const change of removed) {
      md += `- \`${change.table}.${change.column}\`: ${change.description || 'Removed'}\n`
    }
    md += `\n`
  }

  if (renamed.length > 0) {
    md += `## Renamed Columns\n\n`
    for (const change of renamed) {
      md += `- \`${change.table}\`: \`${change.oldName}\` → \`${change.newName}\`\n`
    }
    md += `\n`
  }

  if (behavior.length > 0) {
    md += `## Behavior Changes\n\n`
    for (const change of behavior) {
      md += `- \`${change.table}\`: ${change.description}\n`
    }
    md += `\n`
  }

  md += `## LLM Context\n\n`
  md += `When generating queries for ClickHouse ${version}+:\n\n`
  for (const change of added) {
    if (change.column) {
      md += `- \`${change.column}\` is available in ${change.table}\n`
    }
  }

  return md
}

function generateTableDoc(table: string, changes: VersionChange[]): string {
  let md = `---
table: ${table}
---

# ${table} Schema History

`

  const versions = ['23.1', '23.8', '24.1', '24.3', '24.8', '25.1']
  const columns = new Set<string>()

  for (const change of changes) {
    if (change.column) columns.add(change.column)
  }

  if (columns.size > 0) {
    md += `## Version Compatibility Matrix\n\n`
    md += `| Column |`
    for (const v of versions) md += ` ${v} |`
    md += `\n`
    md += `|--------|`
    for (const _ of versions) md += `------|`
    md += `\n`

    for (const column of columns) {
      md += `| \`${column}\` |`
      for (const v of versions) {
        const addedIn = changes.find(
          (c) => c.column === column && c.changeType === 'column_added'
        )?.version

        const exists = addedIn ? v >= addedIn : true
        md += exists ? ` Yes |` : ` - |`
      }
      md += `\n`
    }
    md += `\n`
  }

  md += `## Change History\n\n`

  if (changes.length === 0) {
    md += `No documented changes to this table.\n`
  } else {
    for (const change of changes.sort((a, b) =>
      b.version.localeCompare(a.version)
    )) {
      md += `### v${change.version}\n\n`
      md += `- ${change.changeType.replace(/_/g, ' ')}`
      if (change.column) md += `: \`${change.column}\``
      if (change.description) md += ` - ${change.description}`
      md += `\n\n`
    }
  }

  return md
}

function groupByTable(changes: VersionChange[]): Map<string, VersionChange[]> {
  const byTable = new Map<string, VersionChange[]>()
  for (const change of changes) {
    const existing = byTable.get(change.table) || []
    existing.push(change)
    byTable.set(change.table, existing)
  }
  return byTable
}
