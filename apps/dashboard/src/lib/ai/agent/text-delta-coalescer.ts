/**
 * `pipeJsonRender`, without its one-chunk-per-character output.
 *
 * `@json-render/core`'s transform scans each model text delta one character at
 * a time and enqueues every plain-text character as its own `text-delta`
 * chunk. Every later stage — the patch guard, the AI SDK's UI-message state
 * update, SSE JSON serialisation and UTF-8 encoding — then ran once per
 * character instead of once per model token, which dominated the agent
 * request's CPU time on Workers (issue #3560).
 *
 * `pipeJsonRenderCoalesced` tags the end of every upstream text delta with a
 * boundary marker. json-render passes unknown chunk types through unchanged
 * and in order, so after it the marker arrives right after the characters that
 * upstream chunk produced. A second transform joins consecutive `text-delta`s
 * for the same text id and emits them as one delta at each marker (and before
 * any other chunk), then drops the marker. Output is one text delta per model
 * delta — the same text, in the same order, as progressive as before.
 */

import { pipeJsonRender } from '@json-render/core'

const BOUNDARY_TYPE = 'chm-upstream-chunk-boundary'
const BOUNDARY = Object.freeze({ type: BOUNDARY_TYPE })

type Chunk = { type: string; [key: string]: unknown }

type TextDeltaChunk = { type: 'text-delta'; id: string; delta: string }

function isTextDelta(chunk: Chunk): chunk is TextDeltaChunk {
  return (
    chunk.type === 'text-delta' &&
    typeof chunk.id === 'string' &&
    typeof chunk.delta === 'string'
  )
}

function markUpstreamChunkEnds<T>(): TransformStream<T, T> {
  return new TransformStream<T, T>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      // Only text deltas get split by json-render; other chunks need no mark.
      if (isTextDelta(chunk as Chunk)) controller.enqueue(BOUNDARY as T)
    },
  })
}

function coalesceTextDeltas<T>(): TransformStream<T, T> {
  let pendingId: string | null = null
  let pendingText = ''

  const flushPending = (controller: TransformStreamDefaultController<T>) => {
    if (pendingId === null) return
    controller.enqueue({
      type: 'text-delta',
      id: pendingId,
      delta: pendingText,
    } as T)
    pendingId = null
    pendingText = ''
  }

  return new TransformStream<T, T>({
    transform(chunk, controller) {
      const c = chunk as Chunk
      if (c.type === BOUNDARY_TYPE) {
        flushPending(controller)
        return
      }
      if (!isTextDelta(c)) {
        flushPending(controller)
        controller.enqueue(chunk)
        return
      }
      if (pendingId !== null && pendingId !== c.id) flushPending(controller)
      pendingId = c.id
      pendingText += c.delta
    },
    flush(controller) {
      flushPending(controller)
    },
  })
}

export function pipeJsonRenderCoalesced<T>(
  stream: ReadableStream<T>
): ReadableStream<T> {
  return pipeJsonRender(
    stream.pipeThrough(markUpstreamChunkEnds<T>())
  ).pipeThrough(coalesceTextDeltas<T>()) as ReadableStream<T>
}
