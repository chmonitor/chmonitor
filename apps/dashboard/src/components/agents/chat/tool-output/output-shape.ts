import type { QueryConfig } from '@/types/query-config'

export function createResultQueryConfig(
  columns: string[]
): QueryConfig<string[]> {
  return {
    name: 'agent-query-result',
    description: 'Query results from AI agent',
    sql: 'SELECT * FROM agent_result',
    columns,
  }
}

export function getRowsFromOutput(output: unknown): Record<string, unknown>[] {
  if (Array.isArray(output) && output.length > 0) {
    const first = output[0]
    if (typeof first === 'object' && first !== null) {
      return output as Record<string, unknown>[]
    }
  }

  if (typeof output === 'object' && output !== null) {
    const obj = output as Record<string, unknown>
    if (Array.isArray(obj.rows) && obj.rows.length > 0) {
      return obj.rows as Record<string, unknown>[]
    }
  }

  return []
}

const SUMMARY_MAX_LENGTH = 60
/** Param names treated as the tool's "primary" free-text argument (e.g. a SQL
 * query) — summarized alone in the header instead of the full key=value dump. */
const PRIMARY_PARAM_NAMES = /^(sql|query|prompt|question|text)$/i

/** Collapses whitespace/newlines to a single line and caps the length. */
function truncateOneLine(
  value: string,
  maxLength = SUMMARY_MAX_LENGTH
): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > maxLength
    ? `${oneLine.slice(0, maxLength - 1)}…`
    : oneLine
}

/**
 * Short, single-line summary of a tool call's input for the collapsed row
 * header. Long values (e.g. a `sql` param) are truncated instead of dumping
 * every `key=value` pair inline — the full input still renders in the
 * "Parameters" disclosure of the expanded body.
 */
export function summarizeToolInput(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const entries = Object.entries(input as Record<string, unknown>)
  if (entries.length === 0) return null

  const primary = entries.find(
    ([key, value]) => typeof value === 'string' && PRIMARY_PARAM_NAMES.test(key)
  )
  if (primary) return truncateOneLine(primary[1] as string)

  // Otherwise join all params as `key=value` — most tools take a couple of
  // short scalars (`database=default, tableName=events`), which is more
  // scannable than a bare count. Cap the joined form so a tool with several
  // longer values doesn't reproduce the original "unreadable mid-string
  // truncation" problem; only degrade to a count when even the first pair
  // alone doesn't fit.
  const joined = entries
    .map(([key, value]) => {
      const rendered = typeof value === 'string' ? value : JSON.stringify(value)
      return `${key}=${rendered}`
    })
    .join(', ')
  const oneLine = joined.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= SUMMARY_MAX_LENGTH) return oneLine

  const firstPair = entries[0]
  const firstRendered =
    typeof firstPair[1] === 'string'
      ? firstPair[1]
      : JSON.stringify(firstPair[1])
  const firstPairText = `${firstPair[0]}=${firstRendered}`.replace(/\s+/g, ' ')
  if (firstPairText.length <= SUMMARY_MAX_LENGTH) return truncateOneLine(joined)

  return `${entries.length} parameters`
}

/** Param whose value should render as a syntax-highlighted code block in the
 * expanded "Parameters" disclosure rather than an inline `key: value` row. */
export function isLongToolInputValue(value: unknown): value is string {
  return (
    typeof value === 'string' && (value.length > 60 || value.includes('\n'))
  )
}

/** Language hint for a long tool-input value shown in a code block. */
export function toolInputCodeLanguage(key: string): string {
  return /sql|query/i.test(key) ? 'sql' : 'text'
}

export interface ToolErrorSummary {
  /** Short, human-readable message — never raw JSON. */
  readonly message: string
  /** Pretty-printed JSON to show behind an expandable "Details" disclosure,
   * only when it carries more information than `message` alone. */
  readonly detail: string | null
}

/**
 * Turns a tool's `errorText` (plain text, or a JSON-stringified error object —
 * see `tool-fallback.tsx`) into a short message + optional expandable detail.
 * Never surfaces a raw `{"error":"..."}` blob as the visible message.
 */
export function summarizeToolError(
  errorText: string | undefined
): ToolErrorSummary {
  const trimmed = errorText?.trim()
  if (!trimmed) return { message: 'An error occurred.', detail: null }

  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>
      const readableKey =
        typeof obj.error === 'string'
          ? 'error'
          : typeof obj.message === 'string'
            ? 'message'
            : null
      if (readableKey) {
        // Only offer a "Details" disclosure when the payload carries more
        // than the message itself — otherwise expanding it just re-shows
        // the same text wrapped in braces.
        const hasExtraFields = Object.keys(obj).some(
          (key) => key !== readableKey
        )
        return {
          message: obj[readableKey] as string,
          detail: hasExtraFields ? JSON.stringify(parsed, null, 2) : null,
        }
      }
      return {
        message: 'Tool call failed.',
        detail: JSON.stringify(parsed, null, 2),
      }
    }
  } catch {
    // Not JSON — errorText is already plain text.
  }

  return { message: trimmed, detail: null }
}

