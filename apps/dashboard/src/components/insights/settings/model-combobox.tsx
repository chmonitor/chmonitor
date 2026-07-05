'use client'

/**
 * Searchable, provider-grouped model combobox for the insights settings form.
 *
 * Extracted from `insights-settings-form.tsx`. Groups the available models by
 * provider (preserving order), filters across name/provider/id on search, and
 * exposes a "Default" option (`value === null`).
 */

import { Check, ChevronDown } from 'lucide-react'

import type { ModelDisplayInfo } from '@/lib/hooks/use-agent-model'

import { ProviderIcon } from './provider-icon'
import { useState } from 'react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export const DEFAULT_MODEL_VALUE = '__default__'

export function ModelCombobox({
  value,
  models,
  defaultModelLabel,
  disabled,
  onValueChange,
}: {
  value: string | null
  models: readonly ModelDisplayInfo[]
  defaultModelLabel: string | undefined
  disabled?: boolean
  onValueChange: (value: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Group by provider; preserve the provider ordering from the models array.
  const grouped = new Map<string, ModelDisplayInfo[]>()
  for (const m of models) {
    const list = grouped.get(m.provider) ?? []
    list.push(m)
    grouped.set(m.provider, list)
  }

  // Filter across all models when the user searches.
  const needle = search.toLowerCase()
  const filteredGroups: Array<[string, ModelDisplayInfo[]]> = Array.from(
    grouped.entries()
  )
    .map(([provider, list]): [string, ModelDisplayInfo[]] => [
      provider,
      list.filter(
        (m) =>
          !needle ||
          m.name.toLowerCase().includes(needle) ||
          m.provider.toLowerCase().includes(needle) ||
          m.id.toLowerCase().includes(needle)
      ),
    ])
    .filter(([, list]) => list.length > 0)

  const defaultMatches =
    !needle ||
    'default'.includes(needle) ||
    (defaultModelLabel?.toLowerCase() ?? '').includes(needle)

  const currentModel = value ? models.find((m) => m.id === value) : null

  const triggerLabel = currentModel ? currentModel.name : 'Default'

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-label="Model"
            disabled={disabled}
            className={cn(
              'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs ring-offset-background',
              'placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'hover:bg-accent/40 transition-colors'
            )}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {currentModel ? (
            <>
              <ProviderIcon
                provider={currentModel.provider}
                className="shrink-0 text-muted-foreground"
              />
              <span className="truncate font-mono text-xs">{triggerLabel}</span>
              {currentModel.isFree && (
                <span className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  free
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{triggerLabel}</span>
          )}
        </span>
        <ChevronDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" />
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="start" sideOffset={4}>
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search models…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-64">
            <CommandEmpty>No models found.</CommandEmpty>

            {/* Default option */}
            {defaultMatches && (
              <CommandGroup>
                <CommandItem
                  value={DEFAULT_MODEL_VALUE}
                  onSelect={() => {
                    onValueChange(null)
                    setOpen(false)
                    setSearch('')
                  }}
                  className="gap-2"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {value === null && <Check className="size-3" />}
                  </span>
                  <span className="flex-1">
                    <span className="text-sm">Default</span>
                    {defaultModelLabel && (
                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                        {defaultModelLabel}
                      </span>
                    )}
                  </span>
                </CommandItem>
              </CommandGroup>
            )}

            {filteredGroups.map(([provider, list], idx) => (
              <span key={provider}>
                {(defaultMatches || idx > 0) && <CommandSeparator />}
                <CommandGroup
                  heading={
                    <span className="flex items-center gap-1.5">
                      <ProviderIcon
                        provider={provider}
                        className="text-muted-foreground"
                        size={11}
                      />
                      <span className="capitalize">{provider}</span>
                    </span>
                  }
                >
                  {list.map((m) => (
                    <CommandItem
                      key={m.id}
                      value={m.id}
                      onSelect={() => {
                        onValueChange(m.id)
                        setOpen(false)
                        setSearch('')
                      }}
                      className="gap-2"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {value === m.id && <Check className="size-3" />}
                      </span>
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <ProviderIcon
                          provider={m.provider}
                          className="shrink-0 text-muted-foreground"
                        />
                        <span className="truncate font-mono text-xs">
                          {m.name}
                        </span>
                        {m.isFree && (
                          <span className="ml-auto shrink-0 rounded px-1 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            free
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </span>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
