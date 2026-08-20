import { Check, ChevronsUpDown } from 'lucide-react'

import type { ComparePeer } from '@/lib/compare/scope'

import { useMemo, useState } from 'react'
import { HostMenuRow } from '@/components/host/host-menu-row'
import { HostVersionWithStatus } from '@/components/host/host-version-status'
import { ChmonitorLogo } from '@/components/icons/chmonitor-logo'
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
import { isServerHost, useMergedHosts } from '@/lib/swr/use-merged-hosts'
import { cn } from '@/lib/utils'

interface ComparePeerSelectProps {
  label: string
  testId: string
  value: number
  hosts: ComparePeer[]
  onChange: (next: number) => void
}

export function ComparePeerSelect({
  label,
  testId,
  value,
  hosts,
  onChange,
}: ComparePeerSelectProps) {
  const [open, setOpen] = useState(false)
  const { hosts: merged } = useMergedHosts()
  const selected = hosts.find((h) => h.id === value) ?? hosts[0]
  const mergedSelected = merged.find((h) => h.id === value)
  const showLiveStatus = Boolean(
    mergedSelected && isServerHost(mergedSelected.source)
  )

  const sorted = useMemo(
    () => [...hosts].sort((a, b) => a.name.localeCompare(b.name)),
    [hosts]
  )

  return (
    <label className="flex min-w-56 flex-1 flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="outline"
              role="combobox"
              aria-expanded={open}
              data-testid={testId}
              className="h-auto min-h-11 w-full justify-start gap-2 px-2.5 py-1.5 font-normal"
            />
          }
        >
          <ChmonitorLogo width={20} height={20} className="size-5 shrink-0" />
          <span className="grid min-w-0 flex-1 text-left leading-tight">
            <span className="truncate text-[13px] font-medium">
              {selected?.name ?? ''}
            </span>
            {showLiveStatus && selected ? (
              <HostVersionWithStatus hostId={selected.id} />
            ) : (
              <span className="truncate text-xs text-muted-foreground">
                {mergedSelected?.source === 'database'
                  ? 'Saved to server'
                  : mergedSelected?.source === 'browser'
                    ? 'Saved in browser'
                    : 'Connection'}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-auto size-3.5 shrink-0 opacity-50" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--anchor-width) min-w-64 p-0"
        >
          <Command>
            <CommandInput placeholder="Search hosts…" className="h-9" />
            <CommandList className="max-h-72">
              <CommandEmpty>No host found.</CommandEmpty>
              <CommandGroup>
                {sorted.map((host) => {
                  const mergedHost = merged.find((h) => h.id === host.id)
                  const live = Boolean(
                    mergedHost && isServerHost(mergedHost.source)
                  )
                  return (
                    <CommandItem
                      key={host.id}
                      value={`${host.name} ${host.id}`}
                      onSelect={() => {
                        onChange(host.id)
                        setOpen(false)
                      }}
                      className="gap-2 p-2"
                    >
                      <ChmonitorLogo
                        width={16}
                        height={16}
                        className="size-4 shrink-0"
                      />
                      {live ? (
                        <div className="min-w-0 flex-1">
                          <HostMenuRow
                            hostId={host.id}
                            hostName={host.name}
                            isActive={host.id === value}
                          />
                        </div>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            {host.name}
                          </span>
                          <Check
                            className={cn(
                              'size-4 shrink-0 text-muted-foreground',
                              host.id === value ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                        </>
                      )}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </label>
  )
}
