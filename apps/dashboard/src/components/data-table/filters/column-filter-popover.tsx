import { FilterIcon, XIcon } from 'lucide-react'

import type { FilterDraft } from '@/components/filters/filter-editor'
import type { ActiveFilter, FilterField } from '@/lib/filters/types'
import type { ColumnFilterDef } from '@/types/query-config'

import { pickColumnFilterOperator } from './column-filter-bridge'
import { useState } from 'react'
import { FilterEditor } from '@/components/filters/filter-editor'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface ColumnFilterPopoverProps {
  field: FilterField
  def: ColumnFilterDef
  configName: string
  activeFilter: ActiveFilter | null
  onSubmit: (draft: FilterDraft) => void
  onClear: () => void
}

/**
 * Filter icon in a column header that opens a popover with a typed value
 * editor. Reuses `FilterEditor` so date-range, multi-select, etc. behave
 * identically to the unified filter bar.
 */
export function ColumnFilterPopover({
  field,
  def,
  configName,
  activeFilter,
  onSubmit,
  onClear,
}: ColumnFilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const active = Boolean(activeFilter)

  const initial: FilterDraft | undefined = activeFilter
    ? { operator: activeFilter.operator, values: activeFilter.values }
    : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`Filter ${field.label}`}
            data-no-expand
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors',
              'hover:bg-accent hover:text-foreground',
              active && 'bg-primary/10 text-primary hover:bg-primary/20'
            )}
          />
        }
      >
        {active ? (
          <span className="size-1.5 rounded-full bg-current" aria-hidden />
        ) : (
          <FilterIcon className="size-3" aria-hidden />
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <FilterEditor
          field={{
            ...field,
            placeholder: def.placeholder ?? field.placeholder,
            operators: prioritizeOperator(field, def),
          }}
          configName={configName}
          initial={
            initial ?? {
              operator: pickColumnFilterOperator(def, field),
              values: [],
            }
          }
          onSubmit={(draft) => {
            onSubmit(draft)
            setOpen(false)
          }}
          onCancel={() => setOpen(false)}
        />
        {active && (
          <button
            type="button"
            onClick={() => {
              onClear()
              setOpen(false)
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <XIcon className="size-3" />
            Clear filter
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

/** Move the column-filter's preferred operator to the front of the list. */
function prioritizeOperator(
  field: FilterField,
  def: ColumnFilterDef
): FilterField['operators'] {
  const preferred = pickColumnFilterOperator(def, field)
  if (field.operators[0] === preferred) return field.operators
  const rest = field.operators.filter((op) => op !== preferred)
  return [preferred, ...rest] as FilterField['operators']
}
