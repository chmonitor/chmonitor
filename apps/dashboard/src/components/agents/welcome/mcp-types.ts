/**
 * Shared MCP panel types.
 *
 * Lives in its own leaf module so that both `agent-mcp-panel.tsx` (which renders
 * the dialog) and `mcp-tools-resources-dialog.tsx` (which needs the server type)
 * can depend on it without forming an import cycle.
 */

export interface McpServer {
  id: string
  name: string
  /** Human-readable URL or transport description */
  endpoint: string
  toolCount: number
  resourceCount?: number
  version?: string
  /** Whether this server ships with the app and cannot be removed */
  builtin: boolean
  enabled: boolean
  status: 'connected' | 'connecting' | 'error' | 'unconfigured'
  /**
   * Tool names from a live probe (custom servers only).
   * Absent for the built-in server, which uses useMcpServerInfo instead.
   */
  probeTools?: string[]
}
