import type { QueryConfig } from '@/types/query-config'

import { useUrlSearchParams } from '@/hooks/use-url-search-params'

interface UseFilterStateOptions {
  filterParamPresets?: QueryConfig['filterParamPresets']
  defaultParams?: QueryConfig['defaultParams']
}

interface FilterState {
  selected: URLSearchParams
  filters: NonNullable<QueryConfig['filterParamPresets']>
  selectedCount: number
}

export function useFilterState({
  filterParamPresets = [],
  defaultParams = {},
}: UseFilterStateOptions): FilterState {
  const searchParams = useUrlSearchParams()

  const selected = (() => {
    const params = new URLSearchParams(searchParams)

    Object.entries(defaultParams).forEach(([key, value]) => {
      if (value !== '' && !params.has(key)) {
        params.set(key, value as string)
      }
    })

    return params
  })()

  const filters = ((): NonNullable<QueryConfig['filterParamPresets']> => {
    const filterNotFromPreset = Object.keys(defaultParams)
      .filter((key) => selected.has(key))
      .filter((key) => {
        const presetValue = filterParamPresets.find(
          (preset) => preset.key === key
        )?.value
        return selected.get(key) !== presetValue
      })
      .map((key) => ({
        key,
        name: selected.get(key)
          ? filterParamPresets.find((preset) => preset.key === key)?.name
          : `${key} = N/A`,
        value: selected.get(key),
      })) as NonNullable<QueryConfig['filterParamPresets']>

    return [...filterParamPresets, ...filterNotFromPreset]
  })()

  const selectedCount = filters.filter(
    (filter) =>
      selected.has(filter.key) && selected.get(filter.key) === filter.value
  ).length

  return {
    selected,
    filters,
    selectedCount,
  }
}
