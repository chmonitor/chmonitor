import { ListFilterIcon, XIcon } from 'lucide-react'

import type { ArrayElement } from '@chm/types/generic'
import type { QueryConfig } from '@/types/query-config'

import { useFilterState } from './hooks/use-filter-state'
import { getFilterToggleHref } from './utils/filter-url-builder'
import { AppLink as Link } from '@/components/ui/app-link'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { usePathname } from '@/lib/next-compat'
import { cn } from '@/lib/utils'

interface DataTableFacetedFilterProps {
  title?: string
  queryConfig: QueryConfig
}

/**
 * Faceted filter dropdown for data tables
 *
 * Displays filter options based on queryConfig presets and URL params.
 * Shows active filter count and provides clear all option.
 */
export function DataTableFacetedFilter({
  title,
  queryConfig,
}: DataTableFacetedFilterProps) {
  const pathname = usePathname()
  const { filterParamPresets = [], defaultParams = {} } = queryConfig

  const { selected, filters, selectedCount } = useFilterState({
    filterParamPresets,
    defaultParams,
  })

  if (!filters.length) return null

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            data-is-activate={selectedCount > 0}
            className="data-[is-activate=true]:bg-accent"
          />
        }
      >
        <ListFilterIcon className="mr-2 size-4" />
        {title}
        {selectedCount > 0 && ` (${selectedCount})`}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-fit min-w-[170px]">
        {filters.map(({ name, key, value, ...preset }) => (
          <FilterMenuItem
            key={key + value}
            name={name}
            value={value}
            isSelected={selected.get(key) === value}
            href={getFilterToggleHref(
              pathname,
              selected,
              key,
              value,
              defaultParams
            )}
            icon={preset?.icon}
          />
        ))}

        {selectedCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <Link
                href={pathname}
                className="flex flex-row content-between items-center gap-1"
              >
                <XIcon className="size-4" />
                Clear filters
              </Link>
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface FilterMenuItemProps
  extends ArrayElement<NonNullable<QueryConfig['filterParamPresets']>> {
  isSelected: boolean
  href: string
}

/**
 * Individual filter menu item with icon and selection state
 */
const FilterMenuItem = function FilterMenuItem({
  name,
  isSelected,
  href,
  icon: Icon,
}: FilterMenuItemProps) {
  return (
    <DropdownMenuItem>
      <a
        href={href}
        data-selected={isSelected}
        className={cn(
          'flex flex-row content-between items-center gap-3',
          'data-[selected=true]:font-bold'
        )}
      >
        {Icon && <Icon className="text-muted-foreground mr-2 size-4" />}
        <span>{name}</span>
      </a>
    </DropdownMenuItem>
  )
}
