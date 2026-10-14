import type { Mention, SlashCommand } from './types'

import { apiFetch } from '@/lib/swr/api-fetch'

interface ResolveOptions {
  hostId: number
}

interface ColumnRow {
  name: string
  type: string
  default_kind: string
  comment: string
}

/**
 * Fetches column metadata for a table from the explorer API and returns it as a formatted string.
 *
 * @param database - The database name containing the table
 * @param table - The table name to fetch columns for
 * @param hostId - The identifier of the host to query
 * @returns A comma-separated string of column definitions where each entry is `name type` optionally followed by `-- comment`; returns an empty string if no columns are available or the request fails
 */
async function fetchTableSchema(
  database: string,
  table: string,
  hostId: number
): Promise<string> {
  try {
    const url = `/api/v1/explorer/columns?hostId=${hostId}&database=${encodeURIComponent(database)}&table=${encodeURIComponent(table)}`
    const res = await apiFetch(url)
    if (!res.ok) return ''

    const json = (await res.json()) as { data?: ColumnRow[] }
    const rows: ColumnRow[] = json?.data ?? []
    if (rows.length === 0) return ''

    const cols = rows
      .map((r) => {
        const parts = [r.name, r.type]
        if (r.comment) parts.push(`-- ${r.comment}`)
        return parts.join(' ')
      })
      .join(', ')

    return cols
  } catch {
    return ''
  }
}

export async function resolveMentionContext(
  mentions: Mention[],
  slashCommand: SlashCommand | null,
  userText: string,
  options: ResolveOptions
): Promise<string> {
  const { hostId } = options
  const contextSections: string[] = []

  for (const mention of mentions) {
    if (mention.type === 'table' && mention.database && mention.table) {
      const schema = await fetchTableSchema(
        mention.database,
        mention.table,
        hostId
      )
      if (schema) {
        contextSections.push(
          `[Context: ${mention.value} schema]\nColumns: ${schema}`
        )
      }
    } else if (mention.type === 'resource') {
      contextSections.push(`[Context: System resource "${mention.label}"]`)
    } else if (mention.type === 'skill') {
      contextSections.push(`[Context: Using skill "${mention.label}"]`)
    }
  }

  const contextBlock =
    contextSections.length > 0 ? `${contextSections.join('\n\n')}\n\n` : ''

  const messageBody = `${contextBlock}${userText}`

  if (slashCommand?.promptTemplate) {
    return `${slashCommand.promptTemplate}${messageBody}`
  }

  return messageBody
}
