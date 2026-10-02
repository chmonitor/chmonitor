/**
 * Guards the per-isolate tool-schema cache (issue #3560). Without it the AI SDK
 * re-converts every tool's zod schema to JSON Schema on every step of every
 * request, which pushed tool-heavy agent runs over the Worker CPU limit.
 */

import { z } from 'zod'

import { createClickHouseAgent } from '../clickhouse-agent'
import {
  cachedInputSchemaCount,
  clearInputSchemaCache,
  withCachedInputSchemas,
} from '../tool-schema-cache'
import { beforeEach, describe, expect, test } from 'bun:test'
import { asSchema } from '@ai-sdk/provider-utils'
import { dynamicTool } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

type AnyTools = Record<string, { inputSchema: unknown }>

function agentTools(): AnyTools {
  const agent = createClickHouseAgent({
    model: new MockLanguageModelV3(),
    hostId: 0,
  })
  return (agent as unknown as { settings: { tools: AnyTools } }).settings.tools
}

async function toJson(t: { inputSchema: unknown }) {
  return asSchema(t.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema
}

describe('withCachedInputSchemas', () => {
  beforeEach(() => clearInputSchemaCache())

  test('converts each built-in tool schema once across steps and requests', async () => {
    const first = agentTools()
    const second = agentTools()
    for (const [name, t] of Object.entries(first)) {
      const a = await toJson(t)
      // A later step and a later request get the very same object back:
      // zod -> JSON Schema did not run again.
      expect(await toJson(t)).toBe(a)
      expect(await toJson(second[name])).toBe(a)
    }
    expect(cachedInputSchemaCount()).toBe(Object.keys(first).length)
  })

  test('returns the same JSON schema the uncached zod conversion does', async () => {
    const raw = dynamicTool({
      description: 'x',
      inputSchema: z.object({ sql: z.string().describe('SQL') }),
      execute: async () => null,
    })
    const cached = withCachedInputSchemas({ q: raw })
    expect(await toJson(cached.q)).toEqual(await toJson(raw))
  })

  test('still validates input with the zod schema', async () => {
    const cached = withCachedInputSchemas({
      q: dynamicTool({
        description: 'x',
        inputSchema: z.object({ n: z.number() }),
        execute: async () => null,
      }),
    })
    const schema = asSchema(
      cached.q.inputSchema as Parameters<typeof asSchema>[0]
    )
    expect((await schema.validate?.({ n: 1 }))?.success).toBe(true)
    expect((await schema.validate?.({ n: 'a' }))?.success).toBe(false)
  })
})
