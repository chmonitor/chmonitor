import { useQueryClient } from '@tanstack/react-query'

import type { ComponentProps } from 'react'

import { AppLink as Link } from '@/components/ui/app-link'
import {
  isMenuItemActive,
  isMenuItemActiveAmongSiblings,
} from '@/lib/menu/breadcrumb'
import { usePathname } from '@/lib/next-compat'
import { useHostId } from '@/lib/swr'
import { prefetchRoute } from '@/lib/swr/prefetch'

export const HostPrefixedLink = ({
  href,
  children,
  className,
  onMouseEnter,
  siblingHrefs,
  ...props
}: {
  href: string
  children?: React.ReactNode
  className?: string
  /**
   * Hrefs of sibling menu items rendered alongside this link (e.g. the other
   * children of the same collapsible group). When provided, active state
   * resolves via `isMenuItemActiveAmongSiblings` so a shorter sibling href
   * (`/agents`) never lights up together with a more specific one
   * (`/agents/settings`) — see that function's doc comment.
   */
  siblingHrefs?: string[]
} & Omit<
  ComponentProps<typeof Link>,
  'to' | 'href' | 'children' | 'className'
>) => {
  const pathname = usePathname()
  const hostId = useHostId()
  const queryClient = useQueryClient()

  // External destinations (e.g. the Docs item → docs.chmonitor.dev) can't go
  // through the router's client-side navigation — render a real anchor that
  // leaves the SPA. No host prefix, active state, or route prefetch applies.
  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        onMouseEnter={onMouseEnter}
        {...props}
      >
        {children}
      </a>
    )
  }

  // TanStack Router's `href` option is for external URLs only; internal links
  // must use `to` + `search` so the rendered <a> element gets the correct href.
  // Pass `host` as a number to match the root route's validateSearch schema —
  // string values get JSON-encoded ("%220%22") which produces 404s during prerender.
  const toPath = href.split('?')[0]
  const searchParams = { host: hostId }

  // Check if this link is active
  const isActive = siblingHrefs
    ? isMenuItemActiveAmongSiblings(href, siblingHrefs, pathname)
    : isMenuItemActive(href, pathname)

  const handleMouseEnter = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Prefetch route data on hover using idle callback to avoid blocking
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      requestIdleCallback(() => prefetchRoute(queryClient, href, hostId))
    } else {
      setTimeout(() => prefetchRoute(queryClient, href, hostId), 100)
    }
    onMouseEnter?.(e)
  }

  return (
    <Link
      to={toPath as any}
      search={searchParams as any}
      className={className}
      data-active={isActive ? 'true' : undefined}
      aria-current={isActive ? 'page' : undefined}
      onMouseEnter={handleMouseEnter}
      {...props}
    >
      {children}
    </Link>
  )
}
