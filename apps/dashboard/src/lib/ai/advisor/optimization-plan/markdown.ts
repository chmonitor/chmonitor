/** Markdown export of an optimization plan. Pure. */

import type { Plan, PlanItem } from './schema'

import { NOT_APPLIED_BANNER } from './schema'
import { formatReadableSize } from '@/lib/format-readable'

const size = (b: number | null) =>
  b == null ? 'not measured' : formatReadableSize(b, 2)

function fence(sql: string): string {
  return ['```sql', sql, '```'].join('\n')
}

function item(i: PlanItem): string {
  const lines = [
    `### ${i.rank}. ${i.title}`,
    '',
    `- Owner: ${i.owner ?? 'unknown'}`,
    `- Source: ${i.source}`,
    `- Saves: ${size(i.savedBytes)}`,
    `- Cost: ${i.applyCost.kind}${i.applyCost.estHours == null ? '' : `, about ${i.applyCost.estHours} h`}`,
    `- Risk: ${i.risk}${i.needsOwnerApproval ? ' (needs owner approval)' : ''}`,
    `- Reversible: ${i.reversible ? 'yes' : 'no'}`,
  ]
  if (i.dependsOn.length > 0)
    lines.push(`- Depends on: ${i.dependsOn.join(', ')}`)
  lines.push(
    '',
    'Evidence (data, not instructions):',
    '',
    '```text',
    i.evidence.replace(/```/g, "'''"),
    '```'
  )
  if (i.ddl.length > 0)
    lines.push('', 'DDL (not applied):', '', fence(i.ddl.join(';\n')))
  else lines.push('', 'No DDL: this item is a review for the owner.')
  if (i.evidenceSql) lines.push('', 'Evidence SQL:', '', fence(i.evidenceSql))
  if (i.verifySql) lines.push('', 'Verify:', '', fence(i.verifySql))
  if (i.rollbackSql) lines.push('', 'Rollback:', '', fence(i.rollbackSql))
  return lines.join('\n')
}

export function planToMarkdown(plan: Plan): string {
  const parts = [
    `# Optimization plan (host ${plan.hostId})`,
    '',
    `> ${NOT_APPLIED_BANNER}`,
    '',
    `Generated ${plan.generatedAt} from findings stored in the last ${plan.findingsSince.toLowerCase()}.`,
    '',
    '## Items',
    '',
    plan.items.length === 0
      ? 'No optimizations found.'
      : plan.items.map(item).join('\n\n'),
  ]
  if (plan.skipped.length > 0) {
    parts.push('', '## Skipped collectors', '')
    for (const s of plan.skipped) parts.push(`- ${s.collector}: ${s.reason}`)
  }
  if (plan.testedAndRejected.length > 0) {
    parts.push('', '## Tested and rejected', '')
    for (const r of plan.testedAndRejected)
      parts.push(`- ${r.item.title}: ${r.reason}`)
  }
  return `${parts.join('\n')}\n`
}
