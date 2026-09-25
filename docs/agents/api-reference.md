# AI Agents API Reference

This guide is for developers who want to extend or customize the AI agent system.

## Architecture

The agent system is built on [Vercel AI SDK](https://sdk.vercel.ai/docs), a framework for building AI-powered applications with streaming responses and tool calling.

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Chat UI   │────▶│ API Routes  │────▶│   Agents    │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                       ┌─────────────┐
                                       │  AI SDK     │
                                       │ToolLoopAgent│
                                       └─────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
            ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
            │  query      │           │list_tables  │           │get_metrics  │
            │  tool       │           │  tool       │           │  tool       │
            └─────────────┘           └─────────────┘           └─────────────┘
                    │                         │                         │
                    ▼                         ▼                         ▼
            ┌─────────────┐           ┌─────────────┐           ┌─────────────┐
            │ ClickHouse │           │ ClickHouse │           │ ClickHouse │
            │   Data     │           │   Data     │           │   Data     │
            └─────────────┘           └─────────────┘           └─────────────┘
```

## Environment Variables

Required environment variables for the agent system:

```bash
# LLM Configuration (required)
LLM_API_KEY=your-api-key-here
LLM_API_BASE=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini

# Alternative: OpenRouter (supports multiple providers)
LLM_API_BASE=https://openrouter.ai/api/v1
LLM_MODEL=openrouter/free

# Default: OpenRouter free router
OPENROUTER_API_KEY=your-openrouter-key
LLM_MODEL=openrouter/free
```

### Model Options

All free OpenRouter options listed below support tool use (required by the
agent) and were verified against the live catalog on 2026-09-26. Free model
rosters turn over quickly — the picker is populated from the provider catalog
at runtime, so treat this table as a starting point rather than a guarantee.

| Model | Provider | Cost | Notes |
|-------|----------|------|-------|
| `openrouter/free` | OpenRouter | Free | Default auto-router to a working free tool-capable model |
| `openrouter/auto` | OpenRouter | Paid | Auto-routes to best available model |
| `anyrouter:auto` | AnyRouter | Paid | Auto-router to the top tool-capable model by usage |
| `anyrouter:z-ai/glm-4.7-flash` | AnyRouter | Paid | Fast tool-capable model |
| `anyrouter:google/gemma-4-26b-a4b-it` | AnyRouter | Paid | 262K context, tool-capable |
| `openrouter:google/gemini-3.1-flash-lite` | OpenRouter | Paid | 1M context, tool-capable |
| `google/gemma-4-31b-it:free` | OpenRouter | Free | 262K context, tool-capable |
| `google/gemma-4-26b-a4b-it:free` | OpenRouter | Free | 262K context, tool-capable |
| `qwen/qwen3.8-27b:free` | OpenRouter | Free | 262K context, tool-capable |
| `thinkingmachines/inkling:free` | OpenRouter | Free | 1M context, tool-capable |
| `poolside/laguna-s-2.1:free` | OpenRouter | Free | 262K context, tool-capable |
| `nvidia/nemotron-3-super-120b-a12b:free` | OpenRouter | Free | 262K context, tool-capable |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | OpenRouter | Free | 1M context, tool-capable |
| `gpt-4o-mini` | OpenAI | Paid | Best quality |
| `anthropic/claude-3-haiku` | Anthropic | Paid | Fast & accurate |

NVIDIA NIM (`NVIDIA_API_KEY`) serves its own hosted catalog; the deployment
bills NVIDIA directly, so no per-token cost is shown for those models.

## Agent Factory

The agent is created using the `createClickHouseAgent()` factory function:

```typescript
import { createClickHouseAgent } from '@/lib/ai/agent'

const agent = createClickHouseAgent({
  hostId: 0,
  model: 'openrouter/free',
})
```

### Factory Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `hostId` | `number` | Yes | - | ClickHouse host ID |
| `model` | `string` | No | `'openrouter/free'` | LLM model identifier |
| `apiKey` | `string` | No | `process.env.LLM_API_KEY` | LLM API key |
| `baseURL` | `string` | No | `process.env.LLM_API_BASE` | LLM API base URL |
| `maxSteps` | `number` | No | `30` | Max tool execution steps |

## Tool System

The agent uses AI SDK's `dynamicTool()` for tool definitions. Tools are defined in `lib/ai/agent/mcp-tool-adapter.ts`.

### Adding a New Tool

1. **Define the tool** in `mcp-tool-adapter.ts`:

```typescript
import { dynamicTool } from 'ai'
import { z } from 'zod/v3'
import { fetchData } from '@/lib/clickhouse'

export function createMcpTools(hostId: number) {
  return {
    // ... existing tools

    my_new_tool: dynamicTool({
      description: 'Describe what this tool does and when to use it',
      inputSchema: z.object({
        param1: z.string().describe('First parameter'),
        param2: z.number().optional().describe('Optional second parameter'),
      }),
      execute: async (input: unknown) => {
        const { param1, param2 } = input as { param1: string; param2?: number }

        const result = await fetchData({
          query: 'SELECT * FROM system.table WHERE column = {param:String}',
          query_params: { param: param1 },
          hostId,
          format: 'JSONEachRow',
          clickhouse_settings: { readonly: '1' },
        })

        if (result.error) {
          throw new Error(result.error.message)
        }

        return result.data
      },
    }),
  }
}
```

2. **Tool execution patterns**:

```typescript
// Simple query
execute: async (input: unknown) => {
  const { sql } = input as { sql: string }
  const result = await fetchData({ query: sql, hostId, format: 'JSONEachRow' })
  return result.data
}

// Multiple parallel queries
execute: async (input: unknown) => {
  const [result1, result2, result3] = await Promise.all([
    fetchData({ query: 'SELECT...', hostId }),
    fetchData({ query: 'SELECT...', hostId }),
    fetchData({ query: 'SELECT...', hostId }),
  ])
  return { combined: [result1.data, result2.data, result3.data] }
}

// With validation
execute: async (input: unknown) => {
  const { sql } = input as { sql: string }

  // Validate first
  validateSqlQuery(sql)

  // Then execute
  const result = await fetchData({ query: sql, hostId })
  return result.data
}
```

### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `query` | Execute read-only SQL queries | `sql`, `hostId?`, `format?` |
| `list_databases` | List all databases | `hostId?` |
| `list_tables` | List tables in a database | `database`, `hostId?` |
| `get_table_schema` | Get column definitions | `database`, `table`, `hostId?` |
| `get_metrics` | Get server metrics | `hostId?` |
| `get_running_queries` | Show currently executing queries | `hostId?` |
| `get_slow_queries` | Get slowest completed queries | `limit?`, `hostId?` |
| `get_merge_status` | Show active merge operations | `hostId?` |
| `spot_issues` | Rank likely query, storage, mutation, and replication issues | `lastHours?`, `hostId?` |
| `repair_query` | Validate and self-fix read-only SQL with EXPLAIN evidence | `sql`, `error?`, `database?`, `hostId?` |
| `analyze_query_optimization` | Inspect plans, indexes, and table metadata for a query | `sql`, `database?`, `hostId?` |
| `recommend_table_design` | Suggest ORDER BY, type, skip-index, and MV improvements | `database`, `table`, `lastDays?`, `hostId?` |
| `discover_data_sources` | Search tables and columns relevant to a topic | `searchTerm`, `database?`, `hostId?` |

## API Endpoint

### POST /api/v1/agent

Processes natural language queries through the AI agent and streams results.

Authentication depends on `NEXT_PUBLIC_AUTH_PROVIDER`:

- unset / `none`: no auth required, useful for self-hosted private networks
- `clerk`: requires a signed-in Clerk browser session or a valid Bearer token
  matching `AGENT_API_TOKEN`

**Request Body:**

```typescript
{
  // Direct message (backward compatibility)
  message?: string

  // Or UIMessage format (preferred)
  messages?: Array<{
    id: string
    role: 'user' | 'assistant'
    parts: Array<{ type: 'text'; text: string }>
  }>

  hostId?: number  // Default: 0
  model?: string  // Override default model
}
```

**Response:** Server-Sent Events (SSE) stream with UIMessage updates

```typescript
// SSE events
data: {"type":"tool-call","toolName":"query","state":"input-streaming"}
data: {"type":"tool-call","toolName":"query","state":"output-streaming"}
data: {"type":"text-delta","textDelta":"Here are your results..."}
```

### Example: Using curl

```bash
curl -X POST http://localhost:3000/api/v1/agent \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $AGENT_API_TOKEN" \
  -d '{
    "message": "Show me all databases",
    "hostId": 0
  }'
