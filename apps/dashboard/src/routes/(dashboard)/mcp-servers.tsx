import { createFileRoute, redirect } from '@tanstack/react-router'

import { pageOgHead } from '@/lib/og'

/** Redirect: MCP servers live in the "MCP Servers" tab of `/agents/settings`. */
export const Route = createFileRoute('/(dashboard)/mcp-servers')({
  head: () => pageOgHead('agents/settings'),
  beforeLoad: () => {
    // `href`, not `to` + `search`: `/agents/settings` declares no typed `tab`
    // search param (its Tabs read the raw query string).
    throw redirect({ href: '/agents/settings?tab=mcp' })
  },
})
