import type {
  DocsLink,
  HealthCheckDef,
  RelatedLink,
} from '@/components/health/health-checks'

import { toClickHouseDocMarkdownUrl } from '@/lib/docs/clickhouse-doc-md-url'

export interface AuditPromptInput {
  check: HealthCheckDef
  /** Current numeric value of the check (or null if unavailable). */
  value: number | null
  /** Resolved warning/critical thresholds. */
  thresholds: { warning: number; critical: number }
  status: 'ok' | 'warning' | 'critical' | 'error' | 'loading'
  /** Full first-row data from the chart. */
  row?: Record<string, unknown>
  hostId: number
  clickhouseVersion?: string
}

/**
 * Toggles for which optional sections to include in the generated prompt.
 * Header / Observation / Requested output are always present. Every optional
 * section defaults to `true`.
 */
export interface AuditPromptOptions {
  sql?: boolean
  rawData?: boolean
  systemTables?: boolean
  commonCauses?: boolean
  relatedLinks?: boolean
  docsLinks?: boolean
  /** When docsLinks is on, also emit raw-GitHub `.md` URLs an agent can fetch. */
  docsMarkdown?: boolean
}

/** All optional sections enabled — the default prompt shape. */
export const DEFAULT_AUDIT_PROMPT_OPTIONS: Required<AuditPromptOptions> = {
  sql: true,
  rawData: true,
  systemTables: true,
  commonCauses: true,
  relatedLinks: true,
  docsLinks: true,
  docsMarkdown: true,
}

/**
 * Rough token estimate for the generated prompt. Uses the common ~4-chars-per-token
 * heuristic; exact tokenization varies per model but this is good enough to show
 * the relative cost impact of toggling sections.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const bullet = (lines: readonly string[]) =>
  lines.map((line) => `- ${line}`).join('\n')

const formatLinks = (
  base: string,
  links: readonly RelatedLink[],
  hostId: number
) =>
  links
    .map(
      (l) =>
        `- [${l.label}](${base}${l.href}${l.href.includes('?') ? '&' : '?'}host=${hostId})`
    )
    .join('\n')

const formatDocs = (links: readonly DocsLink[], withMarkdown: boolean) =>
  links
    .map((l) => {
      const mdUrl = withMarkdown ? toClickHouseDocMarkdownUrl(l.url) : null
      return mdUrl
        ? `- [${l.label}](${l.url}) — raw markdown: ${mdUrl}`
        : `- [${l.label}](${l.url})`
    })
    .join('\n')

const formatRow = (row?: Record<string, unknown>) => {
  if (!row) return '_(no row data)_'
  const entries = Object.entries(row)
  if (entries.length === 0) return '_(empty row)_'
  return entries
    .map(([k, v]) => `- \`${k}\`: \`${JSON.stringify(v)}\``)
    .join('\n')
}

export function buildAuditPrompt(
  input: AuditPromptInput,
  options?: AuditPromptOptions
): string {
  const { check, value, thresholds, status, row, hostId, clickhouseVersion } =
    input
  const opts = { ...DEFAULT_AUDIT_PROMPT_OPTIONS, ...options }

  const appBase =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://dash.chmonitor.dev'

  const valueStr =
    value === null
      ? 'unavailable'
      : check.formatValue
        ? check.formatValue(value)
        : value.toLocaleString()

  const sections: string[] = []

  sections.push(
    `# ClickHouse Health Audit — ${check.title}`,
    '',
    `Help me diagnose and remediate a **${status.toUpperCase()}** condition on a ClickHouse cluster. Use the context below to propose concrete diagnostic queries and a remediation plan.`,
    ''
  )

  sections.push(
    '## Observation',
    '',
    bullet([
      `Check: **${check.title}** (id: \`${check.id}\`)`,
      `Current value: **${valueStr}**`,
      `Status: **${status}**`,
      `Warning threshold: \`${thresholds.warning}\``,
      `Critical threshold: \`${thresholds.critical}\``,
      `Host id: \`${hostId}\``,
      clickhouseVersion
        ? `ClickHouse version: \`${clickhouseVersion}\``
        : 'ClickHouse version: _unknown_',
    ]),
    ''
  )

  if (check.description) {
    sections.push('## Description', '', check.description, '')
  }

  if (opts.sql && check.sql) {
    sections.push(
      '## Metric query (how this value is computed)',
      '',
      '```sql',
      check.sql,
      '```',
      ''
    )
  }

  if (opts.rawData && row && Object.keys(row).length > 0) {
    sections.push('## Raw data row', '', formatRow(row), '')
  }

  if (
    opts.systemTables &&
    check.systemTables &&
    check.systemTables.length > 0
  ) {
    sections.push(
      '## Relevant ClickHouse system tables',
      '',
      bullet(check.systemTables.map((t) => `\`${t}\``)),
      ''
    )
  }

  if (
    opts.commonCauses &&
    check.commonCauses &&
    check.commonCauses.length > 0
  ) {
    sections.push(
      '## Common causes to consider',
      '',
      bullet(check.commonCauses),
      ''
    )
  }

  if (
    opts.relatedLinks &&
    check.relatedLinks &&
    check.relatedLinks.length > 0
  ) {
    sections.push(
      '## Related dashboards (this monitor)',
      '',
      formatLinks(appBase, check.relatedLinks, hostId),
      ''
    )
  }

  if (opts.docsLinks && check.docsLinks && check.docsLinks.length > 0) {
    sections.push(
      '## Documentation',
      '',
      formatDocs(check.docsLinks, opts.docsMarkdown),
      ''
    )
  }

  sections.push(
    '## Requested output',
    '',
    bullet([
      '1. A short summary of the most likely root cause given the observation.',
      '2. Three concrete SQL queries against the listed system tables to confirm or rule out causes.',
      '3. Step-by-step remediation actions, ordered from least disruptive to most disruptive.',
      '4. Any settings I should consider tuning (with safe ranges).',
      '5. What to monitor after the fix to confirm recovery.',
    ]),
    ''
  )

  return sections.join('\n')
}
