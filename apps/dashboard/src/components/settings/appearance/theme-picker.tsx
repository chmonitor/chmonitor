import type { UserSettings } from '@/lib/types/user-settings'

import { cn } from '@/lib/utils'

const themeOptions = [
  { value: 'light', label: 'Light', description: 'Light mode' },
  { value: 'dark', label: 'Dark', description: 'Dark mode' },
  { value: 'system', label: 'System', description: 'Sync with system' },
] as const

function WindowPane({ dark }: { dark?: boolean }) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 flex-col px-1.5 pt-1.5',
        dark ? 'bg-zinc-900' : 'bg-zinc-100'
      )}
    >
      <div className="mb-1.5 flex gap-0.5">
        <span
          className={cn(
            'size-1 rounded-full',
            dark ? 'bg-zinc-600' : 'bg-zinc-300'
          )}
        />
        <span
          className={cn(
            'size-1 rounded-full',
            dark ? 'bg-zinc-600' : 'bg-zinc-300'
          )}
        />
        <span
          className={cn(
            'size-1 rounded-full',
            dark ? 'bg-zinc-600' : 'bg-zinc-300'
          )}
        />
      </div>
      <div
        className={cn(
          'mb-0.5 h-1 w-3/4 rounded-sm',
          dark ? 'bg-zinc-700' : 'bg-zinc-300'
        )}
      />
      <div
        className={cn(
          'mb-0.5 h-1 w-full rounded-sm',
          dark ? 'bg-zinc-700' : 'bg-zinc-300'
        )}
      />
      <div
        className={cn(
          'h-1 w-2/3 rounded-sm',
          dark ? 'bg-zinc-700' : 'bg-zinc-300'
        )}
      />
    </div>
  )
}

function ThemePreview({ mode }: { mode: 'light' | 'dark' | 'system' }) {
  return (
    <div className="flex h-[52px] w-[68px] overflow-hidden rounded-lg ring-1 ring-black/10 dark:ring-white/10">
      {mode === 'light' && <WindowPane />}
      {mode === 'dark' && <WindowPane dark />}
      {mode === 'system' && (
        <>
          <WindowPane dark />
          <WindowPane />
        </>
      )}
    </div>
  )
}

export function ThemePicker({
  value,
  onChange,
}: {
  value: UserSettings['theme']
  onChange: (value: UserSettings['theme']) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex items-start gap-3"
    >
      {themeOptions.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(option.value)}
            className="flex flex-col items-center gap-1.5 focus-visible:outline-none"
            aria-label={`Select ${option.description}`}
          >
            <span
              className={cn(
                'rounded-[14px] p-0.5 ring-2 transition-shadow',
                isSelected
                  ? 'ring-foreground'
                  : 'ring-transparent hover:ring-border'
              )}
            >
              <ThemePreview mode={option.value} />
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
