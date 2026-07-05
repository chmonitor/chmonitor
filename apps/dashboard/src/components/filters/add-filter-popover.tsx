import { PlusIcon } from 'lucide-react'

import type { FilterDraft } from '@/components/filters/filter-editor'
import type { FilterField, FilterSchema } from '@/lib/filters/types'

import { useState } from 'react'
import { FilterEditor } from '@/components/filters/filter-editor'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface AddFilterPopoverProps {
  schema: FilterSchema
  activeKeys: string[]
  configName: string
  onAdd: (key: string, draft: FilterDraft) => void
}

/** Two-step popover: pick a field, then edit its filter condition. */
export function AddFilterPopover({
  schema,
  activeKeys,
  configName,
  onAdd,
}: AddFilterPopoverProps) {
  const [open, setOpen] = useState(false)
  const [selectedField, setSelectedField] = useState<FilterField | null>(null)

  const availableFields = schema.fields.filter(
    (field) => !activeKeys.includes(field.key)
  )

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) setSelectedField(null)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-dashed rounded-lg"
          />
        }
      >
        <PlusIcon className="size-3.5" />
        Add filter
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {selectedField ? (
          <div className="p-3">
            <FilterEditor
              field={selectedField}
              configName={configName}
              onSubmit={(draft) => {
                onAdd(selectedField.key, draft)
                handleOpenChange(false)
              }}
              onCancel={() => setSelectedField(null)}
            />
          </div>
        ) : (
          <Command className="w-56">
            <CommandInput placeholder="Filter by..." className="h-9" />
            <CommandList>
              <CommandEmpty>All filters are active</CommandEmpty>
              <CommandGroup>
                {availableFields.map((field) => {
                  const FieldIcon = field.icon
                  return (
                    <CommandItem
                      key={field.key}
                      value={field.label}
                      onSelect={() => setSelectedField(field)}
                    >
                      {FieldIcon && (
                        <FieldIcon className="size-4 text-muted-foreground" />
                      )}
                      {field.label}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  )
}
