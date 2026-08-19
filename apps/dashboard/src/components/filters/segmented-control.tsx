import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface SegmentedOption {
  label: string
  value: string
  tooltip?: string
}

interface SegmentedControlProps {
  options: SegmentedOption[]
  value: string
  onChange: (value: string) => void
  /** Optional placeholder shown when no value is selected */
  placeholder?: string
  /** Optional className for styling */
  className?: string
  ariaLabel?: string
  /** `sm` is the dense query-filter pill. `default` is the compare toolbar tab. */
  size?: 'sm' | 'default'
}

/**
 * Segmented control for selecting from a set of options.
 * Renders as a row of pill-shaped buttons where the active one is highlighted.
 * Used for quick filters like query type (ALL | SELECT | INSERT ...).
 */
export function SegmentedControl({
  options,
  value,
  onChange,
  placeholder,
  className,
  ariaLabel = 'Segmented control',
  size = 'sm',
}: SegmentedControlProps) {
  const isDefault = size === 'default'
  const group = (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/20',
        isDefault ? 'p-1' : 'p-0.5',
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {placeholder && value === '' && (
        <div className="px-2.5 text-xs text-muted-foreground/70">
          {placeholder}
        </div>
      )}
      {options.map((option) => {
        const isActive = value === option.value
        const buttonProps = {
          type: 'button' as const,
          variant: (isActive ? 'secondary' : 'ghost') as 'secondary' | 'ghost',
          size: 'sm' as const,
          className: cn(
            'rounded-md font-medium transition-all',
            isDefault
              ? 'h-8 min-w-28 px-3 text-[13px]'
              : 'h-7 gap-1.5 px-2.5 text-xs',
            isActive
              ? 'border border-border/50 bg-background shadow-sm'
              : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
          ),
          'aria-pressed': isActive,
          onClick: () => onChange(option.value),
        }
        if (!option.tooltip) {
          return (
            <Button key={option.value} {...buttonProps}>
              <span>{option.label}</span>
            </Button>
          )
        }
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={<Button {...buttonProps} />}>
              <span>{option.label}</span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {option.tooltip}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )

  if (!options.some((option) => option.tooltip)) return group

  return <TooltipProvider>{group}</TooltipProvider>
}
