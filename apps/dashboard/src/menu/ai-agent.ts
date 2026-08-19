import { SlidersHorizontalIcon, SparklesIcon, UnplugIcon } from 'lucide-react'

import type { MenuItem } from '@/components/menu/types'

export const aiAgentItems: MenuItem[] = [
  {
    // Parent groups the chat UI, its settings (provider, model, system
    // prompt, skills, external MCP server registrations), and this
    // dashboard's own MCP server endpoint — three previously flat,
    // confusingly-named items ("AI Agent", "MCP Servers", "MCP Server").
    // No `permission` here: children carry their own ('agent' vs 'mcp') so
    // each is filtered independently instead of gating the whole group.
    title: 'AI Agent',
    href: '',
    icon: SparklesIcon,
    section: 'main',
    isNew: true,
    items: [
      {
        title: 'Chat',
        href: '/agents',
        description: 'Ask questions about this cluster in natural language',
        icon: SparklesIcon,
        isNew: true,
        // The chat UI renders for everyone; the backend enforces auth on send
        // (see AgentAuthGate / the /api/v1/agent route), not the client route
        // gate.
        permission: { feature: 'agent' },
      },
      {
        title: 'Agent Settings',
        href: '/agents/settings',
        description:
          'Provider, model, system prompt, skills, and external MCP servers',
        icon: SlidersHorizontalIcon,
        permission: { feature: 'agent' },
      },
      {
        title: 'MCP Server',
        href: '/mcp',
        description:
          "Let external AI tools (Claude Desktop, Cursor, OpenCode, etc.) query this cluster via this dashboard's own MCP endpoint",
        icon: UnplugIcon,
        permission: { feature: 'mcp' },
      },
    ],
  },
]
