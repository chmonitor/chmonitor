import { useEffect } from 'react'

interface WebMcpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: () => Promise<unknown>
}

interface ModelContext {
  provideContext?: (context: { tools: WebMcpTool[] }) => void
  registerTool?: (tool: WebMcpTool) => void
}

/**
 * Registers WebMCP tools for browser-based AI agents.
 * Exposes core dashboard actions like get_cluster_health.
 * Matches navigator.modelContext.provideContext() and navigator.modelContext.registerTool() specs.
 */
export function WebMcpRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const nav: Navigator & { modelContext?: ModelContext } = navigator
    if (nav.modelContext) {
      const getClusterHealth: WebMcpTool = {
        name: 'get_cluster_health',
        description: 'Get real-time health status of ClickHouse cluster',
        inputSchema: {
          type: 'object',
          properties: {},
        },
        execute: async () => {
          try {
            const res = await fetch('/api/health')
            if (!res.ok) throw new Error('Health check failed')
            return await res.json()
          } catch (err) {
            return {
              status: 'error',
              error: err instanceof Error ? err.message : 'Unknown error',
            }
          }
        },
      }

      // Call provideContext (RFC / spec variation 1)
      if (typeof nav.modelContext.provideContext === 'function') {
        try {
          nav.modelContext.provideContext({
            tools: [getClusterHealth],
          })
        } catch (e) {
          console.warn('Failed to call provideContext:', e)
        }
      }

      // Call registerTool (RFC / spec variation 2)
      if (typeof nav.modelContext.registerTool === 'function') {
        try {
          nav.modelContext.registerTool(getClusterHealth)
        } catch (e) {
          console.warn('Failed to call registerTool:', e)
        }
      }
    }
  }, [])

  return null
}
