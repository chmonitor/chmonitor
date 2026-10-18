import { ChevronDown } from 'lucide-react'

import type { DateRangeConfig, DateRangeValue } from './date-range-types'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface DateRangeSelectorProps {
  config: DateRangeConfig
  value: string
  onChange: (range: DateRangeValue) => void
  className?: string
  disabled?: boolean
  /** When true, button is always visible (40% opacity). When false (default), hidden until parent group or button hover */
  alwaysVisible?: boolean
}

export const DateRangeSelector = function DateRangeSelector({
  config,
  value,
  onChange,
  className,
  disabled = false,
  alwaysVisible = false,
}: DateRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)

  const currentOption =
    config.options.find((o) => o.value === value) ?? config.options[0]

  const handleSelect = (optionValue: string) => {
    const option = config.options.find((o) => o.value === optionValue)
    if (option) {
      onChange({
        value: option.value,
        lastHours: option.lastHours,
        interval: option.interval,
      })
      setIsOpen(false)
    }
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'h-6 gap-1 px-1.5 text-xs font-medium text-muted-foreground transition-opacity pointer-coarse:h-9 pointer-coarse:px-2.5',
              'hover:bg-muted hover:text-foreground rounded-md',
              'focus-visible:ring-1 focus-visible:ring-ring',
              'relative before:content-[""] before:absolute before:-inset-4',
              disabled && 'opacity-50 cursor-not-allowed',
              alwaysVisible || isOpen
                ? 'opacity-100'
                : 'opacity-40 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-40 pointer-fine:group-focus-within:opacity-40 hover:!opacity-100 focus-visible:!opacity-100',
              className
            )}
          />
        }
      >
        <span>{currentOption.label}</span>
        <ChevronDown className="size-3" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="p-1.5">
        <div
          className="flex items-center gap-1"
          role="radiogroup"
          aria-label="Select date range"
        >
          {config.options.map((option) => {
            const isActive = value === option.value

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => handleSelect(option.value)}
                title={option.description}
                className={cn(
                  'min-h-11 min-w-11 px-2.5 py-1 text-xs font-medium rounded-md transition-colors sm:min-h-0 sm:min-w-0',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                )}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
