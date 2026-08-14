import { ChevronRightIcon } from 'lucide-react'
import { useLocation } from '@tanstack/react-router'
import { menuItemsConfig } from '@/menu'

import { HostPrefixedLink } from '@/components/menu/link-with-context'
import { useFeaturePermissions } from '@/lib/feature-permissions/context'
import { filterMenuItemsByPermissions } from '@/lib/feature-permissions/menu'
import { getBreadcrumbPath } from '@/lib/menu/breadcrumb'
import { cn } from '@/lib/utils'

interface BreadcrumbProps {
  className?: string
}

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
      className={cn('flex min-w-0 items-center overflow-hidden', className)}
    >
      <ol className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-sm text-muted-foreground">
        {breadcrumbs.map((crumb, index) => {
          const isLast = index === breadcrumbs.length - 1

          return (
            <li
              key={`${index}-${crumb.href}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              {index > 0 && (
                <ChevronRightIcon
                  className="hidden size-3.5 shrink-0 sm:block"
                  strokeWidth={2.5}
                  aria-hidden="true"
                />
              )}
              {isLast ? (
                <span
                  className="truncate font-medium text-foreground"
                  aria-current="page"
                >
                  {crumb.title}
                </span>
              ) : crumb.href ? (
                <>
                  <span className="sr-only sm:hidden">{crumb.title}</span>
                  <HostPrefixedLink
                    href={crumb.href}
                    className="hidden truncate transition-colors hover:text-foreground hover:underline sm:inline"
                  >
                    {crumb.title}
                  </HostPrefixedLink>
                </>
              ) : (
                <>
                  <span className="sr-only sm:hidden">{crumb.title}</span>
                  <span className="hidden sm:inline">{crumb.title}</span>
                </>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
