'use client'

import { Database, Slash, Terminal, Zap } from 'lucide-react'

import type { AutocompleteItem } from './types'

import { createPortal } from 'react-dom'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

interface AutocompletePopoverProps {
  open: boolean
  trigger: '@' | '/' | null
  query: string
  anchor: { top: number; left: number } | null
  items: AutocompleteItem[]
  selectedIndex: number
  onSelect: (item: AutocompleteItem) => void
  onClose: () => void
}

function ItemIcon({ type }: { type: AutocompleteItem['type'] }) {
  switch (type) {
    case 'table':
    case 'database':
      return <Database className="size-3.5 shrink-0 text-[var(--chart-blue)]" />
    case 'resource':
      return (
        <Terminal className="size-3.5 shrink-0 text-[var(--chart-green)]" />
      )
    case 'skill':
      return <Zap className="size-3.5 shrink-0 text-[var(--chart-1)]" />
    case 'command':
      return <Slash className="size-3.5 shrink-0 text-[var(--chart-3)]" />
    default:
      return null
  }
}

// Group items by their group field while preserving insertion order of groups
function groupItems(
  items: AutocompleteItem[]
): Map<string, AutocompleteItem[]> {
  const groups = new Map<string, AutocompleteItem[]>()
  for (const item of items) {
    const existing = groups.get(item.group)
    if (existing) {
      existing.push(item)
    } else {
      groups.set(item.group, [item])
    }
  }
  return groups
}

export function AutocompletePopover({
  open,
  anchor,
  items,
  selectedIndex,
  onSelect,
  onClose,
}: AutocompletePopoverProps) {
  if (!open || !anchor || typeof window === 'undefined') return null

  const visible = items.slice(0, 50)
  const grouped = groupItems(visible)

  // Build a flat index map to match selectedIndex across groups
  let flatIndex = 0
  const indexedItems: { item: AutocompleteItem; flatIdx: number }[] = []
  for (const groupItems of grouped.values()) {
    for (const item of groupItems) {
      indexedItems.push({ item, flatIdx: flatIndex++ })
    }
  }

  const popover = (
    <div
      style={{
        position: 'fixed',
        bottom:
          typeof window !== 'undefined'
            ? window.innerHeight - anchor.top + 4
            : 0,
        left: anchor.left,
        zIndex: 9999,
      }}
      // Stop pointer events from bubbling to textarea (e.g. focus loss)
      onMouseDown={(e) => e.preventDefault()}
    >
      <Command
        shouldFilter={false}
        className="w-72 rounded-lg border bg-popover shadow-md"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <CommandList className="max-h-[300px]">
          {visible.length === 0 && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}
          {Array.from(grouped.entries()).map(([groupName, groupItems]) => (
            <CommandGroup key={groupName} heading={groupName}>
              {groupItems.map((item) => {
                const currentFlat = indexedItems.find(
                  (x) => x.item.id === item.id
                )?.flatIdx
                const isSelected = currentFlat === selectedIndex

                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => onSelect(item)}
                    data-selected={isSelected ? 'true' : undefined}
                    className="flex cursor-pointer items-start gap-2 py-2"
                  >
                    <span className="mt-0.5">
                      <ItemIcon type={item.type} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {item.label}
                      </span>
                      {item.description && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  )

  return createPortal(popover, document.body)
}
