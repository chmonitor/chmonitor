import { ChevronRightIcon } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'
import { menuItemsConfig } from '@/menu'

import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { KeepInSidebarChip } from '@/components/navigation/keep-in-sidebar'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { filterMenuItemsByPermissions } from '@/lib/feature-permissions/menu'
import { getBreadcrumbPath } from '@/lib/menu/breadcrumb'
import { cn } from '@/lib/utils'

interface BreadcrumbProps {
  className?: string
}

/**
 * Header breadcrumb. The current page title is the header heading — it must
 * stay fully readable at tablet (768). Parent crumbs (and their chevrons)
 * hide until `lg`, matching the overlay-sidebar breakpoint, so nested pages
 * like "TTL & Partition Health" are not squeezed into "Over…".
 */
export const Breadcrumb = function Breadcrumb({ className }: BreadcrumbProps) {
  const pathname = useLocation({ select: (l) => l.pathname })
  const { config } = useFeaturePermissions()
  const menuItems = filterMenuItemsByPermissions(menuItemsConfig, config)

  const breadcrumbs = (() => {
    return getBreadcrumbPath(pathname, menuItems)
  })()

  const breadcrumbLabel = (() => {
    if (breadcrumbs.length === 0) {
      return 'Breadcrumb navigation'
    }

    return `Breadcrumb: ${breadcrumbs.map((crumb) => crumb.title).join(' / ')}`
  })()

  return (
    <nav
      aria-label={breadcrumbLabel}
      className={cn('flex items-center', className)}
    >
      <ol className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1

          return (
            <li
              key={`${index}-${crumb.href}`}
              className={cn(
                'flex items-center gap-1.5',
                isLast ? 'shrink-0' : 'hidden lg:flex'
              )}
            >
              {index > 0 && (
                <ChevronRightIcon
                  className="hidden size-3.5 shrink-0 lg:block"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              )}
              {isLast ? (
                <span
                  className="inline-flex shrink-0 items-center font-medium text-foreground"
                  aria-current="page"
                >
                  {crumb.title}
                  <KeepInSidebarChip />
                </span>
              ) : crumb.href ? (
                <HostPrefixedLink
                  href={crumb.href}
                  className="truncate transition-colors hover:text-foreground hover:underline"
                >
                  {crumb.title}
                </HostPrefixedLink>
              ) : (
                <span>{crumb.title}</span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
