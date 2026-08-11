import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface SegmentedOption {
  label: string
  value: string
}

interface SegmentedControlProps {
  options: SegmentedOption[]
  value: string
  onChange: (value: string) => void
  /** Optional placeholder shown when no value is selected */
  placeholder?: string
  /** Optional className for styling */
  className?: string
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
}: SegmentedControlProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-muted/20 p-0.5',
        className
      )}
      role="group"
      aria-label="Segmented control"
    >
      {placeholder && value === '' && (
        <div className="px-2.5 text-xs text-muted-foreground/70">
          {placeholder}
        </div>
      )}
      {options.map((option) => {
        const isActive = value === option.value
        return (
          <Button
            key={option.value}
            type="button"
            variant={isActive ? 'secondary' : 'ghost'}
            size="sm"
            className={cn(
              'gap-1.5 px-2.5 text-xs h-7 rounded-md transition-all',
              isActive
                ? 'bg-background shadow-sm border border-border/50 font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
          </Button>
        )
      })}
    </div>
  )
}
