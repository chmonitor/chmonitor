/**
 * useConfirmFlow — local state machine for the preview → confirm → execute
 * pattern shared by every RBAC management operation.
 */

import type { ApiResponse, AuditEntry, ManagementOperation } from './types'

import { useState } from 'react'
import { apiFetch } from '@/lib/swr/api-fetch'

async function executeOperation(
  operation: ManagementOperation,
  params: Record<string, unknown>,
  hostId: number
): Promise<ApiResponse> {
  const res = await apiFetch(`/api/v1/management?hostId=${hostId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, params }),
  })
  return res.json() as Promise<ApiResponse>
}

export function useConfirmFlow(
  operation: ManagementOperation,
  buildDdl: () => string | null,
  getParams: () => Record<string, unknown>,
  hostId: number,
  onSuccess: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void
) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [previewDdl, setPreviewDdl] = useState('')
  const [pending, setPending] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [statusIsError, setStatusIsError] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  function handlePreview() {
    setValidationError(null)
    const ddl = buildDdl()
    if (ddl === null) return // buildDdl sets validationError if invalid
    setPreviewDdl(ddl)
    setStatusMessage(null)
    setStatusIsError(false)
    setDialogOpen(true)
  }

  async function handleExecute() {
    setPending(true)
    setStatusMessage(null)
    const params = getParams()
    try {
      const result = await executeOperation(operation, params, hostId)
      if (result.success) {
        setStatusMessage(result.message)
        setStatusIsError(false)
        onSuccess({ operation, ddl: previewDdl, success: true, hostId })
        setTimeout(() => setDialogOpen(false), 1200)
      } else {
        setStatusMessage(result.error)
        setStatusIsError(true)
        onSuccess({
          operation,
          ddl: previewDdl,
          success: false,
          error: result.error,
          hostId,
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setStatusMessage(msg)
      setStatusIsError(true)
      onSuccess({
        operation,
        ddl: previewDdl,
        success: false,
        error: msg,
        hostId,
      })
    } finally {
      setPending(false)
    }
  }

  return {
    dialogOpen,
    previewDdl,
    pending,
    statusMessage,
    statusIsError,
    validationError,
    setValidationError,
    handlePreview,
    handleExecute,
    handleCancel: () => setDialogOpen(false),
  }
}
