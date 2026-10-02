/**
 * Per-isolate cache of built-in tool input JSON schemas (issue #3560).
 *
 * The AI SDK converts every tool's zod `inputSchema` to JSON Schema in
 * `prepareTools` on EVERY step of the tool loop, and the tool factories build
 * fresh zod objects per request. With ~31 tools and up to 16 steps that is the
 * largest repeated CPU cost of a `/api/v1/agent` request — enough to push
 * tool-heavy runs over the Worker CPU limit.
 *
 * Built-in tool schemas are static per tool name (no hostId/env input), so the
 * converted JSON is cached by name for the life of the isolate. Validation
 * still uses the current request's zod schema. Custom MCP tools are NOT passed
 * through here: their schemas come from user servers and can differ per user.
 */

import type { ToolSet } from 'ai'

import { asSchema, jsonSchema } from '@ai-sdk/provider-utils'

type JsonSchema = Awaited<ReturnType<typeof asSchema>['jsonSchema']>

const jsonSchemaByToolName = new Map<string, JsonSchema>()

export function withCachedInputSchemas<T extends ToolSet>(tools: T): T {
  const out: ToolSet = {}
  for (const [name, tool] of Object.entries(tools) as [
    string,
    ToolSet[string],
  ][]) {
    const schema = asSchema(tool.inputSchema)
    out[name] = {
      ...tool,
      inputSchema: jsonSchema(
        () => {
          let cached = jsonSchemaByToolName.get(name)
          if (cached === undefined) {
            cached = schema.jsonSchema as JsonSchema
            jsonSchemaByToolName.set(name, cached)
          }
          return cached
        },
        { validate: schema.validate }
      ),
    } as ToolSet[string]
  }
  return out as T
}

/** Test seam: number of tool schemas converted so far in this isolate. */
export function cachedInputSchemaCount(): number {
  return jsonSchemaByToolName.size
}

/** Test seam: drop the cache. */
export function clearInputSchemaCache(): void {
  jsonSchemaByToolName.clear()
}
