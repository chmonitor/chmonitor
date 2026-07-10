import { SearchIcon, XIcon } from 'lucide-react'

import type { FilterDraft } from '@/components/filters/filter-editor'
import type { FilterPreset } from '@/lib/filters/types'
import type { QueryConfig } from '@/types/query-config'

import { AddFilterPopover } from '@/components/filters/add-filter-popover'
import { FilterChip } from '@/components/filters/filter-chip'
import { PresetsMenu } from '@/components/filters/presets-menu'
import { QuickFilters } from '@/components/filters/quick-filters'
import { DebouncedInput } from '@/components/inputs/debounced-input'
import { Button } from '@/components/ui/button'
import {
  parseFiltersFromParams,
  serializeFilter,
} from '@/lib/filters/url-state'
import { usePathname, useRouter, useSearchParams } from '@/lib/next-compat'

interface FilterBarProps {
  queryConfig: QueryConfig
}

/**
 * Schema-driven filter bar.
 *
 * Renders one chip per active filter, an "Add filter" picker, and any
 * one-click presets — all derived from `queryConfig.filterSchema`. Filter
 * state lives entirely in the URL so it is shareable and survives reloads.
 */
export function FilterBar({ queryConfig }: FilterBarProps) {
  const schema = queryConfig.filterSchema
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const activeFilters = schema
    ? parseFiltersFromParams(schema, searchParams)
    : []

  const updateParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString())
    mutate(params)
    const queryString = params.toString()
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, {
      scroll: false,
    })
  }

  const setFilter = (key: string, draft: FilterDraft) => {
    updateParams((params) =>
      params.set(key, serializeFilter({ key, ...draft }))
    )
  }

  const removeFilter = (key: string) => {
    const field = schema?.fields.find((f) => f.key === key)
    updateParams((params) => {
      // An explicit empty value overrides a field's default; otherwise drop.
      if (field?.defaultValue) params.set(key, '')
      else params.delete(key)
    })
  }

  const clearAll = () => {
    updateParams((params) => {
      params.delete('q')
      schema?.fields.forEach((field) => {
        if (field.defaultValue) params.set(field.key, '')
        else params.delete(field.key)
      })
    })
  }

  const applyPreset = (preset: FilterPreset) => {
    updateParams((params) => {
      preset.filters.forEach((filter) => {
        params.set(
          filter.key,
          serializeFilter({
            key: filter.key,
            operator: filter.operator,
            values: [filter.value],
          })
        )
      })
    })
  }

  const fieldByKey = new Map(
    schema?.fields.map((field) => [field.key, field]) ?? []
  )

  if (!schema) return null

  const activeKeys = activeFilters.map((filter) => filter.key)
  const hasPresets = Boolean(schema.presets && schema.presets.length > 0)
  const hasQuickFilters = Boolean(
    schema.quickFilters && schema.quickFilters.length > 0
  )

  const searchValue = searchParams.get('q') ?? ''

  return (
    <>
      {/* Search input */}
      <div className="relative flex h-8 min-w-[160px] flex-1 items-center gap-1.5 rounded-lg border border-border/50 bg-muted/20 px-2.5 sm:w-64 sm:flex-none md:w-72 shadow-none">
        <SearchIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <DebouncedInput
          value={searchValue}
          onValueChange={(value) => {
            updateParams((params) => {
              if (value.trim()) params.set('q', value.trim())
              else params.delete('q')
            })
          }}
          placeholder="Search queries..."
          className="h-8 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0 focus:bg-background focus:border-primary/50 placeholder:text-muted-foreground/50 transition-all"
          debounceMs={300}
        />
        {searchValue && (
          <button
            type="button"
            onClick={() => updateParams((params) => params.delete('q'))}
            className="text-muted-foreground hover:text-foreground shrink-0 rounded p-0.5"
            aria-label="Clear search"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>

      {/* Quick filters: always-visible inline controls */}
      {hasQuickFilters && (
        <QuickFilters
          configs={schema.quickFilters ?? []}
          activeFilters={activeFilters}
          onSetFilter={setFilter}
        />
      )}

      {activeFilters.map((filter) => {
        const field = fieldByKey.get(filter.key)
        if (!field) return null
        return (
          <FilterChip
            key={filter.key}
            field={field}
            filter={filter}
            configName={queryConfig.name}
            onChange={(draft) => setFilter(filter.key, draft)}
            onRemove={() => removeFilter(filter.key)}
          />
        )
      })}

      {hasPresets && (
        <PresetsMenu presets={schema.presets ?? []} onApply={applyPreset} />
      )}

      <AddFilterPopover
        schema={schema}
        activeKeys={activeKeys}
        configName={queryConfig.name}
        onAdd={setFilter}
      />

      {activeFilters.length > 0 && (
        <Button
          variant="ghost"
          className="text-xs text-muted-foreground"
          onClick={clearAll}
        >
          Clear all
        </Button>
      )}
    </>
  )
}
