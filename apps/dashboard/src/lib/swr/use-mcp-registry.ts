/**
 * TanStack Query hooks for the per-user MCP server registry
 * (`/api/v1/mcp/servers`) plus the `/api/v1/mcp/probe` test-connection helper.
 *
 * Matches the codebase data-fetching pattern (apiFetch + useQuery/useMutation).
 * The list query and every mutation share one query key so mutations invalidate
 * the list. Secrets are write-only — they are POSTed but the server never
 * returns them (the DTO carries only `authKind` / `hasSecret`).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { apiFetch } from './api-fetch'

export type McpTransport = 'http' | 'sse'
export type McpAuthKind = 'none' | 'bearer' | 'header'

export interface McpRegistrationDto {
  id: string
  name: string
  url: string
  transport: McpTransport
  authKind: McpAuthKind
  authHeaderName: string | null
  hasSecret: boolean
  enabled: boolean
  capabilities: string[] | null
  lastValidatedAt: number | null
  createdAt: number
  updatedAt: number
}

const REGISTRY_KEY = ['/api/v1/mcp/servers'] as const

export class McpRegistryRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'McpRegistryRequestError'
  }
}

/** Parse the shared `{ success, data }` envelope; throw on non-2xx. */
async function parseEnvelope<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as {
    data?: T
    error?: { message?: string }
  } | null
  if (!res.ok) {
    throw new McpRegistryRequestError(
      body?.error?.message ?? `Request failed (${res.status})`,
      res.status
    )
  }
  return (body?.data ?? null) as T
}

export interface UseMcpRegistryResult {
  servers: McpRegistrationDto[]
  isLoading: boolean
  error: McpRegistryRequestError | null
  /** True when the registry is not enabled on this deployment (501). */
  notEnabled: boolean
}

export function useMcpRegistryServers(): UseMcpRegistryResult {
  const { data, isLoading, error } = useQuery<McpRegistrationDto[]>({
    queryKey: REGISTRY_KEY,
    queryFn: async () => {
      const res = await apiFetch('/api/v1/mcp/servers')
      return (await parseEnvelope<McpRegistrationDto[]>(res)) ?? []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const typedError = error instanceof McpRegistryRequestError ? error : null
  return {
    servers: data ?? [],
    isLoading,
    error: typedError,
    notEnabled: typedError?.status === 501,
  }
}

export interface CreateMcpServerInput {
  name: string
  url: string
  transport: McpTransport
  authKind: McpAuthKind
  authSecret?: string
  authHeaderName?: string
}

export function useCreateMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CreateMcpServerInput) => {
      const res = await apiFetch('/api/v1/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      return parseEnvelope<McpRegistrationDto & { validatedTools: string[] }>(
        res
      )
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: REGISTRY_KEY }),
  })
}

export function usePatchMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      id: string
      name?: string
      enabled?: boolean
    }) => {
      const res = await apiFetch('/api/v1/mcp/servers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
      return parseEnvelope<McpRegistrationDto>(res)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: REGISTRY_KEY }),
  })
}

export function useDeleteMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(
        `/api/v1/mcp/servers?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      )
      await parseEnvelope<{ id: string; deleted: boolean }>(res)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: REGISTRY_KEY }),
  })
}

export interface TestMcpConnectionInput {
  endpoint: string
  name?: string
  transport: McpTransport
  authKind: McpAuthKind
  authSecret?: string
  authHeaderName?: string
}

export interface TestMcpConnectionResult {
  status: 'connected' | 'error'
  toolCount: number
  tools: string[]
  error?: string
}

/** Probe an endpoint (test-before-save). Returns the advertised tools. */
export async function testMcpConnection(
  input: TestMcpConnectionInput
): Promise<TestMcpConnectionResult> {
  const res = await apiFetch('/api/v1/mcp/probe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  // The probe route returns the raw result shape (not the success envelope).
  const body = (await res.json().catch(() => null)) as
    | (TestMcpConnectionResult & { error?: string })
    | { error?: string }
    | null
  if (!res.ok) {
    const message =
      body && typeof body.error === 'string'
        ? body.error
        : `Test failed (${res.status})`
    throw new McpRegistryRequestError(message, res.status)
  }
  return body as TestMcpConnectionResult
}
