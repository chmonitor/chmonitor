import { ArrowUpRight } from 'lucide-react'

import { VersionSwitcher } from '@/components/version-switcher'
import { dashboardUrl, marketingUrl } from '@/lib/shared'

const footerLinkClass =
  'inline-flex items-center gap-0.5 whitespace-nowrap text-fd-muted-foreground transition-colors hover:text-fd-foreground'

// Quiet footer pinned to the bottom of the docs sidebar: Home + dashboard as
// plain text links, and the documentation version control.
export function SidebarFooter() {
  return (
    <div className="flex flex-col gap-2 px-1 text-sm">
      <div className="flex items-center gap-4">
        <a
          href={marketingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={footerLinkClass}
        >
          <span>Home</span>
          <ArrowUpRight className="size-3.5 shrink-0 opacity-60" />
        </a>
        <a
          href={dashboardUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={footerLinkClass}
        >
          <span>Open Dashboard</span>
          <ArrowUpRight className="size-3.5 shrink-0 opacity-60" />
        </a>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-fd-muted-foreground">Documentation</span>
        <VersionSwitcher />
      </div>
    </div>
  )
}
