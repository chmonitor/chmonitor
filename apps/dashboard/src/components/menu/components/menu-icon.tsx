import type { Icon } from '@chm/types/icon'

import { cn } from '@/lib/utils'

interface MenuIconProps {
  icon?: Icon
  isActive?: boolean
}

/** Radix icons ignore the strokeWidth that Lucide icons use. */
export function MenuIcon({ icon: Icon, isActive }: MenuIconProps) {
  if (!Icon) return null

  return (
    <Icon
      className={cn(
        'size-3.5 transition-colors',
        !isActive && 'opacity-60',
        isActive && 'opacity-100 text-primary'
      )}
      {...({ strokeWidth: 1.5 } as Record<string, unknown>)}
      aria-hidden="true"
    />
  )
}
