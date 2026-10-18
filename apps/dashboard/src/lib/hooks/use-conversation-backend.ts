'use client'

import type { ApiResponse } from '@/lib/api/types'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/swr/api-fetch'

export type ConversationBackendKind =
  | 'browser'
  | 'd1'
  | 'postgres'
  | 'memory'
  | 'agentstate'

export const CONVERSATION_BACKEND_LABELS: Record<
  ConversationBackendKind,
  string
> = {
  browser: 'Browser (localStorage)',
  d1: 'Cloudflare D1',
  postgres: 'PostgreSQL',
  memory: 'In-memory (ephemeral)',
  agentstate: 'AgentState',
}

interface ConversationBackendData {
  backend: ConversationBackendKind
  supportsAiEnrichment: boolean
}

export interface UseConversationBackendResult {
  backend: ConversationBackendKind
  supportsAiEnrichment: boolean
  isLoading: boolean
  error: Error | null
}

const FAIL_SAFE: ConversationBackendData = {
  backend: 'browser',
  supportsAiEnrichment: false,
}

// Backend is fixed at deploy time: fetched once per page load.
let cachedData: ConversationBackendData | null = null
let inFlight: Promise<ConversationBackendData> | null = null

async function fetchBackend(): Promise<ConversationBackendData> {
  if (cachedData) return cachedData
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const response = await apiFetch('/api/v1/conversations/backend')
      if (!response.ok) {
        throw new Error('Failed to fetch conversation backend')
      }
      const json =
        (await response.json()) as ApiResponse<ConversationBackendData>
      if (!json.success || !json.data) {
        throw new Error('Malformed conversation backend response')
      }
      cachedData = json.data
      return cachedData
    } catch {
      cachedData = FAIL_SAFE
      return cachedData
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

export function useConversationBackend(): UseConversationBackendResult {
  const [data, setData] = useState<ConversationBackendData | null>(
    () => cachedData
  )
  const [isLoading, setIsLoading] = useState(() => cachedData === null)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (cachedData) {
      setData(cachedData)
      setIsLoading(false)
      return
    }

    let cancelled = false
    setIsLoading(true)

    fetchBackend()
      .then((result) => {
        if (cancelled) return
        setData(result)
        setError(null)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setData(FAIL_SAFE)
        setError(err instanceof Error ? err : new Error(String(err)))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const resolved = data ?? FAIL_SAFE

  return {
    backend: resolved.backend,
    supportsAiEnrichment: resolved.supportsAiEnrichment,
    isLoading,
    error,
  }
}
