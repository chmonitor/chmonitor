'use client'

import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/swr/api-fetch'

export type InsightsBackendKind =
  | 'clickhouse'
  | 'd1'
  | 'postgres'
  | 'agentstate'
  | 'memory'

export const INSIGHTS_BACKEND_LABELS: Record<InsightsBackendKind, string> = {
  clickhouse: 'ClickHouse (cluster)',
  d1: 'Cloudflare D1',
  postgres: 'PostgreSQL',
  agentstate: 'AgentState',
  memory: 'In-memory (ephemeral)',
}

interface InsightsBackendData {
  backend: InsightsBackendKind
}

export interface UseInsightsBackendResult {
  backend: InsightsBackendKind
  isLoading: boolean
  error: Error | null
}

const FAIL_SAFE: InsightsBackendData = { backend: 'clickhouse' }

const VALID = new Set<InsightsBackendKind>([
  'clickhouse',
  'd1',
  'postgres',
  'agentstate',
  'memory',
])

// Backend is fixed at deploy time: fetched once per page load.
let cachedData: InsightsBackendData | null = null
let inFlight: Promise<InsightsBackendData> | null = null

async function fetchBackend(): Promise<InsightsBackendData> {
  if (cachedData) return cachedData
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const response = await apiFetch('/api/v1/insights/backend')
      if (!response.ok) throw new Error('Failed to fetch insights backend')
      const json = (await response.json()) as { backend?: string }
      const backend = json.backend as InsightsBackendKind
      if (!backend || !VALID.has(backend)) {
        throw new Error('Malformed insights backend response')
      }
      // Cache only a real success, so the backend is fetched once for the page.
      cachedData = { backend }
      return cachedData
    } catch {
      // Do NOT cache the fail-safe: a transient error (offline, deploy blip)
      // must not permanently pin the UI to 'clickhouse'. Leave cachedData null
      // so the next mount retries; return the fail-safe for this call only.
      return FAIL_SAFE
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

export function useInsightsBackend(): UseInsightsBackendResult {
  const [state, setState] = useState<UseInsightsBackendResult>({
    backend: cachedData?.backend ?? 'clickhouse',
    isLoading: cachedData === null,
    error: null,
  })

  useEffect(() => {
    if (cachedData) {
      setState({ backend: cachedData.backend, isLoading: false, error: null })
      return
    }

    let active = true
    fetchBackend().then((data) => {
      if (active) {
        setState({ backend: data.backend, isLoading: false, error: null })
      }
    })
    return () => {
      active = false
    }
  }, [])

  return state
}

// Test-only: clear the module cache so the next mount refetches.
export function __resetInsightsBackendCache(): void {
  cachedData = null
  inFlight = null
}
