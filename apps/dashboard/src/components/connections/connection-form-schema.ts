import type { BrowserConnection } from '@/lib/types/browser-connection'

export type ConnectionFormData = Pick<
  BrowserConnection,
  | 'name'
  | 'host'
  | 'user'
  | 'password'
  | 'engine'
  | 'port'
  | 'database'
  | 'sslmode'
  | 'peerdbApiUrl'
  | 'peerdbAuthScheme'
  | 'peerdbAuthSecret'
>

/** UI value for the PeerDB auth selector; `none` maps to no stored secret. */
export type PeerdbAuthUi = 'none' | 'basic' | 'bearer'

/** libpq sslmodes surfaced in the Postgres preset's SSL dropdown. */
export const POSTGRES_SSLMODES = ['require', 'disable', 'verify-full'] as const

export interface TestStatus {
  state: 'idle' | 'loading' | 'success' | 'error'
  message?: string
}

export function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function isFormValid(
  data: ConnectionFormData,
  isPostgres: boolean
): boolean {
  const base = data.name.trim().length > 0 && data.user.trim().length > 0
  if (isPostgres) {
    // Postgres uses a bare hostname (not a URL) plus a required database.
    return (
      base &&
      (data.host ?? '').trim().length > 0 &&
      (data.database ?? '').trim().length > 0
    )
  }
  return base && isValidUrl((data.host ?? '').trim())
}
