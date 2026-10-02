/**
 * pipeJsonRenderCoalesced must be a drop-in for pipeJsonRender — same text,
 * same spec patches, same chunk order — while emitting at most one text delta
 * per upstream delta. Plain pipeJsonRender emits one delta per character, which
 * made every later stream stage run per char and pushed the agent request past
 * the Workers CPU limit (#3560).
 */
import { pipeJsonRenderCoalesced } from '../text-delta-coalescer'
import { describe, expect, test } from 'bun:test'
import { pipeJsonRender } from '@json-render/core'

type Chunk = { type: string; id?: string; delta?: string; [k: string]: unknown }

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = []
  const reader = stream.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) return out
    out.push(value)
  }
}

function makeStream(chunks: Chunk[]): ReadableStream<Chunk> {
  return new ReadableStream<Chunk>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c)
      controller.close()
    },
  })
}

const delta = (d: string, id = '0'): Chunk => ({
  type: 'text-delta',
  id,
  delta: d,
})

const PATCH_LINE = '{"op":"add","path":"/root","value":"card"}'

// Prose, a spec line split across several deltas, a fenced spec block, and
// non-text chunks interleaved — the shapes a real agent reply contains.
const FIXTURE: Chunk[] = [
  { type: 'start' },
  { type: 'start-step' },
  { type: 'text-start', id: '0' },
  delta('Here is the '),
  delta('server version.\n'),
  delta(PATCH_LINE.slice(0, 10)),
  delta(PATCH_LINE.slice(10, 30)),
  delta(`${PATCH_LINE.slice(30)}\nAfter `),
  delta('the patch.\n```spec\n'),
  delta('{"op":"add","path":"/elements/card","value":{"type":"Card"}}\n'),
  delta('```\nDone.'),
  { type: 'text-end', id: '0' },
  { type: 'tool-input-start', toolCallId: 'c1', toolName: 'query' },
  { type: 'text-start', id: '1' },
  delta('Second ', '1'),
  delta('block.', '1'),
  { type: 'text-end', id: '1' },
  { type: 'finish-step' },
  { type: 'finish' },
]

const textOf = (chunks: Chunk[]) =>
  chunks
    .filter((c) => c.type === 'text-delta')
    .map((c) => c.delta)
    .join('')

/** Chunk sequence with every run of text deltas collapsed to one marker. */
const shape = (chunks: Chunk[]) =>
  chunks
    .map((c) => (c.type === 'text-delta' ? 'text' : JSON.stringify(c)))
    .filter((s, i, all) => !(s === 'text' && all[i - 1] === 'text'))

describe('pipeJsonRenderCoalesced', () => {
  test('emits the same text, spec patches and chunk order as pipeJsonRender', async () => {
    const plain = await collect(pipeJsonRender(makeStream(FIXTURE)))
    const coalesced = await collect(
      pipeJsonRenderCoalesced(makeStream(FIXTURE))
    )

    expect(textOf(coalesced)).toBe(textOf(plain))
    expect(coalesced.filter((c) => c.type === 'data-spec')).toEqual(
      plain.filter((c) => c.type === 'data-spec')
    )
    expect(shape(coalesced)).toEqual(shape(plain))
    // Sanity: the fixture really does produce spec patches.
    expect(plain.filter((c) => c.type === 'data-spec').length).toBe(2)
  })

  test('emits at most one text delta per upstream delta (plain emits per char)', async () => {
    const upstreamDeltas = FIXTURE.filter((c) => c.type === 'text-delta').length
    const plain = await collect(pipeJsonRender(makeStream(FIXTURE)))
    const coalesced = await collect(
      pipeJsonRenderCoalesced(makeStream(FIXTURE))
    )
    const count = (cs: Chunk[]) =>
      cs.filter((c) => c.type === 'text-delta').length

    expect(count(coalesced)).toBeLessThanOrEqual(upstreamDeltas)
    // Guards the regression: the library itself splits per character.
    expect(count(plain)).toBeGreaterThan(upstreamDeltas * 5)
  })

  test('a single prose delta comes out as one delta, unchanged', async () => {
    const out = await collect(
      pipeJsonRenderCoalesced(
        makeStream([
          { type: 'text-start', id: 'a' },
          delta('hello world', 'a'),
          { type: 'text-end', id: 'a' },
        ])
      )
    )
    expect(out).toEqual([
      { type: 'text-start', id: 'a' },
      { type: 'text-delta', id: 'a', delta: 'hello world' },
      { type: 'text-end', id: 'a' },
    ])
  })

  test('text deltas are not merged across a text id change', async () => {
    const out = await collect(
      pipeJsonRenderCoalesced(
        makeStream([
          { type: 'text-start', id: 'a' },
          delta('one', 'a'),
          { type: 'text-start', id: 'b' },
          delta('two', 'b'),
        ])
      )
    )
    const deltas = out.filter((c) => c.type === 'text-delta')
    expect(deltas).toEqual([
      { type: 'text-delta', id: 'a', delta: 'one' },
      { type: 'text-delta', id: 'b', delta: 'two' },
    ])
  })

  test('never leaks its internal boundary marker downstream', async () => {
    const out = await collect(pipeJsonRenderCoalesced(makeStream(FIXTURE)))
    const known = new Set(FIXTURE.map((c) => c.type).concat('data-spec'))
    for (const c of out) expect(known.has(c.type)).toBe(true)
  })
})
