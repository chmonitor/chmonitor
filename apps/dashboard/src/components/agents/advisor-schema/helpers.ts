import type { TuningFindingsOutput } from '@/components/agents/tuning-findings-panel'
import type { DependencyType } from '@/components/explorer/dependency-graph/dependency-graph'

import { apiFetch } from '@/lib/swr/api-fetch'

export interface TuningApiResponse extends TuningFindingsOutput {
  success: true
}

interface TuningApiError {
  success: false
  error: string
}

export interface ApiResponse<T> {
  data: T
}

export function dependencyTypeLabel(type?: DependencyType): string {
  switch (type) {
    case 'dependency':
      return 'MV/View'
    case 'dictGet':
      return 'dictGet()'
    case 'joinGet':
      return 'joinGet()'
    case 'mv_target':
      return 'MV writes TO'
    case 'dict_source':
      return 'Dict source'
    case 'external':
      return 'External'
    default:
      return 'Related'
  }
}

export const fetchTuning = async (url: string): Promise<TuningApiResponse> => {
  const res = await apiFetch(url)
  const body = (await res.json()) as TuningApiResponse | TuningApiError
  if (!res.ok || !body.success) {
    throw new Error(
      (body as TuningApiError).error || `Scan failed (HTTP ${res.status})`
    )
  }
  return body
}

export const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await apiFetch(url)
  if (!res.ok) {
    throw new Error(`Request failed with status ${res.status}`)
  }
  return res.json() as Promise<T>
}
