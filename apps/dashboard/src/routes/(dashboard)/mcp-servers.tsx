import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/mcp-servers` moved into the "MCP Servers" tab of `/agents/settings`
 * (menu/IA cleanup — the standalone registration page is now one section of
 * the fuller Agent Settings page). Redirect so old bookmarks/links keep
 * working.
 */
export const Route = createFileRoute('/(dashboard)/mcp-servers')({
  beforeLoad: () => {
    // `href` (not `to` + `search`) — `/agents/settings` doesn't declare a
    // typed `tab` search param (its Tabs state reads the raw query string via
    // the `next-compat` shim, matching the rest of the app), so a raw href
    // is simpler than fighting the router's typed search for one param.
    throw redirect({ href: '/agents/settings?tab=mcp' })
  },
})