```

### Example: Client-side with useChat

```typescript
'use client'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export function ChatComponent() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/v1/agent',
      body: { hostId: 0, model: 'openrouter/free' },
    }),
  })

  const handleSubmit = (text: string) => {
    sendMessage({
      parts: [{ type: 'text', text }],
    })
  }

  return (
    <div>
      {messages.map((msg) => (
        <div key={msg.id}>
          {msg.parts.map((part, i) =>
            part.type === 'text' ? <p key={i}>{part.text}</p> : null
          )}
        </div>
      ))}
    </div>
  )
}
```

## UIMessage Format

AI SDK v6 uses the UIMessage format for all messages:

```typescript
interface UIMessage {
  id: string                    // Unique message ID (UUID)
  role: 'user' | 'assistant'     // Message role
  parts: MessagePart[]          // Message content parts
}

type MessagePart =
  | { type: 'text'; text: string }                    // Plain text
  | { type: 'dynamic-tool'; toolCallId: string; ... }  // Tool call (dynamic)
  | { type: `tool-${string}`; toolCallId: string; ... } // Tool call (static)
  | { type: 'step-start' }                            // Step boundary
```

## Streaming Response

The API uses `createAgentUIStreamResponse()` for streaming:

```typescript
import { createAgentUIStreamResponse } from 'ai'
import { createClickHouseAgent } from '@/lib/ai/agent'

