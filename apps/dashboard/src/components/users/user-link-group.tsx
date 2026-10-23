import { menuItemsConfig } from '@/menu'

import type { UserLink } from '@/components/users/user-links'

import { useMemo } from 'react'
import { useUnavailableResolver } from '@/components/menu/hooks/use-unavailable-visibility'
import { AppLink as Link } from '@/components/ui/app-link'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { resolveFeatureState } from '@/lib/feature-permissions/shared'
import { flattenMenuItems } from '@/lib/menu/derive-favorites'
import { useHostId } from '@/lib/swr'
import { cn } from '@/lib/utils'

const MENU_BY_HREF = new Map(
  flattenMenuItems(menuItemsConfig).map((item) => [item.href, item])
)

/** Links whose menu page is available and enabled on the current host. */
export function useAvailableUserLinks(links: UserLink[]): UserLink[] {
  const hostId = useHostId()
  const resolve = useUnavailableResolver(hostId)
  const { config } = useFeaturePermissions()

  return useMemo(
    () =>
      links.filter((link) => {
        const item = MENU_BY_HREF.get(link.menuHref)
        if (!item) return true
        if (!resolveFeatureState(item.permission, config).enabled) return false
        return resolve(item).visibility === 'available'
      }),
    [links, resolve, config]
  )
}

interface UserLinkGroupProps {
  links: UserLink[]
  label: string
  className?: string
}

/** A labelled row of small text links; renders nothing when none is available. */
export function UserLinkGroup({ links, label, className }: UserLinkGroupProps) {
  const available = useAvailableUserLinks(links)
  if (available.length === 0) return null

  return (
    <nav
      aria-label={label}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1 text-xs',
        className
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      {available.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          className="text-foreground underline-offset-4 hover:text-primary hover:underline"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  )
}
