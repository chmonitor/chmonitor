/**
 * Stage-by-stage CPU profile of one /api/v1/agent request (issue #3560),
 * driven through the real runtime + stream modules with a scripted mock model
 * (no network, no LLM). Prints CPU time per stage for the first (cold
 * isolate) request and the mean of warm requests.
 *
 *   bun scripts/bench/agent-request.bench.ts
 *   BENCH_TOKENS=400 bun --cpu-prof scripts/bench/agent-request.bench.ts
 */
import { simulateReadableStream } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'
import { env } from '@/lib/cloudflare-workers-shim'

// Same resolution as the bun test preload: the Node shim backs `env` with
// process.env, so route-side modules import without a Workers runtime.
Bun.plugin({
  setup(build) {
    build.module('cloudflare:workers', () => ({
      exports: { env },
      loader: 'object',
    }))
  },
})

const TOKENS = Number(process.env.BENCH_TOKENS ?? 200)
const ITER = Number(process.env.BENCH_ITER ?? 20)

// Process CPU time (user + system), not wall time: Workers bill CPU, and the
// awaits in the stream would otherwise count idle scheduler gaps.
const t = () => {
  const u = process.cpuUsage()
  return (u.user + u.system) / 1000
}
const spans: Record<string, number[]> = {}
const span = (name: string, ms: number) => {
  if (!spans[name]) spans[name] = []
  spans[name].push(ms)
}

let s = t()
const runtime = await import('../../src/routes/api/v1/-agent/runtime')
span('import runtime (agent, tools, prompts, mcp)', t() - s)
s = t()
const streamMod = await import('../../src/routes/api/v1/-agent/stream')
span('import stream (json-render, analytics, billing)', t() - s)

const USAGE = {
  inputTokens: { total: 20, noCache: 20, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: TOKENS, text: TOKENS, reasoning: 0 },
}

function mockModel() {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        initialDelayInMs: null,
        // 0 (not null): each token arrives in its own macrotask, like a network read.
        chunkDelayInMs: 0,
        chunks: [
          { type: 'text-start', id: 't' },
          ...Array.from({ length: TOKENS }, (_, i) => ({
            type: 'text-delta' as const,
            id: 't',
            delta: `tok${i} `,
          })),
          { type: 'text-end', id: 't' },
          {
            type: 'finish',
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: USAGE,
          },
        ] as never[],
      }),
    }),
  })
}

let sseEvents = 0

async function oneRequest() {
  let s0 = t()
  const uiMessages = runtime.buildUiMessages({
    safeIncomingMessages: [],
    userMessage: 'hello, what is the server version?',
    pageContext: undefined,
    hostId: 0,
  })
  span('buildUiMessages', t() - s0)

  s0 = t()
  const { createClickHouseAgent } = await import('@/lib/ai/agent')
  const { AGENT_JSON_RENDER_INLINE_PROMPT } = await import(
    '@/lib/ai/agent/json-render-inline-prompt'
  )
  const agent = createClickHouseAgent({
    hostId: 0,
    model: mockModel(),
    systemPrompt: AGENT_JSON_RENDER_INLINE_PROMPT,
    sessionId: 'bench',
  })
  span('createClickHouseAgent', t() - s0)

  s0 = t()
  const res = streamMod.createAgentStreamResponse({
    agent,
    mcpCloseAll: null,
    uiMessages,
    userMessage: 'hello',
    model: 'openrouter:openrouter/free',
    requestedProvider: 'openrouter',
    billingOwnerId: null,
    resolvedPlan: null,
    releaseReservationOnce: async () => {},
  })
  const text = await res.text()
  span(`stream ${TOKENS} tokens to text`, t() - s0)
  sseEvents = text.split('data: ').length - 1
  if (!text.includes('"type":"finish"'))
    throw new Error(`no tokens: ${text.slice(0, 400)}`)
}

s = t()
await oneRequest()
const cold = t() - s
const coldSpans = Object.fromEntries(
  Object.entries(spans).map(([k, v]) => [k, v[v.length - 1]])
)
for (const k of Object.keys(spans)) if (!k.startsWith('import')) spans[k] = []
for (let i = 0; i < ITER; i++) await oneRequest()

console.log(`cold request total: ${cold.toFixed(1)} ms`)
console.log(`SSE events per response: ${sseEvents}`)
for (const [k, v] of Object.entries(spans)) {
  const warm = k.startsWith('import')
    ? '-'
    : (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2)
  console.log(
    `${k.padEnd(52)} cold ${coldSpans[k].toFixed(2).padStart(8)} ms   warm ${warm} ms`
  )
}
