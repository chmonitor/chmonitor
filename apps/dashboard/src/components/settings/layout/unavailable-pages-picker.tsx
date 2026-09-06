import { BlocksIcon, LayoutGrid, Rows3 } from 'lucide-react'

import { cn } from '@/lib/utils'

/**
 * Mini sidebar demo for unavailable-page behaviour.
 * Dim keeps Backups grayed out; Hide drops that row so only live pages remain.
 */
function MenuPreview({ mode }: { mode: 'dim' | 'hide' }) {
  return (
    <div className="flex h-[72px] w-[88px] flex-col gap-1 overflow-hidden rounded-lg bg-zinc-100 p-1.5 ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
      <div className="flex items-center gap-1 text-[10px] leading-none">
        <LayoutGrid className="size-3 shrink-0" />
        <span>Queries</span>
      </div>
      {mode === 'dim' ? (
        <div className="flex items-center gap-1 text-[10px] leading-none text-muted-foreground/40">
          <BlocksIcon className="size-3 shrink-0" />
          <span>Backups</span>
        </div>
      ) : (
        <div
          className="h-3 rounded border border-dashed border-muted-foreground/25"
          aria-hidden="true"
        />
      )}
      <div className="flex items-center gap-1 text-[10px] leading-none">
        <Rows3 className="size-3 shrink-0" />
        <span>Tables</span>
      </div>
    </div>
  )
}

const unavailablePageOptions = [
  {
    value: true,
    mode: 'dim' as const,
    label: 'Dim',
    description: 'Keep unavailable pages grayed out in the menu',
  },
  {
    value: false,
    mode: 'hide' as const,
    label: 'Hide',
    description: 'Remove unavailable pages from the menu',
  },
]

export function UnavailablePagesPicker({
  value,
  onChange,
}: {
  value: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Unavailable pages"
      className="flex items-start gap-3"
    >
      {unavailablePageOptions.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className="flex flex-col items-center gap-1.5 focus-visible:outline-none"
            aria-label={option.description}
          >
            <span
              className={cn(
                'rounded-[14px] p-0.5 ring-2 transition-shadow',
                isSelected
                  ? 'ring-foreground'
                  : 'ring-transparent hover:ring-border'
              )}
            >
              <MenuPreview mode={option.mode} />
            </span>
            <span
              className={cn(
                'text-xs',
                isSelected ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
