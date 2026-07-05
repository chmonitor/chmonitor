import { Check, ChevronsUpDown, Database } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { useState } from 'react'
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
import { apiFetch } from '@/lib/swr/api-fetch'
import { cn } from '@/lib/utils'

interface DatabasesResponse {
  data?: { name: string }[]
}

/**
 * Current-database picker for the SQL console.
 *
 * Selecting a database makes unqualified table names (`FROM events`) resolve
 * against it — the value is forwarded to the query API and threaded into the
 * ClickHouse client. "Default (server)" clears the override. Searchable because
 * a cluster can have many databases.
 */
export function DatabaseCombobox({
  hostId,
  value,
  onChange,
}: {
  hostId: number
  value?: string
  onChange: (database: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)

  const { data } = useQuery<DatabasesResponse>({
    queryKey: [`/api/v1/explorer/databases?hostId=${hostId}`],
    queryFn: async () => {
      const res = await apiFetch(`/api/v1/explorer/databases?hostId=${hostId}`)
      if (!res.ok) throw new Error(`Failed to load databases (${res.status})`)
      return res.json()
    },
    staleTime: 60_000,
  })

  const databases = data?.data ?? []

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label="Current database"
            className="gap-1.5 font-normal"
          />
        }
      >
        <Database className="size-3.5 opacity-70" />
        <span className="max-w-[140px] truncate">
          {value || 'Default database'}
        </span>
        <ChevronsUpDown className="size-3.5 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[240px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search database…" className="h-9" />
          <CommandList>
            <CommandEmpty>No database found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="Default server database"
                onSelect={() => {
                  onChange(undefined)
                  setOpen(false)
                }}
              >
                <Check
                  className={cn(
                    'mr-2 size-4',
                    !value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span className="text-muted-foreground">Default (server)</span>
              </CommandItem>
              {databases.map((db) => (
                <CommandItem
                  key={db.name}
                  value={db.name}
                  onSelect={() => {
                    onChange(db.name)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === db.name ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{db.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
