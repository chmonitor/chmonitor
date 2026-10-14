/**
 * useMcpServerInfo Hook
 *
 * Fetches MCP server information including available tools and resources.
 * Includes retry logic with exponential backoff for transient errors.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query'

import type {
  McpResource,
  McpServerInfo,
  McpTool,
  McpToolCategory,
  McpToolParam,
} from '@chm/mcp-server/data'

import { apiFetch } from './api-fetch'

export interface ApiMcpTool {
  name: string
  description: string
  category: McpToolCategory
  params: McpToolParam[]
}

export interface ApiMcpServerInfo {
  name: string
  version: string
  description: string
  tools: ApiMcpTool[]
  resources: McpResource[]
}

export interface McpServerInfoResult {
  data: ApiMcpServerInfo | undefined
  isLoading: boolean
  error: Error | undefined
  retry: () => void
}

async function fetchMcpServerInfo(): Promise<ApiMcpServerInfo> {
  const response = await apiFetch('/api/v1/mcp/info')
  if (!response.ok) {
    throw new Error(`Failed to fetch MCP info: ${response.statusText}`)
  }
  return response.json()
}

/**
 * Hook to fetch MCP server information with retry support
 *
 * @returns Object with server info, loading/error states, and retry function
 *
 * @example
 * ```tsx
 * const { data, isLoading, error, retry } = useMcpServerInfo()
 *
 * if (isLoading) return <Skeleton />
 * if (error) {
 *   return (
 *     <div>
 *       <ErrorAlert error={error} />
 *       <Button onClick={retry}>Retry</Button>
 *     </div>
 *   )
 * }
 * if (!data) return null
 *
 * return (
 *   <div>
 *     <h4>{data.name} v{data.version}</h4>
 *     <p>{data.description}</p>
 *     {/* Display tools and resources *\/}
 *   </div>
 * )
 * ```
 */
export function useMcpServerInfo(): McpServerInfoResult {
  const queryClient = useQueryClient()
  const queryKey = ['/api/v1/mcp/info']
  const { data, isLoading, error } = useQuery<ApiMcpServerInfo>({
    queryKey,
    queryFn: fetchMcpServerInfo,
    refetchInterval: false,
    staleTime: 300_000, // Cache for 5 minutes
    retry: 3,
  })

  const retry = () => {
    queryClient.invalidateQueries({ queryKey })
  }

  return {
    data,
    isLoading,
    error: error ?? undefined,
    retry,
  }
}

// Re-export types from mcp-tools-data.ts for convenience
export type { McpTool, McpResource, McpServerInfo }
