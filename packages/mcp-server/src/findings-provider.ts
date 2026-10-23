/**
 * Injection point for the app-owned health findings source.
 *
 * Current findings come from the dashboard's alert-rule registry, which this
 * package cannot import (dependency-cruiser `no-packages-to-apps`). The
 * in-process route registers the provider once; the standalone Worker never
 * does, so the tool answers with a clear "not available" error there.
 */

export interface ProvidedFinding {
  hostId: number
  hostName: string
  ruleId: string
  title: string
  severity: 'warning' | 'critical'
  value: number | null
  label: string
}

export type FindingsProvider = (options: {
  hostId: number
}) => Promise<ProvidedFinding[]>

let provider: FindingsProvider | null = null

export function setFindingsProvider(next: FindingsProvider | null): void {
  provider = next
}

export function getFindingsProvider(): FindingsProvider | null {
  return provider
}
