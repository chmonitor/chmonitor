/**
 * Micro-benchmark of /api/v1/agent request-setup CPU (no LLM call, issue #3560).
 * Measures agent creation (tool assembly + wrapping) plus the per-step
 * tool-schema JSON conversion the AI SDK runs in `prepareTools` on every step.
 *
 *   bun scripts/bench/agent-setup.bench.ts
 */
import { asSchema } from '@ai-sdk/provider-utils'
import { MockLanguageModelV3 } from 'ai/test'
import { createClickHouseAgent } from '@/lib/ai/agent/clickhouse-agent'

const STEPS = Number(process.env.BENCH_STEPS ?? 16)
const ITER = 30

async function oneRequest() {
  const agent = createClickHouseAgent({
    model: new MockLanguageModelV3(),
    hostId: 0,
  })
  const tools = (
    agent as unknown as {
      settings: { tools: Record<string, { inputSchema: unknown }> }
    }
  ).settings.tools
  for (let s = 0; s < STEPS; s++) {
    for (const t of Object.values(tools)) {
      await asSchema(t.inputSchema as Parameters<typeof asSchema>[0]).jsonSchema
    }
  }
}

await oneRequest() // first request: module init + cold caches
const t0 = performance.now()
for (let i = 0; i < ITER; i++) await oneRequest()
const per = (performance.now() - t0) / ITER
console.log(
  `agent setup + ${STEPS} steps of tool schema conversion: ${per.toFixed(2)} ms/request`
)
