import type {
  ConnectionFormData,
  PeerdbAuthUi,
  TestStatus,
} from './connection-form-schema'

import { isValidUrl } from './connection-form-schema'
import { useState } from 'react'
import { apiFetch } from '@/lib/swr/api-fetch'

/**
 * Owns the optional "Advanced → PeerDB monitoring" state and request
 * lifecycle for `ConnectionForm`: the collapsible's open state, the API URL /
 * auth fields, the "Test PeerDB" call, and the derived validity + envelope
 * fields `ConnectionForm.handleSave` folds into the saved connection. `none`
 * auth means "no stored secret" (open flow-api); the secret is only kept for
 * `basic`/`bearer`. Extracted verbatim from `ConnectionForm`; behavior is
 * unchanged.
 */
export function usePeerdbConnection(
  initialValues: Partial<ConnectionFormData> | undefined,
  allowPeerdb: boolean
) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [peerdbApiUrl, setPeerdbApiUrl] = useState(
    initialValues?.peerdbApiUrl ?? ''
  )
  const [peerdbAuthUi, setPeerdbAuthUi] = useState<PeerdbAuthUi>(
    initialValues?.peerdbAuthScheme ?? 'none'
  )
  const [peerdbSecret, setPeerdbSecret] = useState(
    initialValues?.peerdbAuthSecret ?? ''
  )
  const [peerdbTest, setPeerdbTest] = useState<TestStatus>({ state: 'idle' })

  // Optional PeerDB monitoring link, folded into the saved envelope. Empty URL
  // (or the section not shown) ⇒ no PeerDB fields; `none` ⇒ URL only (open).
  const peerdbFields = (): Pick<
    ConnectionFormData,
    'peerdbApiUrl' | 'peerdbAuthScheme' | 'peerdbAuthSecret'
  > => {
    const url = peerdbApiUrl.trim()
    if (!allowPeerdb || !url) return {}
    if (peerdbAuthUi === 'none') return { peerdbApiUrl: url }
    return {
      peerdbApiUrl: url,
      peerdbAuthScheme: peerdbAuthUi,
      peerdbAuthSecret: peerdbSecret,
    }
  }

  const peerdbValid =
    !allowPeerdb || peerdbApiUrl.trim().length === 0
      ? true
      : isValidUrl(peerdbApiUrl.trim())

  const handleTestPeerdb = async () => {
    setPeerdbTest({ state: 'loading' })
    try {
      const response = await apiFetch('/api/v1/peerdb/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiUrl: peerdbApiUrl.trim(),
          ...(peerdbAuthUi === 'none'
            ? {}
            : { authScheme: peerdbAuthUi, secret: peerdbSecret }),
        }),
      })
      const json = (await response.json()) as {
        ok?: boolean
        version?: string
        error?: string
      }
      if (json.ok) {
        setPeerdbTest({
          state: 'success',
          message: json.version
            ? `Reached PeerDB ${json.version}`
            : 'Reached PeerDB',
        })
      } else {
        setPeerdbTest({
          state: 'error',
          message: json.error ?? 'PeerDB check failed',
        })
      }
    } catch (err) {
      setPeerdbTest({
        state: 'error',
        message: err instanceof Error ? err.message : 'Network error',
      })
    }
  }

  return {
    advancedOpen,
    setAdvancedOpen,
    peerdbApiUrl,
    setPeerdbApiUrl,
    peerdbAuthUi,
    setPeerdbAuthUi,
    peerdbSecret,
    setPeerdbSecret,
    peerdbTest,
    setPeerdbTest,
    peerdbFields,
    peerdbValid,
    handleTestPeerdb,
  }
}
