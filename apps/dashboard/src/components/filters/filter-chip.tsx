import { XIcon } from 'lucide-react'

import type { FilterDraft } from '@/components/filters/filter-editor'
import type { ActiveFilter, FilterField } from '@/lib/filters/types'

import { useState } from 'react'
import { FilterEditor } from '@/components/filters/filter-editor'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { OPERATORS } from '@/lib/filters/operators'

/** Human-readable summary of an active filter for its chip. */
export function formatFilterSummary(
  field: FilterField,
  filter: ActiveFilter
): { operatorLabel: string; valueText: string } {
  const operatorLabel = OPERATORS[filter.operator].label
  const { arity } = OPERATORS[filter.operator]

  if (filter.operator === 'withinHours') {
    const option = field.options?.find((o) => o.value === filter.values[0])
    return {
      operatorLabel,
      valueText: (option?.label ?? `${filter.values[0]} hours`).replace(
        /^Last\s+/i,
        ''
      ),
    }
  }

  let valueText: string
  if (arity === 2) {
    valueText = `${filter.values[0]} – ${filter.values[1]}`
  } else if (arity === 'multi') {
    valueText =
      filter.values.length > 2
        ? `${filter.values.length} selected`
        : filter.values.join(', ')
  } else {
    valueText = filter.values[0] ?? ''
  }

  if (field.unit && field.type === 'number') {
    valueText = `${valueText} ${field.unit}`
  }

  return { operatorLabel, valueText }
}

interface FilterChipProps {
  field: FilterField
  filter: ActiveFilter
  configName: string
  onChange: (draft: FilterDraft) => void
  onRemove: () => void
}

/** A single active filter, rendered as an editable, removable chip. */
export function FilterChip({
  field,
  filter,
  configName,
  onChange,
  onRemove,
}: FilterChipProps) {
  const [open, setOpen] = useState(false)
  const { operatorLabel, valueText } = formatFilterSummary(field, filter)
  const FieldIcon = field.icon

  return (
    <div className="inline-flex h-7 max-w-full items-center rounded-md border bg-card pl-2 pr-0.5 text-xs">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          }
        >
          {FieldIcon && (
            <FieldIcon className="size-3.5 text-muted-foreground" aria-hidden />
          )}
          <span className="font-medium">{field.label}</span>
          <span className="text-muted-foreground">{operatorLabel}</span>
          <span className="max-w-[120px] truncate font-semibold text-primary sm:max-w-[180px]">
            {valueText}
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <FilterEditor
            field={field}
            configName={configName}
            initial={{ operator: filter.operator, values: filter.values }}
            onSubmit={(draft) => {
              onChange(draft)
              setOpen(false)
            }}
            onCancel={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${field.label} filter`}
        className="ml-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <XIcon className="size-3" />
      </button>
    </div>
  )
}
