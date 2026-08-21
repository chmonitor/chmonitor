/**
 * Copy for /cli — keep this page short: intro, a few features, one install.
 * Command reference lives at docs.chmonitor.dev/guide/guides/diagnostics-cli.
 */

export const CLI_INSTALL = 'curl -sSf https://chmonitor.dev/install.sh | bash'

export const CLI_DOCS =
  'https://docs.chmonitor.dev/guide/guides/diagnostics-cli'

export const features = [
  {
    title: 'Your dashboard',
    body: 'Talks to dash.chmonitor.dev by default. Point --base-url or CHM_BASE_URL at a self-hosted instance.',
    icon: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  },
  {
    title: 'Ready for AI agents',
    body: 'chm agent streams the dashboard agent from the terminal. MCP is on the dashboard.',
    icon: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  },
  {
    title: 'Interactive TUI',
    body: 'chm tui is a live terminal UI for hosts, charts, and running queries.',
    icon: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
  },
] as const
