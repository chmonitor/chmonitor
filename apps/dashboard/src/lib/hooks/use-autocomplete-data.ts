'use client'

import { useQuery } from '@tanstack/react-query'

import type { AutocompleteItem } from '@/components/agents/mentions/types'

import {
  SLASH_COMMANDS,
  SYSTEM_RESOURCES,
} from '@/components/agents/mentions/constants'
import { apiFetch } from '@/lib/swr/api-fetch'
import { useHostId } from '@/lib/swr/use-host'

// Sanitized autocomplete limit from environment
const AUTOCOMPLETE_LIMIT = (() => {
  const envLimit =
    typeof process !== 'undefined'
      ? import.meta.env.VITE_AUTOCOMPLETE_LIMIT
      : undefined
  const parsed = envLimit ? parseInt(envLimit, 10) : 500
  // Clamp between 1 and 1000, fallback to 500 if invalid
  if (Number.isNaN(parsed)) return 500
  return Math.max(1, Math.min(1000, parsed))
})()

interface TableRow {
  database: string
  name: string
  engine: string
  total_rows: string
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await apiFetch(url)
  if (!res.ok)
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

/**
 * Provides autocomplete items and related resources for UI typeahead controls.
 *
 * Produces mapped autocomplete lists for database tables and agent skills, returns static system resources and slash commands, and exposes the loading state of the tables request.
 *
 * @returns An object containing:
 * - `tables`: Array of autocomplete items for tables (group "Tables").
 * - `resources`: Static system resources.
 * - `skills`: Array of autocomplete items for agent skills (group "Skills").
 * - `commands`: Static slash commands.
 * - `isLoading`: `true` while the tables list is being fetched, `false` otherwise.
 */
export function useAutocompleteData() {
  const hostId = useHostId()

  // Lazy-load tables list (only fetched when hook is mounted = when @ is first used)
  const {
    data: tablesData,
    isPending: tablesPending,
    isFetching: tablesFetching,
  } = useQuery<{ data: TableRow[] }>({
    queryKey: ['/api/v1/tables', 'autocomplete', hostId, AUTOCOMPLETE_LIMIT],
    queryFn: () =>
      fetchJson<{ data: TableRow[] }>(
        `/api/v1/tables?hostId=${hostId}&limit=${AUTOCOMPLETE_LIMIT}`
      ),
    enabled: hostId != null,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const tables: AutocompleteItem[] = (tablesData?.data || []).map((row) => ({
    id: `table-${row.database}-${row.name}`,
    type: 'table' as const,
    label: `${row.database}.${row.name}`,
    description: `${row.engine} · ${row.total_rows || '0'} rows`,
    value: `${row.database}.${row.name}`,
    group: 'Tables',
  }))

  // Skills from agent tools metadata (static, loaded once)
  const { data: skillsData } = useQuery<{
    data: Array<{ name: string; description: string }>
  }>({
    queryKey: ['/api/v1/agent/skills'],
    queryFn: () =>
      fetchJson<{ data: Array<{ name: string; description: string }> }>(
        '/api/v1/agent/skills'
      ),
    staleTime: 300_000,
    refetchOnWindowFocus: false,
  })

  const skills: AutocompleteItem[] = (skillsData?.data || []).map((skill) => ({
    id: `skill-${skill.name}`,
    type: 'skill' as const,
    label: skill.name,
    description: skill.description,
    value: skill.name,
    group: 'Skills',
  }))

  return {
    tables,
    resources: SYSTEM_RESOURCES,
    skills,
    commands: SLASH_COMMANDS,
    // Match sibling hooks: only "loading" while a fetch is in flight, so the
    // disabled state (hostId == null) does not report a stuck loading state.
    isLoading: tablesPending && tablesFetching,
  }
}
