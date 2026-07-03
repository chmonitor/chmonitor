/**
 * CSV serialization for the audit export route.
 *
 * Deliberately self-contained (not layered on lib/csv.ts) because the export
 * has a fixed column set/order — event_time,user_id,event,resource,action,
 * result,ip — and needs formula-injection defusing on top of standard
 * comma/quote/newline escaping, which the shared chart/table CSV helper does
 * not do (and shouldn't gain here as an unrelated behavior change).
 */

import type { AuditLogRow } from './query'

export const AUDIT_CSV_HEADER =
  'event_time,user_id,event,resource,action,result,ip'

/**
 * Escape one field for CSV, defusing spreadsheet formula injection.
 *
 * A leading `=`, `+`, `-`, `@`, tab, or CR can make Excel/Sheets evaluate the
 * cell as a formula when the export is opened — prefixing with a single quote
 * forces text interpretation (the standard OWASP CSV-injection mitigation).
 * Applied uniformly to every field; harmless for values that don't start with
 * one of those characters (e.g. the server-generated ISO `event_time`).
 *
 * After defusing, standard CSV quoting applies: any comma, quote, or newline
 * wraps the field in quotes with embedded quotes doubled.
 */
function csvField(value: string | null | undefined): string {
  const raw = value ?? ''
  const defused = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  if (/["\n\r,]/.test(defused)) {
    return `"${defused.replace(/"/g, '""')}"`
  }
  return defused
}

/** Builds the full CSV (header + rows). Always includes the header, even for zero rows. */
export function buildAuditCsv(rows: readonly AuditLogRow[]): string {
  const lines = [AUDIT_CSV_HEADER]
  for (const row of rows) {
    lines.push(
      [
        row.event_time,
        row.user_id,
        row.event,
        row.resource,
        row.action,
        row.result,
        row.ip,
      ]
        .map(csvField)
        .join(',')
    )
  }
  return lines.join('\n')
}
