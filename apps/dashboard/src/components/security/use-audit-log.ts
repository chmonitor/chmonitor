/**
 * Audit-log subsystem for the RBAC management page.
 *
 * Operations executed in the browser are recorded in localStorage. Two hooks
 * split the two concerns:
 * - `useAuditLog` (page): records new entries and exposes a `revision` counter
 *   used to re-render the panel.
 * - `useAuditLogEntries` (panel): reads the stored entries once on mount and
 *   supports clearing them.
 */

import type { AuditEntry } from './types'

import { useCallback, useState } from 'react'

const AUDIT_LOG_KEY = 'chm-management-audit-log'
const AUDIT_LOG_MAX = 50

function readAuditLog(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(AUDIT_LOG_KEY)
    if (!raw) return []
    return JSON.parse(raw) as AuditEntry[]
  } catch {
    return []
  }
}

function writeAuditLog(entries: AuditEntry[]): void {
  try {
    localStorage.setItem(
      AUDIT_LOG_KEY,
      JSON.stringify(entries.slice(0, AUDIT_LOG_MAX))
    )
  } catch {
  }
}

function appendAuditEntry(entry: AuditEntry): void {
  const entries = readAuditLog()
  writeAuditLog([entry, ...entries])
}

/**
 * Page-level hook: records new audit entries and bumps a revision counter so
 * the audit-log panel re-renders after each operation.
 */
export function useAuditLog() {
  const [revision, setRevision] = useState(0)

  const record = useCallback((entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {
    appendAuditEntry({
      ...entry,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    })
    setRevision((r) => r + 1)
  }, [])

  return { revision, record }
}

/**
 * Panel-level hook: reads the stored entries once on mount and supports
 * clearing the log.
 */
export function useAuditLogEntries() {
  const [entries, setEntries] = useState<AuditEntry[]>(() => readAuditLog())

  const clear = useCallback(() => {
    writeAuditLog([])
    setEntries([])
  }, [])

  return { entries, clear }
}
