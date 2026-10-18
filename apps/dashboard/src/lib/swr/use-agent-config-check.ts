import { useQuery } from '@tanstack/react-query'

import { apiFetch } from './api-fetch'

/**
 * Thrown by {@link fetchAgentConfigCheck} on a non-2xx response, carrying the
 * HTTP status so callers can distinguish "not signed in" (401 — the `agent`
 * feature requires authentication and this deployment doesn't grant anonymous
 * read; expected for a signed-out visitor) from a genuine server error.
 */
export class AgentConfigCheckError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'AgentConfigCheckError'
  }
}

export interface AgentConfigCheckProvider {
  id: string
  name: string
  configured: boolean
  apiKeyEnvVar: string
  hasBaseURLOverride: boolean
  baseURL: string
}

export interface AgentConfigCheck {
  configured: {
    apiKey: boolean
    apiBase: boolean
  }
  isFullyConfigured: boolean
  requiredKeys: {
    apiKey: string
    apiBase: string
  }
  providers: AgentConfigCheckProvider[]
}

export interface AgentConfigCheckResult {
  data: AgentConfigCheck | undefined
  isLoading: boolean
  error: Error | undefined
}

async function fetchAgentConfigCheck(): Promise<AgentConfigCheck> {
  const response = await apiFetch('/api/v1/agents/config-check')
  if (!response.ok) {
    throw new AgentConfigCheckError(
      `Failed to fetch agent config check: ${response.statusText}`,
      response.status
    )
  }
  return response.json()
}

export function useAgentConfigCheck(): AgentConfigCheckResult {
  const { data, isLoading, error } = useQuery<AgentConfigCheck>({
    queryKey: ['/api/v1/agents/config-check'],
    queryFn: fetchAgentConfigCheck,
    staleTime: 300_000, // Cache for 5 minutes — deploy-time config rarely changes
    retry: 1,
  })

  return { data, isLoading, error: error ?? undefined }
}
