/**
 * Docs generated from ClickHouse's own description columns
 * (system.columns.comment, system.settings.description/tier), read from a
 * live server or `clickhouse local`. Additive to the changelog-based docs.
 */

import { TARGET_TABLES } from './constants'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Query = (sql: string) => Record<string, unknown>[]

export interface ColumnComment {
  name: string
  type: string
  comment: string
}

export interface TableComments {
  table: string
  columns: ColumnComment[]
}

export interface TieredSetting {
  name: string
  tier: string
  description: string
}

const TIERS = ['Experimental', 'Beta'] as const

export function clickhouseLocalQuery(bin = 'clickhouse'): Query {
  return (sql) => {
    const out = execFileSync(
      bin,
      ['local', '--output-format', 'JSONEachRow', '-q', sql],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
    )
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }
}

/** Collapse a description to one table-safe line (first paragraph, capped). */
export function toCell(text: string, max = 300): string {
  const first = text.trim().split(/\n\s*\n/)[0] ?? ''
  const flat = first.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/** Names of columns that exist on `system.<table>` for this server version. */
export function discoverColumns(query: Query, table: string): Set<string> {
  const rows = query(
    `SELECT name FROM system.columns WHERE database = 'system' AND table = '${table}'`
  )
  return new Set(rows.map((r) => String(r.name)))
}

export function fetchColumnComments(query: Query): TableComments[] {
  // `comment` is selected only if this version's system.columns has it.
  const hasComment = discoverColumns(query, 'columns').has('comment')
  const result: TableComments[] = []
  for (const full of TARGET_TABLES) {
    const table = full.replace('system.', '')
    const rows = query(
      `SELECT name, type, ${hasComment ? 'comment' : "'' AS comment"} FROM system.columns WHERE database = 'system' AND table = '${table}' ORDER BY position`
    )
    // Log tables such as query_log only exist once the server has created them.
    if (rows.length === 0) continue
    result.push({
      table: full,
      columns: rows.map((r) => ({
        name: String(r.name),
        type: String(r.type),
        comment: String(r.comment ?? ''),
      })),
    })
  }
  return result
}

/** Null when this version has no `tier` column (pre-tier releases). */
export function fetchTieredSettings(query: Query): TieredSetting[] | null {
  if (!discoverColumns(query, 'settings').has('tier')) return null
  const list = TIERS.map((t) => `'${t}'`).join(', ')
  return query(
    `SELECT name, tier, description FROM system.settings WHERE tier IN (${list}) ORDER BY tier, name`
  ).map((r) => ({
    name: String(r.name),
    tier: String(r.tier),
    description: String(r.description ?? ''),
  }))
}

export function renderSettingsTiers(
  version: string,
  settings: TieredSetting[]
): string {
  let md = `---
title: ClickHouse Settings Tiers
version: "${version}"
---

# Experimental and Beta settings (ClickHouse ${version})

Generated from \`system.settings.tier\`. Do not edit; regenerate with
\`bun run scripts/build-ch-schema-docs.ts --live\`. Experimental settings can
change or disappear without notice; do not rely on them in query configs.

`
  for (const tier of TIERS) {
    const rows = settings.filter((s) => s.tier === tier)
    md += `## ${tier} (${rows.length})\n\n| Setting | Description |\n|---------|-------------|\n`
    for (const s of rows) md += `| \`${s.name}\` | ${toCell(s.description)} |\n`
    md += `\n`
  }
  return md
}

export function renderColumnComments(
  version: string,
  tables: TableComments[]
): string {
  let md = `---
title: ClickHouse Column Descriptions
version: "${version}"
---

# System table column descriptions (ClickHouse ${version})

Generated from \`system.columns.comment\`. Do not edit; regenerate with
\`bun run scripts/build-ch-schema-docs.ts --live\`. Tables absent on the
source server (for example \`system.query_log\` on a fresh \`clickhouse local\`)
are omitted.

`
  for (const t of tables) {
    md += `## ${t.table}\n\n| Column | Type | Description |\n|--------|------|-------------|\n`
    for (const c of t.columns) {
      md += `| \`${c.name}\` | \`${c.type.replace(/\|/g, '\\|')}\` | ${toCell(c.comment)} |\n`
    }
    md += `\n`
  }
  return md
}

export async function generateLiveDocs(
  query: Query,
  outputDir: string
): Promise<void> {
  const version = String(query('SELECT version() AS v')[0]?.v ?? 'unknown')
  await mkdir(outputDir, { recursive: true })

  const comments = fetchColumnComments(query)
  await writeFile(
    join(outputDir, 'column-descriptions.md'),
    renderColumnComments(version, comments)
  )
  console.log('Generated column-descriptions.md')

  const settings = fetchTieredSettings(query)
  if (settings === null) {
    console.log(`Skipped settings-tiers.md: ${version} has no tier column`)
    return
  }
  await writeFile(
    join(outputDir, 'settings-tiers.md'),
    renderSettingsTiers(version, settings)
  )
  console.log('Generated settings-tiers.md')
}