export async function POST(request: Request) {
  const body = await request.json()
  const agent = createClickHouseAgent({ hostId: body.hostId ?? 0 })

  return createAgentUIStreamResponse({
    agent,
    uiMessages: body.messages, // Must be UIMessage format
    onError: (error) => {
      console.error('[Agent API] Stream error:', error)
      return error instanceof Error ? error.message : 'Unknown error'
    },
  })
}
```

## Testing

### Unit Tests with bun:test

```typescript
// lib/ai/agent/__tests__/clickhouse-agent.test.ts
import { describe, expect, mock, test } from 'bun:test'

// Mock dependencies
mock.module('@/lib/clickhouse', () => ({
  fetchData: async () => ({ data: [], error: null }),
}))

import { createClickHouseAgent } from '../clickhouse-agent'

describe('createClickHouseAgent', () => {
  test('creates agent with default model', () => {
    const agent = createClickHouseAgent({ hostId: 0 })

    expect(agent.id).toBe('clickhouse-agent')
    expect(agent.tools).toBeDefined()
  })

  test('creates agent with custom model', () => {
    const agent = createClickHouseAgent({
      hostId: 0,
      model: 'gpt-4o-mini',
    })

    expect(agent).toBeDefined()
  })
})
```

### Integration Tests

```typescript
// app/api/v1/agent/__tests__/route.test.ts
import { describe, expect, test } from 'bun:test'
import { createClickHouseAgent } from '@/lib/ai/agent'

mock.module('@/lib/ai/agent', () => ({
  createClickHouseAgent: () => ({
    id: 'test-agent',
    tools: {},
    model: {},
  }),
}))

describe('POST /api/v1/agent', () => {
  test('accepts UIMessage format with parts', async () => {
    const response = await fetch('http://localhost:3000/api/v1/agent', {
      method: 'POST',
      body: JSON.stringify({
        messages: [{
          id: 'msg-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Show databases' }],
        }],
        hostId: 0,
      }),
    })

    expect(response.status).toBe(200)
  })
})
```

## Error Handling

### SQL Validation

All queries are validated before execution:

```typescript
import { validateSqlQuery } from '@/lib/api/shared/validators/sql'

try {
  validateSqlQuery(sql) // Throws if unsafe
  // Execute query
} catch (err) {
  throw new Error(`Validation error: ${err.message}`)
}
```

Blocked patterns:
- `DROP`, `DELETE`, `UPDATE`, `INSERT`, `ALTER`, `CREATE`
- `file()`, `url()` table functions
- Comments with newlines
- Semicolons

### Tool Error Handling

```typescript
execute: async (input: unknown) => {
  try {
    const result = await fetchData({ query: sql, hostId })

    if (result.error) {
      throw new Error(result.error.message)
    }

    return result.data
  } catch (error) {
    // Error is propagated to agent and shown to user
    throw new Error(
      `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}
```

## MCP Server Integration

The agent tools are shared with the MCP server for external access:

```typescript
// lib/mcp/tools.ts
import { createMcpTools } from '@/lib/ai/agent/mcp-tool-adapter'

export function registerAllTools(server: McpServer) {
  const tools = createMcpTools(0) // hostId from request

  // Register each tool with MCP server
  Object.entries(tools).forEach(([name, tool]) => {
    server.registerTool(...)
  })
}
```

## Best Practices

1. **Type Safety**: Use Zod schemas for all tool inputs
2. **Validation**: Always validate user input before executing queries
3. **Error Messages**: Provide clear, actionable error messages
4. **Tool Descriptions**: Include when to use the tool and expected inputs
5. **Query Limits**: Use LIMIT clauses for potentially large result sets
6. **Read-Only**: Always use `clickhouse_settings: { readonly: '1' }`
7. **Streaming**: Use streaming responses for long-running operations

## References

- [Vercel AI SDK Documentation](https://sdk.vercel.ai/docs)
- [AI SDK ToolLoopAgent](https://sdk.vercel.ai/docs/ai-sdk-core/toolloopagent)
- [ClickHouse SQL Reference](https://clickhouse.com/docs/en/sql-reference/)
- [OpenRouter API](https://openrouter.ai/docs)
