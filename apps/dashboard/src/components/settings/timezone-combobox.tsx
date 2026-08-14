import { Check, ChevronsUpDown } from 'lucide-react'

import { useMemo, useState } from 'react'
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
import {
  getBrowserTimezone,
  TIMEZONE_GROUPS,
  timezoneLabel,
} from '@/lib/constants/timezones'
import { cn } from '@/lib/utils'

interface TimezoneComboboxProps {
  value: string
  onChange: (value: string) => void
  defaultTimezone?: string | null
}

export function TimezoneCombobox({
  value,
  onChange,
  defaultTimezone,
}: TimezoneComboboxProps) {
  const [open, setOpen] = useState(false)
  const browserTimezone = useMemo(() => getBrowserTimezone(), [])
  const selectedLabel = timezoneLabel(value)

  const handleSelect = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id="timezone"
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="Select timezone"
            className="h-9 w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">{selectedLabel}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--anchor-width) min-w-72 p-0">
        <Command>
          <CommandInput placeholder="Search timezone…" className="h-9" />
          <CommandList className="max-h-64">
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup heading="Suggested">
              <CommandItem
                value={`${browserTimezone} browser local ${timezoneLabel(browserTimezone)}`}
                onSelect={() => handleSelect(browserTimezone)}
              >
                <Check
                  className={cn(
                    'size-4',
                    value === browserTimezone ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {timezoneLabel(browserTimezone)}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  Browser
                </span>
              </CommandItem>
            </CommandGroup>
            {TIMEZONE_GROUPS.map((group) => (
              <CommandGroup key={group.label} heading={group.label}>
                {group.timezones.map((tz) => (
                  <CommandItem
                    key={tz.value}
                    value={`${tz.value} ${tz.label} ${group.label}`}
                    onSelect={() => handleSelect(tz.value)}
                  >
                    <Check
                      className={cn(
                        'size-4',
                        value === tz.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">{tz.label}</span>
                    {defaultTimezone === tz.value && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        Default
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
