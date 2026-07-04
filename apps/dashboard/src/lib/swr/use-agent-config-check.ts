/**
 * useAgentConfigCheck Hook
 *
 * Fetches the AI agent's LLM provider configuration status from
 * `GET /api/v1/agents/config-check` — which provider(s) have API keys
 * configured, the selected model's provider, and whether a base URL override
 * is set. Provider/model selection itself is set at deploy time via
 * environment variables (`LLM_MODEL`, `OPENROUTER_API_KEY`, etc.), so this is
 * read-only status, not an editable form.
 */

import { useQuery } from '@tanstack/react-query'

import { apiFetch } from './api-fetch'

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
    throw new Error(
      `Failed to fetch agent config check: ${response.statusText}`
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
