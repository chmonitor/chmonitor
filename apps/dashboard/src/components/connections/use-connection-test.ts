import type { ConnectionFormData, TestStatus } from './connection-form-schema'

import { POSTGRES_DEFAULT_PORT } from './connection-presets'
import { useState } from 'react'
import { extractConnectionErrorMessage } from '@/lib/connection-errors'
import { apiFetch } from '@/lib/swr/api-fetch'
import {
  detectChFlavor,
  getDeployTarget,
  parseMajorMinor,
  track,
} from '@/lib/telemetry'

/**
 * Owns the "Test connection" request lifecycle for `ConnectionForm` — pending
 * / result / error state and the call into `lib/connection-errors.ts`
 * (`extractConnectionErrorMessage`). Kept separate from `ConnectionForm` so
 * the classifier integration is testable and reviewable on its own; behavior
 * is unchanged from the inline version it replaced.
 */
export function useConnectionTest(
  form: ConnectionFormData,
  isPostgres: boolean
) {
  const [testStatus, setTestStatus] = useState<TestStatus>({ state: 'idle' })

  const resetTestStatus = () => {
    if (testStatus.state !== 'idle') {
      setTestStatus({ state: 'idle' })
    }
  }

  const handleTest = async () => {
    setTestStatus({ state: 'loading' })
    try {
      const response = await apiFetch('/api/v1/browser-connections/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isPostgres
            ? {
                engine: 'postgres',
                host: form.host.trim(),
                port: form.port ?? POSTGRES_DEFAULT_PORT,
                user: form.user.trim(),
                password: form.password,
                database: (form.database ?? '').trim(),
                sslmode: form.sslmode,
              }
            : {
                host: form.host.trim(),
                user: form.user.trim(),
                password: form.password,
              }
        ),
      })
      const json = (await response.json()) as {
        ok?: boolean
        version?: string
        error?: string
      }
      if (json.ok) {
        setTestStatus({
          state: 'success',
          message: json.version
            ? `Connected — ${isPostgres ? 'Postgres' : 'ClickHouse'} ${json.version}`
            : 'Connected',
        })
        // ClickHouse-specific version telemetry; skip for Postgres.
        if (!isPostgres) {
          track('cluster_connected', {
            deploy_target: getDeployTarget(),
            ch_version: parseMajorMinor(json.version),
            ch_flavor: detectChFlavor(json.version),
          })
        }
      } else {
        setTestStatus({
          state: 'error',
          message: extractConnectionErrorMessage(json),
        })
      }
    } catch (err) {
      setTestStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  return { testStatus, resetTestStatus, handleTest }
}