export type ToolFamily =
  | 'query'
  | 'schema'
  | 'health'
  | 'disk'
  | 'replication'
  | 'merge'
  | 'skill'
  | 'plan'
  | 'visualize'
  | 'ask_user'
  | 'generic'

const TOOL_FAMILY_MATCHERS: readonly {
  readonly family: ToolFamily
  readonly pattern: RegExp
}[] = [
  { family: 'ask_user', pattern: /ask_user/i },
  { family: 'visualize', pattern: /visuali[sz]|chart/i },
  { family: 'skill', pattern: /skill|reference_query/i },
  { family: 'plan', pattern: /plan|workflow/i },
  { family: 'replication', pattern: /replicat|keeper/i },
  { family: 'merge', pattern: /merge|mutation/i },
  { family: 'disk', pattern: /disk|parts|storage/i },
  { family: 'health', pattern: /health|metric|error|anomaly/i },
  { family: 'schema', pattern: /schema|table|database|column/i },
  { family: 'query', pattern: /query|sql|explain/i },
]

/** Maps a tool name onto a presentational family for the chat row icon. */
export function getToolFamily(toolName: string): ToolFamily {
  for (const { family, pattern } of TOOL_FAMILY_MATCHERS) {
    if (pattern.test(toolName)) return family
  }
  return 'generic'
}

/**
 * One-line success summary for a finished tool row. Prefers a row count,
 * then a well-known scalar (table, lag, status), then a promoted type label.
 * Never dumps the raw payload.
 */
export function summarizeToolOutput(output: unknown): string | null {
  if (output == null) return null

  if (typeof output === 'string') {
    const trimmed = output.trim()
    if (!trimmed) return null
    return trimmed.length > 60 ? `${trimmed.slice(0, 59)}…` : trimmed
  }

  if (Array.isArray(output)) {
    return output.length === 1 ? '1 row' : `${output.length} rows`
  }

  if (typeof output !== 'object') return null

  const obj = output as Record<string, unknown>
  const rows = getRowsFromOutput(output)
  if (rows.length > 0) {
    return rows.length === 1 ? '1 row' : `${rows.length} rows`
  }

  const table =
    (typeof obj.table === 'string' && obj.table) ||
    (typeof obj.tableName === 'string' && obj.tableName) ||
    (typeof obj.name === 'string' && obj.name)
  if (table) return table

  if (typeof obj.absolute_delay === 'number') {
    return `lag ${obj.absolute_delay}s`
  }
  if (typeof obj.lag === 'number') {
    return `lag ${obj.lag}s`
  }
  if (typeof obj.status === 'string') return obj.status

  const promoted = getPromotedOutputType(output)
  if (promoted) return promoted.replace(/_/g, ' ')

  if (typeof obj.count === 'number') {
    return obj.count === 1 ? '1 item' : `${obj.count} items`
  }

  return null
}

export function getPromotedOutputType(output: unknown) {
  if (typeof output !== 'object' || output === null) return null

  const outputObj = output as Record<string, unknown>
  if (
    outputObj.type === 'query_insights' &&
    Array.isArray(outputObj.highlights)
  ) {
    return 'query_insights' as const
  }
  if (outputObj.type === 'visualization' && Array.isArray(outputObj.rows)) {
    return 'visualization' as const
  }
  if (outputObj.type === 'data_sources' && Array.isArray(outputObj.sources)) {
    return 'data_sources' as const
  }
  if (outputObj.type === 'workflow_plan' && Array.isArray(outputObj.steps)) {
    return 'workflow_plan' as const
  }
  if (
    outputObj.type === 'dashboard_suggestion' &&
    typeof outputObj.layout === 'object' &&
    outputObj.layout !== null
  ) {
    return 'dashboard_suggestion' as const
  }
  if (outputObj.type === 'agent_issues' && Array.isArray(outputObj.issues)) {
    return 'agent_issues' as const
  }
  if (outputObj.type === 'query_repair') {
    return 'query_repair' as const
  }
  if (
    outputObj.type === 'table_design_recommendation' &&
    Array.isArray(outputObj.recommendations)
  ) {
    return 'table_design_recommendation' as const
  }

  return null
}
