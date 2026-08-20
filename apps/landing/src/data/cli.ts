/**
 * Copy for /cli — the marketing page for the standalone `chm` / `chmonitor`
 * binary. Command behaviour lives in rust/ch-monitor-cli and the docs page
 * at docs.chmonitor.dev/guide/guides/diagnostics-cli; this file is the
 * public pitch only.
 */

export const CLI_INSTALL =
  'curl -sSf https://chmonitor.dev/install.sh | bash'

export const CLI_INSTALL_BETA =
  'CHM_CHANNEL=beta bash <(curl -sSf https://chmonitor.dev/install.sh)'

export const CLI_CARGO = 'cargo install chmonitor'

export const CLI_DOCS =
  'https://docs.chmonitor.dev/guide/guides/diagnostics-cli'

export const CLI_DIAGNOSE = 'chm diagnose --ch-host http://localhost:8123'

export const commands = [
  {
    name: 'chm diagnose',
    body: 'Zero-signup health scan. Talks straight to ClickHouse HTTP, read-only, scored report.',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  },
  {
    name: 'chm tui',
    body: 'Live multi-pane terminal UI for hosts, a chart sparkline, and a table.',
    icon: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  },
  {
    name: 'chm chart',
    body: 'Pull a named dashboard chart, with a braille sparkline plus min / max / avg.',
    icon: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  },
  {
    name: 'chm table',
    body: 'Fetch a named table (running queries, merges, …). --explain prints columns and SQL.',
    icon: '<path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/>',
  },
  {
    name: 'chm hosts',
    body: 'List the hosts the dashboard knows about.',
    icon: '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
  },
  {
    name: 'chm auth login',
    body: 'Auto-detect none, device login, or API key from GET /api/v1/auth/cli.',
    icon: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  },
  {
    name: 'chm agent',
    body: 'Stream the dashboard AI agent from the terminal. chat is an alias.',
    icon: '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/>',
  },
  {
    name: 'chm upgrade',
    body: 'Self-update from GitHub Releases. update is the same command. Never sudo.',
    icon: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  },
] as const

export const faqs = [
  {
    q: 'Do I need a chmonitor account?',
    a: 'Not for <code>chm diagnose</code>. That command connects straight to a ClickHouse HTTP interface and prints a scored, read-only report. The other commands (<code>hosts</code>, <code>chart</code>, <code>table</code>, <code>tui</code>, <code>agent</code>) talk to a running dashboard API — Cloud at dash.chmonitor.dev by default, or your self-hosted instance via <code>--base-url</code>.',
  },
  {
    q: 'Which platforms have prebuilt binaries?',
    a: 'Linux and macOS, both x86_64 and aarch64. There is no Windows release asset — use <code>cargo install chmonitor</code> on unsupported targets. The installer never invokes sudo; default prefix is <code>$HOME/.local/bin</code>.',
  },
  {
    q: 'How do I point it at a self-hosted dashboard?',
    a: '<code>chm --base-url https://your-dashboard.example auth login</code>, or set <code>CHM_BASE_URL</code> / a <code>chm.toml</code>. Auth auto-detects open API, device login, or an API key from <code>GET /api/v1/auth/cli</code>.',
  },
  {
    q: 'Stable or beta?',
    a: 'Stable is the default: latest non-prerelease <code>chm-v*</code> tag. Set <code>CHM_CHANNEL=beta</code> (installer, <code>chm upgrade</code>, or config) to prefer prereleases.',
  },
  {
    q: 'Does the CLI send telemetry?',
    a: 'A best-effort anonymous ping (install id, version, command name, OS/arch) to telemetry.chmonitor.dev. No cluster host, query text, arguments, paths, or IPs. Opt out with <code>CHM_TELEMETRY=off</code> or <code>DO_NOT_TRACK=1</code>.',
  },
] as const
